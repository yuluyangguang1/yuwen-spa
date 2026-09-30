// 足韵 yuwen-spa 后端入口
//
// 单进程模式：Fastify 一个进程同时处理 API、WebSocket、托管前端静态文件。
// 这是为了"一台不断电的小主机"场景做的简化——零运维、双击就跑。
//
// 监听 0.0.0.0 是有意为之：店内任何设备（同 WiFi）都能访问。
// 不要听 127.0.0.1，否则只有主机本机能用。
//
// 端口默认 8080，被占用就往上找，类似 OpenClaw Portable 的端口让步策略。

// 必须最先加载：设置 JWT_SECRET 等环境变量（auth/utils 在 import 链上读取）
import './load-env.js'

import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCompress from '@fastify/compress'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

import { initDatabase } from './db/init.js'
import { registerRoutes } from './routes/index.js'
import { registerRealtimeBus } from './realtime/bus.js'
import { getLanIPs } from './lib/network.js'
import { registerErrorHandler } from './lib/errors.js'
import { LRUCache } from './lib/cache.js'
import { registerScheduler } from './scheduler.js'
import { registerEndWatch } from './endwatch.js'
import { initBackup } from './backup/index.js'
import { checkRateLimit } from './auth/ratelimit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const publicDir = path.join(ROOT, 'public')
const fs = await import('node:fs')

const PORT_START = Number(process.env.PORT || 8080)
const PORT_END = PORT_START + 10
const HOST = '0.0.0.0'

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  // 直连 0.0.0.0（无反代）：socket IP 即真实 IP。
  // 若信任 XFF，店内任意设备可伪造 XFF 轮换限流键，绕过登录/全局限流。
  // 需要反代时再按固定网段配置。
  trustProxy: false,
  // 限制请求体大小，防止 DoS
  bodyLimit: 1024 * 1024, // 1 MB
  // 请求超时
  requestTimeout: 30000,
})

// ─── 安全头中间件 ──────────────────────────────────────────
fastify.addHook('onRequest', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('X-XSS-Protection', '1; mode=block')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
  ].join('; '))
})

// ─── 全局限流（/api 写读兜底；敏感端点另有更严限制）───────
// 局域网 POS 正常操作量远低于此阈值；挡住脚本刷接口与爬虫。
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
fastify.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return
  if (req.url.startsWith('/api/health') || req.url.startsWith('/api/realtime')) return
  const rl = checkRateLimit(`global:${req.ip}`, {
    maxAttempts: 600,
    windowMs: 60 * 1000,
  })
  if (!rl.ok) {
    reply.header('Retry-After', String(rl.retryAfter))
    return reply.code(429).send({
      error: `请求过于频繁，请 ${rl.retryAfter} 秒后重试`,
      code: 'RATE_LIMITED',
    })
  }
})

// ─── CSRF/跨站 Origin 校验（写方法）────────────────────────
// 认证走 Authorization: Bearer（localStorage），浏览器不会跨站自动带；
// 此处拦截「无 Bearer 的跨站写请求」（顾客端 POST）与 Origin 伪造。
fastify.addHook('onRequest', async (req, reply) => {
  if (SAFE_METHODS.has(req.method)) return
  if (!req.url.startsWith('/api/')) return
  // 支付网关服务器回调：无浏览器 Origin，且路由内自行验签
  if (/^\/api\/payment\/(wechat|alipay)\/notify/.test(req.url)) return

  const origin = req.headers.origin
  if (!origin) return // curl / 同源非浏览器 / 老旧 WebView 无 Origin

  let o
  try {
    o = new URL(origin)
  } catch {
    return reply.code(403).send({ error: '非法 Origin', code: 'CSRF_REJECTED' })
  }

  const host = String(req.headers.host || '')
  const reqHostname = host.split(':')[0]
  const localNames = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

  // 开发机 localhost 任意端口（Vite 5173 → 代理到 8080）
  if (localNames.has(o.hostname) && localNames.has(reqHostname)) return
  // 同主机同端口（店内 192.168.x.x:8080 页面直连接口）
  if (o.host === host) return
  // 仅主机名相同、非本机：要求与请求 Host 一致的端口也匹配（防 evil:80 冒充）
  if (o.hostname === reqHostname && o.port === (host.includes(':') ? host.split(':').pop() : (o.protocol === 'https:' ? '443' : '80'))) {
    return
  }

  return reply.code(403).send({ error: '跨站请求被拒绝', code: 'CSRF_REJECTED' })
})

