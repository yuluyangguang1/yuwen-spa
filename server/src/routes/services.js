// 服务项目（足浴/按摩/采耳 等）

import { nanoid } from 'nanoid'
import { BusinessError, NotFoundError, ValidationError, PermissionError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

export async function registerServiceRoutes(fastify) {
  function requireAdmin(req) {
    if (req.user?.role !== 'admin') throw new PermissionError('仅管理员可操作')
  }

  fastify.get('/api/services', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { page, pageSize, offset } = parsePagination(req)
      const active = req.query.active
      const cacheKey = `services:${shop_id}:${page}:${pageSize}:${active || 'all'}`
      const cached = fastify.cache.get(cacheKey)
      if (cached !== undefined) return cached
      const activeCond = active === '1' ? ' AND active=1' : active === '0' ? ' AND active=0' : ''
      const countSql = `SELECT COUNT(*) AS total FROM services WHERE shop_id = ?${activeCond}`
      const dataSql = `SELECT * FROM services WHERE shop_id = ?${activeCond} ORDER BY sort_order, name`
      const total = Number(fastify.db.prepare(countSql).get(shop_id).total)
      const rows = fastify.db.prepare(`${dataSql} LIMIT ? OFFSET ?`).all(shop_id, pageSize, offset)
      const result = { data: rows, total, page, pageSize }
      fastify.cache.set(cacheKey, result, 60000)
      return result
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.post('/api/services', async (req, reply) => {
    try {
      requireAdmin(req)
      const shop_id = req.user.shop_id
      const { name, category, duration, price_cents,
        commission_type = 'percent', commission_value = 0, sort_order = 0 } = req.body || {}
      if (!name || duration == null || price_cents == null) {
        throw new ValidationError('missing fields')
      }
      if (!Number.isInteger(Number(price_cents)) || Number(price_cents) < 0) {
        throw new ValidationError('price_cents 必须是非负整数')
      }
      const id = nanoid(10)
      const now = Date.now()
      fastify.db.prepare(`
        INSERT INTO services(id, shop_id, name, category, duration, price_cents,
          commission_type, commission_value, sort_order, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop_id, name, category || null, Number(duration), Number(price_cents),
          commission_type, Number(commission_value), Number(sort_order), now, now)
      const newService = fastify.db.prepare(`SELECT * FROM services WHERE id=?`).get(id)
      fastify.cache.invalidate(`services:${shop_id}:`)
      return newService
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.put('/api/services/:id', async (req, reply) => {
    try {
      requireAdmin(req)
      const { id } = req.params
      const existing = fastify.db.prepare(`SELECT id, shop_id FROM services WHERE id=?`).get(id)
      if (!existing) throw new NotFoundError('not found')
      if (existing.shop_id !== req.user.shop_id) throw new PermissionError('无权限操作该店铺的服务')

      const body = req.body || {}
      // 与 POST 同等校验：防止 PUT 写入负价/NaN
      if (body.price_cents !== undefined && (!Number.isInteger(Number(body.price_cents)) || Number(body.price_cents) < 0)) {
        throw new ValidationError('price_cents 必须是非负整数')
      }
      if (body.commission_type !== undefined && !['percent', 'fixed'].includes(body.commission_type)) {
        throw new ValidationError('commission_type 必须是 percent/fixed')
      }
      if (body.commission_value !== undefined) {
        const cv = Number(body.commission_value)
        if (!Number.isFinite(cv) || cv < 0) throw new ValidationError('commission_value 非法')
      }
      if (body.duration !== undefined) {
        const d = Number(body.duration)
        if (!Number.isInteger(d) || d <= 0) throw new ValidationError('duration 必须是正整数')
      }
      if (body.sort_order !== undefined && !Number.isInteger(Number(body.sort_order))) {
        throw new ValidationError('sort_order 必须是整数')
      }
      if (body.active !== undefined && ![0, 1, true, false, '0', '1'].includes(body.active)) {
        throw new ValidationError('active 非法')
      }

      const fields = ['name', 'category', 'duration', 'price_cents',
        'commission_type', 'commission_value', 'active', 'sort_order']
      const sets = []
      const args = []
      for (const f of fields) {
        if (req.body && req.body[f] !== undefined) {
          sets.push(`${f}=?`)
          args.push(req.body[f])
        }
      }
      if (!sets.length) throw new ValidationError('no fields')
      sets.push(`updated_at=?`)
      args.push(Date.now(), id)
      const r = fastify.db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id=? AND shop_id=?`).run(...args, req.user.shop_id)
      if (r.changes === 0) throw new NotFoundError('not found')
      const updatedService = fastify.db.prepare(`SELECT * FROM services WHERE id=?`).get(id)
      fastify.cache.invalidate(`services:${req.user.shop_id}:`)
      return updatedService
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.delete('/api/services/:id', async (req, reply) => {
    try {
      requireAdmin(req)
      // 软删除：active=0，避免影响历史钟单的外键
      const r = fastify.db.prepare(`UPDATE services SET active=0, updated_at=? WHERE id=? AND shop_id=?`)
        .run(Date.now(), req.params.id, req.user.shop_id)
      if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
      fastify.cache.invalidate(`services:${req.user.shop_id}:`)
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })
}
