// 鉴权路由：login / me
//
// POST /api/auth/login  { username, password } → { token, user }
// GET  /api/auth/me      (需 Authorization: Bearer xxx) → { user }

import { verifyPassword, createToken, verifyToken } from '../auth/utils.js'

export async function registerAuthRoutes(fastify) {
  // ── 登录 ────────────────────────────────────────
  fastify.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body || {}

    if (!username || !password) {
      return reply.code(400).send({ error: '请输入用户名和密码' })
    }

    const user = fastify.db.prepare(
      `SELECT * FROM users WHERE username = ? AND active = 1`
    ).get(username)

    if (!user) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }

    if (!verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }

    // 更新最后登录时间
    fastify.db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
      .run(Date.now(), user.id)

    const token = createToken(user)

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        shop_id: user.shop_id,
      },
    }
  })

  // ── 获取当前用户信息 ────────────────────────────
  fastify.get('/api/auth/me', async (req, reply) => {
    const payload = extractToken(req)
    if (!payload) {
      return reply.code(401).send({ error: '未登录' })
    }

    const user = fastify.db.prepare(
      `SELECT id, username, role, display_name, shop_id FROM users WHERE id = ? AND active = 1`
    ).get(payload.sub)

    if (!user) {
      return reply.code(401).send({ error: '用户不存在或已禁用' })
    }

    return { user }
  })
}

// ── 辅助：从请求中提取 token payload ──────────────
export function extractToken(req) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return verifyToken(auth.slice(7))
}