// ─── 1. 初始化数据库 ──────────────────────────────────────────
// 启动时如果库不存在就创建 + 跑 migrations + seed 默认数据。
// 同步 API（better-sqlite3 是同步的）所以可以放在 await 上面。
const db = initDatabase(path.join(ROOT, 'db'))
fastify.decorate('db', db)
fastify.decorate('cache', new LRUCache(1000, 5 * 60 * 1000))

// ─── 2. CORS ─────────────────────────────────────────────
// 开发时前端在 5173 端口，需要跨域。生产时前端和后端同源，CORS 没用。
// 但保留 origin true 是为了：店内 192.168.x.x 不同设备可能访问不同主机名（mDNS）。
await fastify.register(fastifyCors, {
  origin: true,
  credentials: true,
})

// ─── 3. 表单解析 ──────────────────────────────────────────
// 不用 @fastify/formbody：下面的自定义解析器已覆盖 urlencoded，并保留 bodyRaw 供支付回调验签
// 支付回调需要原始 body 做 HMAC 验签：保留 raw 字符串
fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
  try {
    req.bodyRaw = String(body)
    done(null, Object.fromEntries(new URLSearchParams(String(body))))
  } catch (e) {
    done(e)
  }
})

// JSON 回调同样保留 raw
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    req.bodyRaw = String(body)
    if (body === '' || body == null) return done(null, {})
    done(null, JSON.parse(body))
  } catch (e) {
    e.statusCode = 400
    done(e, undefined)
  }
})

// 微信回调为 XML：自定义解析器（仅支付回调路径使用）
fastify.addContentTypeParser('application/xml', { parseAs: 'string' }, (req, body, done) => {
  try {
    const text = String(body)
    const obj = {}
    // 简单 key/value 提取（微信通知字段均为扁平结构）
    const re = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>([^<]*)<\/\3>/g
    let m
    while ((m = re.exec(text)) !== null) {
      const key = m[1] || m[3]
      const val = m[2] !== undefined ? m[2] : m[4]
      if (key) obj[key] = val
    }
    req.bodyRaw = text
    done(null, obj)
  } catch (e) {
    done(e)
  }
})

// ─── 4. 压缩 ─────────────────────────────────────────────
await fastify.register(fastifyCompress, {
  encodings: ['gzip', 'deflate'],
  threshold: 1024, // 只压缩 >1KB 的响应
})

// ─── 5. WebSocket（用于排钟实时同步）───────────────────────
await fastify.register(fastifyWebsocket)
registerRealtimeBus(fastify)

// 6. API 路由 ──────────────────────────────────────
await registerRoutes(fastify)

// 6.5 通知历史写入依赖 db（Phase 3）
try {
  const { setNotifyHistoryDb } = await import('./notify/index.js')
  const defaultShop = db.prepare(`SELECT id FROM shops ORDER BY created_at LIMIT 1`).get()
  setNotifyHistoryDb(db, defaultShop?.id || null)
} catch (e) {
  console.error('[notify] history db 注入失败:', e.message)
}

// 7. 结构化错误处理 ──────────────────────────────
registerErrorHandler(fastify)

// 8. 定时任务调度器 ──────────────────────────────
registerScheduler(fastify)

// 8.1 完钟倒计时提醒（WS + 店内外放）────────────
try {
  await registerEndWatch(fastify)
} catch (e) {
  console.error('[endwatch] 启动失败:', e.message)
}

// 8.5 自动备份（每小时 VACUUM INTO，保留 7 天）
try {
  initBackup(db)
} catch (e) {
  console.error('[backup] 初始化失败:', e.message)
}

