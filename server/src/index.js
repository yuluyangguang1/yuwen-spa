// 足韵 yuwen-spa 后端入口
//
// 单进程模式：Fastify 一个进程同时处理 API、WebSocket、托管前端静态文件。
// 这是为了"一个不断电的小主机"场景做的简化——零运维、双击就跑。
//
// 监听 0.0.0.0 是有意为之：店内任何设备（同 WiFi）都能访问。
// 不要听 127.0.0.1，否则只有主机本机能用。
//
// 端口默认 8080，被占用就往上找，类似 OpenClaw Portable 的端口让步策略。

import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

import { initDatabase } from './db/init.js'
import { registerRoutes } from './routes/index.js'
import { registerRealtimeBus } from './realtime/bus.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const PORT_START = Number(process.env.PORT || 8080)
const PORT_END = PORT_START + 10
const HOST = '0.0.0.0'

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  trustProxy: true,
})

// ─── 1. 初始化数据库 ──────────────────────────────────────────
// 启动时如果库不存在就创建 + 跑 migrations + seed 默认数据。
// 同步 API（better-sqlite3 是同步的）所以可以放在 await 上面。
const db = initDatabase(path.join(ROOT, 'db'))
fastify.decorate('db', db)

// ─── 2. CORS ─────────────────────────────────────────────────
// 开发时前端在 5173 端口，需要跨域。生产时前端和后端同源，CORS 没用。
// 但保留 origin true 是为了：店内 192.168.x.x 不同设备可能访问不同主机名（mDNS）。
await fastify.register(fastifyCors, {
  origin: true,
  credentials: true,
})

// ─── 3. WebSocket（用于排钟实时同步）───────────────────────────
await fastify.register(fastifyWebsocket)
registerRealtimeBus(fastify)

// ─── 4. API 路由 ──────────────────────────────────────────────
await registerRoutes(fastify)

// ─── 5. 静态文件托管（前端构建产物）──────────────────────────────
// 生产：server/public 是 web build 拷贝过来的产物，根路径直接服务。
// 开发：public 可能不存在，访问根路径会落到 SPA fallback 提示去 5173。
const publicDir = path.join(ROOT, 'public')
const fs = await import('node:fs')
if (fs.existsSync(publicDir)) {
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  })
  // SPA fallback：任何未命中 API 的请求都返回 index.html，让前端 router 处理
  fastify.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'API not found' })
    }
    return reply.sendFile('index.html')
  })
} else {
  fastify.get('/', async (req, reply) => {
    return reply.type('text/html').send(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>yuwen-spa dev</title>
<body style="font-family:system-ui;padding:2rem;color:#333">
<h1>yuwen-spa server is running</h1>
<p>开发模式：前端在 <a href="http://localhost:5173">http://localhost:5173</a></p>
<p>生产模式：运行 <code>npm run build</code> 后 server/public 才会有内容</p>
<p>API 健康检查：<a href="/api/health">/api/health</a></p>
</body></html>`)
  })
}

// ─── 6. 端口让步启动 ──────────────────────────────────────────
async function listenWithFallback(port) {
  try {
    await fastify.listen({ port, host: HOST })
    return port
  } catch (err) {
    if (err.code === 'EADDRINUSE' && port < PORT_END) {
      fastify.log.warn(`端口 ${port} 被占，尝试 ${port + 1}`)
      return listenWithFallback(port + 1)
    }
    throw err
  }
}

const port = await listenWithFallback(PORT_START)

// ─── 7. 友好打印：本机所有可访问 IP ────────────────────────────
// 老板/技师只要点其中任意一个链接就能用。
function getLanIPs() {
  const ifs = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(ifs)) {
    for (const iface of ifs[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }
  return ips
}

console.log('')
console.log('  足韵 yuwen-spa 已启动')
console.log('  ─────────────────────────────────────')
console.log(`  本机访问:  http://localhost:${port}`)
for (const ip of getLanIPs()) {
  console.log(`  局域网:    http://${ip}:${port}`)
}
console.log('  ─────────────────────────────────────')
console.log('  按 Ctrl+C 停止')
console.log('')

// ─── 8. 优雅退出 ──────────────────────────────────────────────
const shutdown = async (sig) => {
  fastify.log.info(`收到 ${sig}，关闭中...`)
  try {
    await fastify.close()
    db.close()
  } catch (e) {
    fastify.log.error(e)
  }
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// 全局兜底（log 不退出，让小主机继续服务）
process.on('uncaughtException', (err) => {
  fastify.log.error({ err }, 'uncaughtException')
})
process.on('unhandledRejection', (reason) => {
  fastify.log.error({ reason }, 'unhandledRejection')
})
