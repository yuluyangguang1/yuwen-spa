// 用户管理路由（仅 admin）
//
// GET    /api/users           列出所有用户
// POST   /api/users           创建用户（admin 给收银/技师开号）
// PUT    /api/users/:id       修改用户（显示名/角色/状态）
// PUT    /api/users/:id/password  管理员重置密码（无需旧密码）
// DELETE /api/users/:id       禁用用户

import { nanoid } from 'nanoid'
import { hashPassword } from '../auth/utils.js'

export async function registerUserRoutes(fastify) {

  // ── 中间件：仅 admin ────────────────────────────
  function requireAdmin(req, reply) {
    if (req.user?.role !== 'admin') {
      reply.code(403).send({ error: '仅管理员可操作' })
      return false
    }
    return true
  }

  // ── 列出所有用户 ────────────────────────────────
  fastify.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const users = fastify.db.prepare(`
      SELECT u.id, u.username, u.role, u.display_name, u.active,
             u.last_login_at, u.created_at,
             t.name AS tech_name
      FROM users u
      LEFT JOIN technicians t ON u.technician_id = t.id
      WHERE u.shop_id = ?
      ORDER BY u.role, u.username
    `).all(req.user.shop_id)

    return { users }
  })

  // ── 创建用户 ────────────────────────────────────
  fastify.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const { username, password, role, display_name, technician_id } = req.body || {}

    if (!username || !password) {
      return reply.code(400).send({ error: '用户名和密码必填' })
    }
    if (!['admin', 'pos', 'tech'].includes(role)) {
      return reply.code(400).send({ error: '角色必须是 admin/pos/tech' })
    }
    if (password.length < 4) {
      return reply.code(400).send({ error: '密码至少 4 位' })
    }

    // 检查用户名是否已存在
    const existing = fastify.db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
    if (existing) {
      return reply.code(409).send({ error: '用户名已存在' })
    }

    const now = Date.now()
    const id = nanoid(10)

    fastify.db.prepare(`
      INSERT INTO users(id, shop_id, username, password_hash, role, display_name, technician_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.shop_id, username, hashPassword(password), role, display_name || username, technician_id || null, now, now)

    return { ok: true, id }
  })

  // ── 修改用户信息 ────────────────────────────────
  fastify.put('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const { role, display_name, active, technician_id } = req.body || {}
    const userId = req.params.id

    const user = fastify.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId)
    if (!user) {
      return reply.code(404).send({ error: '用户不存在' })
    }

    // 不能禁用自己
    if (active === 0 && userId === req.user.sub) {
      return reply.code(400).send({ error: '不能禁用自己的账号' })
    }

    const now = Date.now()
    fastify.db.prepare(`
      UPDATE users SET
        role = COALESCE(?, role),
        display_name = COALESCE(?, display_name),
        active = COALESCE(?, active),
        technician_id = ?,
        updated_at = ?
      WHERE id = ?
    `).run(role || null, display_name || null, active !== undefined ? active : null, technician_id || null, now, userId)

    return { ok: true }
  })

  // ── 管理员重置密码 ──────────────────────────────
  fastify.put('/api/users/:id/password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const { newPassword } = req.body || {}
    if (!newPassword || newPassword.length < 4) {
      return reply.code(400).send({ error: '新密码至少 4 位' })
    }

    const user = fastify.db.prepare(`SELECT id FROM users WHERE id = ?`).get(req.params.id)
    if (!user) {
      return reply.code(404).send({ error: '用户不存在' })
    }

    fastify.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(hashPassword(newPassword), Date.now(), req.params.id)

    return { ok: true }
  })

  // ── 禁用用户 ────────────────────────────────────
  fastify.delete('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    if (req.params.id === req.user.sub) {
      return reply.code(400).send({ error: '不能删除自己的账号' })
    }

    fastify.db.prepare(`UPDATE users SET active = 0, updated_at = ? WHERE id = ?`)
      .run(Date.now(), req.params.id)

    return { ok: true }
  })
}
