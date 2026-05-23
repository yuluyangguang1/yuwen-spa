// Auth Hook：保护 /api/* 路由
//
// 白名单路由（不需要登录）：
//   /api/health, /api/system, /api/auth/login
//   /api/reviews/* （顾客评价是公开的）
//   /api/guest/*   （顾客端 QR 入口）
//
// 其余 /api/* 都需要 Bearer token

import { extractToken } from '../routes/auth.js'

const PUBLIC_PATHS = [
  '/api/health',
  '/api/system',
  '/api/auth/login',
]

function isPublic(path) {
  if (PUBLIC_PATHS.includes(path)) return true
  if (path.startsWith('/api/reviews')) return true   // 顾客评价（扫码后）
  if (path.startsWith('/api/guest')) return true      // 顾客端入口
  return false
}

export async function registerAuthHook(fastify) {
  fastify.addHook('onRequest', async (req, reply) => {
    // 只保护 /api/* 路由
    if (!req.url.startsWith('/api/')) return

    // 白名单放行
    if (isPublic(req.url.split('?')[0])) return

    const payload = extractToken(req)
    if (!payload) {
      return reply.code(401).send({ error: '请先登录' })
    }

    // 把用户信息挂到 request 上，后续路由可以用
    req.user = payload
  })
}
