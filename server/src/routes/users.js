// 用户管理路由（仅 admin）

import { nanoid } from 'nanoid'
import { hashPassword, validatePassword } from '../auth/utils.js'
import { BusinessError, NotFoundError, PermissionError, ValidationError, ConflictError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

export async function registerUserRoutes(fastify) {

  function requireAdmin(req, reply) {
    if (req.user?.role !== 'admin') {
      throw new PermissionError('仅管理员可操作')
    }
    return true
  }

  // ── 列出所有用户（分页）───────────────────────
  fastify.get('/api/users', async (req, reply) => {
    try {
      if (!requireAdmin(req, reply)) return
      const { page = 1, pageSize = 20 } = parsePagination(req)
      const offset = (page - 1) * pageSize
      const users = fastify.db.prepare(`
        SELECT u.id, u.username, u.role, u.display_name, u.active,
               u.last_login_at, u.created_at, t.name AS tech_name
        FROM users u
        LEFT JOIN technicians t ON u.technician_id = t.id
        WHERE u.shop_id = ?
        ORDER BY u.role, u.username
        LIMIT ? OFFSET ?
      `).all(req.user.shop_id, pageSize, offset)
      const total = fastify.db.prepare(`SELECT COUNT(*) AS total FROM users WHERE shop_id = ?`).get(req.user.shop_id).total
      return { data: users, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 创建用户 ────────────────────────────────
  fastify.post('/api/users', async (req, reply) => {
    try {
      if (!requireAdmin(req, reply)) return
      const { username, password, role, display_name, technician_id } = req.body || {}

      if (!username || !password) throw new ValidationError('用户名和密码必填')
      if (!['admin', 'pos', 'tech'].includes(role)) throw new ValidationError('角色必须是 admin/pos/tech')
      const pwdErr = validatePassword(password)
      if (pwdErr) throw new ValidationError(pwdErr)

      const existing = fastify.db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
      if (existing) throw new ConflictError('用户名已存在')

      const now = Date.now()
      const id = nanoid(10)
      fastify.db.prepare(`
        INSERT INTO users(id, shop_id, username, password_hash, role, display_name, technician_id, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.user.shop_id, username, hashPassword(password), role, display_name || username, technician_id || null, now, now)

      return { ok: true, id }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 修改用户信息 ──────────────────────────────
  fastify.put('/api/users/:id', async (req, reply) => {
    try {
      if (!requireAdmin(req, reply)) return
      const { role, display_name, active, technician_id } = req.body || {}
      const userId = req.params.id

      if (role !== undefined && role !== null && !['admin', 'pos', 'tech'].includes(role)) {
        throw new ValidationError('角色必须是 admin/pos/tech')
      }

      const user = fastify.db.prepare(`SELECT * FROM users WHERE id = ? AND shop_id = ?`).get(userId, req.user.shop_id)
      if (!user) throw new NotFoundError('用户不存在')

      if ((active === 0 || active === '0') && userId === req.user.sub) {
        throw new ValidationError('不能禁用自己的账号')
      }

      const now = Date.now()
      // technician_id：字段出现才更新（null 显式清空），缺省保持原值，避免编辑清空关联
      const techIdUpdated = Object.prototype.hasOwnProperty.call(req.body || {}, 'technician_id')
        ? (technician_id || null)
        : undefined
      if (techIdUpdated !== undefined) {
        fastify.db.prepare(`
          UPDATE users SET role = COALESCE(?, role), display_name = COALESCE(?, display_name),
            active = COALESCE(?, active), technician_id = ?, updated_at = ? WHERE id = ? AND shop_id = ?
        `).run(role || null, display_name || null, active !== undefined ? active : null, techIdUpdated, now, userId, req.user.shop_id)
      } else {
        fastify.db.prepare(`
          UPDATE users SET role = COALESCE(?, role), display_name = COALESCE(?, display_name),
            active = COALESCE(?, active), updated_at = ? WHERE id = ? AND shop_id = ?
        `).run(role || null, display_name || null, active !== undefined ? active : null, now, userId, req.user.shop_id)
      }

      return { ok: true }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 管理员重置密码 ──────────────────────────
  fastify.put('/api/users/:id/password', async (req, reply) => {
    try {
      if (!requireAdmin(req, reply)) return
      const { newPassword } = req.body || {}
      const pwdErr = validatePassword(newPassword || '')
      if (pwdErr) throw new ValidationError(pwdErr)

      const user = fastify.db.prepare(`SELECT id FROM users WHERE id = ? AND shop_id = ?`).get(req.params.id, req.user.shop_id)
      if (!user) throw new NotFoundError('用户不存在')

      fastify.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND shop_id = ?`)
        .run(hashPassword(newPassword), Date.now(), req.params.id, req.user.shop_id)

      return { ok: true }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 禁用用户 ──────────────────────────────────
  fastify.delete('/api/users/:id', async (req, reply) => {
    try {
      if (!requireAdmin(req, reply)) return
      if (req.params.id === req.user.sub) {
        throw new ValidationError('不能删除自己的账号')
      }

      const result = fastify.db.prepare(`UPDATE users SET active = 0, updated_at = ? WHERE id = ? AND shop_id = ?`)
        .run(Date.now(), req.params.id, req.user.shop_id)
      if (result.changes === 0) throw new NotFoundError('用户不存在')
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}