// 404 兜底（SPA fallback）
fastify.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'API not found', code: 'NOT_FOUND' })
  }
  const htmlPath = path.join(publicDir, 'index.html')
  if (fs.existsSync(htmlPath)) {
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    reply.header('Pragma', 'no-cache')
    reply.header('Expires', '0')
    return reply.type('text/html').send(fs.readFileSync(htmlPath))
  }
  return reply.code(404).send({ error: 'Not found' })
})

// 8. 静态文件托管（前端构建产物）───────────────────────────
// 生产：server/public 是 web build 拷贝过来的产物，根路径直接服务。
// 开发：public 可能不存在，访问根路径会落到 SPA fallback 提示去 5173。
// static files served manually above to ensure cache headers are controlled
if (fs.existsSync(publicDir)) {
  const MIME = {
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
    '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  }
  // 防路径穿越：解析后必须仍在 publicDir 内
  const safePublicFile = (rel) => {
    const filePath = path.resolve(publicDir, rel)
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) return null
    return filePath
  }
  const sendPublicFile = async (req, reply, rel, cacheControl) => {
    const filePath = safePublicFile(rel)
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return reply.code(404).send('Not found')
    }
    if (cacheControl) reply.header('Cache-Control', cacheControl)
    const ext = path.extname(filePath).toLowerCase()
    return reply.type(MIME[ext] || 'application/octet-stream').send(fs.readFileSync(filePath))
  }

  // 手动服务静态资源，确保缓存头可控（路由参数由 Fastify 做 URL 解码）
  fastify.get('/assets/*', async (req, reply) =>
    sendPublicFile(req, reply, path.join('assets', req.params['*']), 'public, max-age=3600, immutable'))
  // 技师照片（管理后台上传）
  fastify.get('/avatars/*', async (req, reply) =>
    sendPublicFile(req, reply, path.join('avatars', req.params['*']), 'public, max-age=3600'))
  // index.html 不缓存
  fastify.get('/', async (req, reply) =>
    sendPublicFile(req, reply, 'index.html', 'no-cache, no-store, must-revalidate'))
  // 其他静态资源（icons/manifest/sw.js）不缓存
  fastify.get('/icons/*', async (req, reply) =>
    sendPublicFile(req, reply, path.join('icons', req.params['*']), 'no-cache'))
  fastify.get('/manifest.json', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache')
    return reply.type('application/json').send(fs.readFileSync(path.join(publicDir, 'manifest.json')))
  })
  fastify.get('/sw.js', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache')
    return reply.type('application/javascript').send(fs.readFileSync(path.join(publicDir, 'sw.js')))
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

// ─── 9. 端口让步启动 ──────────────────────────────────────────
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

// ─── 10. 友好打印：本机所有可访问 IP ────────────────────────────
// 老板/技师只要点其中任意一个链接就能用。
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

// ─── 11. 优雅退出 ──────────────────────────────────────────
// SSE/WS 活跃连接可能让 close() 挂起 → 强制超时退出，避免僵尸进程。
let shuttingDown = false
const shutdown = async (sig) => {
  if (shuttingDown) return
  shuttingDown = true
  fastify.log.info(`收到 ${sig}，关闭中...`)
  const forceTimer = setTimeout(() => {
    fastify.log.error('关闭超时，强制退出')
    process.exit(1)
  }, 3000)
  forceTimer.unref?.()
  try {
    await Promise.race([
      fastify.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 2500)),
    ])
    db.close()
    clearTimeout(forceTimer)
    process.exit(0)
  } catch (e) {
    fastify.log.error(e)
    clearTimeout(forceTimer)
    process.exit(1)
  }
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// 全局兜底：记录异常并降级健康检查；连续异常过多则退出让守护拉起。
// 单次异常不立刻退（小主机继续服务），但 health 会标记不健康。
globalThis.__yuwenUnhealthy = false
let uncaughtCount = 0
process.on('uncaughtException', (err) => {
  fastify.log.error({ err }, 'uncaughtException')
  uncaughtCount++
  globalThis.__yuwenUnhealthy = true
  if (uncaughtCount >= 5) {
    fastify.log.error({ uncaughtCount }, 'uncaughtException 过多，退出')
    process.exit(1)
  }
})
process.on('unhandledRejection', (reason) => {
  fastify.log.error({ reason }, 'unhandledRejection')
})
