// 鉴权路由：login / me / change-password
//
// POST /api/auth/login         { username, password } → { token, user }
// GET  /api/auth/me             (需 Authorization: Bearer xxx) → { user }
// PUT  /api/auth/password       { oldPassword, newPassword } → { ok }

import { verifyPassword, createToken, verifyToken, hashPassword, validatePassword } from '../auth/utils.js'
import { checkRateLimit } from '../auth/ratelimit.js'

export async function registerAuthRoutes(fastify) {
  // ── 登录 ────────────────────────────────────────
  fastify.post('/api/auth/login', async (req, reply) => {
    // Rate limiting：同一 IP 5 分钟内最多 10 次
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const rl = checkRateLimit(ip)
    if (!rl.ok) {
      return reply.code(429).send({ error: `登录尝试过于频繁，请 ${rl.retryAfter} 秒后重试` })
    }

    const { username, password } = req.body || {}

    if (!username || !password) {
      return reply.code(400).send({ error: '请输入用户名和密码' })
    }

    // 验证密码复杂度（仅在修改密码时校验，登录时不限制）
    // const pwdErr = validatePassword(password)
    // if (pwdErr) return reply.code(400).send({ error: pwdErr })

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
        technician_id: user.technician_id,
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
      `SELECT id, username, role, display_name, shop_id, technician_id FROM users WHERE id = ? AND active = 1`
    ).get(payload.sub)

    if (!user) {
      return reply.code(401).send({ error: '用户不存在或已禁用' })
    }

    return { user }
  })

  // ── 修改自己的密码 ──────────────────────────────
  fastify.put('/api/auth/password', async (req, reply) => {
    const { oldPassword, newPassword } = req.body || {}

    if (!oldPassword || !newPassword) {
      return reply.code(400).send({ error: '请输入旧密码和新密码' })
    }
    if (newPassword.length < 4) {
      return reply.code(400).send({ error: '新密码至少 4 位' })
    }

    const user = fastify.db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.sub)
    if (!user) {
      return reply.code(404).send({ error: '用户不存在' })
    }

    if (!verifyPassword(oldPassword, user.password_hash)) {
      return reply.code(400).send({ error: '旧密码错误' })
    }

    fastify.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(hashPassword(newPassword), Date.now(), user.id)

    return { ok: true }
  })
}

// ── 辅助：从请求中提取 token payload ──────────────
export function extractToken(req) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return verifyToken(auth.slice(7))
}
