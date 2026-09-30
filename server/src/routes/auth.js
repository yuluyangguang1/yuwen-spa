// 鉴权路由：login / me / change-password
//
// POST /api/auth/login         { username, password } → { token, user }
// GET  /api/auth/me             (需 Authorization: Bearer xxx) → { user }
// PUT  /api/auth/password       { oldPassword, newPassword } → { ok }

import { verifyPassword, createToken, verifyToken, hashPassword, validatePassword } from '../auth/utils.js'
import { checkRateLimit } from '../auth/ratelimit.js'
import { requireObject, requireString } from '../lib/validate.js'
import { BusinessError } from '../lib/errors.js'

export async function registerAuthRoutes(fastify) {
  // ── 登录 ────────────────────────────────────────
  fastify.post('/api/auth/login', async (req, reply) => {
    try {
      // Rate limiting：同一 IP+用户名 5 分钟内最多 10 次（防伪造 XFF 绕过）
      const ip = req.ip || req.socket?.remoteAddress || 'unknown'
      requireObject(req.body)
      const username = requireString(req.body.username, 'username', { max: 64 })
      const password = requireString(req.body.password, 'password', { max: 128, trim: false, min: 1 })

      const rl = checkRateLimit(`${ip}|${String(username).toLowerCase()}`)
      if (!rl.ok) {
        return reply.code(429).send({ error: `登录尝试过于频繁，请 ${rl.retryAfter} 秒后重试` })
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
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 获取当前用户信息 ────────────────────────────
  fastify.get('/api/auth/me', async (req, reply) => {
    try {
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
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 修改自己的密码 ──────────────────────────────
  fastify.put('/api/auth/password', async (req, reply) => {
    try {
      requireObject(req.body)
      const oldPassword = requireString(req.body.oldPassword, 'oldPassword', { max: 128, trim: false })
      const newPassword = requireString(req.body.newPassword, 'newPassword', { max: 128, trim: false })

      // 防旧密码暴力破解：同用户 15 分钟最多 10 次
      const rl = checkRateLimit(`${req.ip}|${req.user.sub}|pwd`, { maxAttempts: 10, windowMs: 15 * 60 * 1000 })
      if (!rl.ok) {
        return reply.code(429).send({ error: `尝试过于频繁，请 ${rl.retryAfter} 秒后重试` })
      }

      const pwdErr = validatePassword(newPassword)
      if (pwdErr) return reply.code(400).send({ error: pwdErr })

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
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}

// ── 辅助：从请求中提取 token payload ──────────────
export function extractToken(req) {
  try {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) return null
    return verifyToken(auth.slice(7))
  } catch (e) {
    req.log.error(e)
    return null
  }
}
