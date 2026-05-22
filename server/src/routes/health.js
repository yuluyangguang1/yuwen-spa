// 健康检查 + 系统信息
// 用途：浏览器/前端心跳；运维快速判断服务是否在跑。

import os from 'node:os'

export async function registerHealthRoutes(fastify) {
  fastify.get('/api/health', async () => ({
    ok: true,
    ts: Date.now(),
    uptime: process.uptime(),
    version: '0.1.0',
  }))

  fastify.get('/api/system', async () => ({
    ok: true,
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
    cpu: os.cpus().length,
    uptime: os.uptime(),
  }))
}
