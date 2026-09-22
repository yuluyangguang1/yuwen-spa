// 房间/床位

import { nanoid } from 'nanoid'
import { BusinessError, NotFoundError, ValidationError, PermissionError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

export async function registerRoomRoutes(fastify) {
  function requireAdmin(req) {
    if (req.user?.role !== 'admin') throw new PermissionError('仅管理员可操作')
  }

  fastify.get('/api/rooms', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { page, pageSize, offset } = parsePagination(req)
      const active = req.query.active
      const cacheKey = `rooms:${shop_id}:${page}:${pageSize}:${active || 'all'}`
      const cached = fastify.cache.get(cacheKey)
      if (cached !== undefined) return cached
      const activeCond = active === '1' ? ' AND active=1' : active === '0' ? ' AND active=0' : ''
      const countSql = `SELECT COUNT(*) AS total FROM rooms WHERE shop_id = ?${activeCond}`
      const dataSql = `SELECT * FROM rooms WHERE shop_id = ?${activeCond} ORDER BY sort_order, number`
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

  fastify.post('/api/rooms', async (req, reply) => {
    try {
      requireAdmin(req)
      const shop_id = req.user.shop_id
      const { number, type, capacity = 1, sort_order = 0 } = req.body || {}
      if (!number) throw new ValidationError('missing fields')
      const id = nanoid(10)
      const now = Date.now()
      try {
        fastify.db.prepare(`
          INSERT INTO rooms(id, shop_id, number, type, capacity, sort_order, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop_id, number, type || null, capacity, sort_order, now, now)
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
          throw new BusinessError('房号已存在', { code: 'CONFLICT', statusCode: 409 })
        }
        throw e
      }
      const newRoom = fastify.db.prepare(`SELECT * FROM rooms WHERE id=?`).get(id)
      fastify.cache.invalidate(`rooms:${shop_id}:`)
      return newRoom
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.put('/api/rooms/:id', async (req, reply) => {
    try {
      requireAdmin(req)
      const existing = fastify.db.prepare(`SELECT shop_id FROM rooms WHERE id=?`).get(req.params.id)
      if (!existing) throw new NotFoundError('not found')
      if (existing.shop_id !== req.user.shop_id) throw new PermissionError('无权限操作该店铺的房间')
      const body = req.body || {}
      if (body.status !== undefined && !['idle', 'occupied', 'break', 'off'].includes(body.status)) {
        throw new ValidationError('status 必须是 idle/occupied/break/off')
      }
      if (body.capacity !== undefined) {
        const c = Number(body.capacity)
        if (!Number.isInteger(c) || c < 0 || c > 99) throw new ValidationError('capacity 非法')
      }
      if (body.sort_order !== undefined && !Number.isInteger(Number(body.sort_order))) {
        throw new ValidationError('sort_order 必须是整数')
      }
      if (body.active !== undefined && ![0, 1, true, false, '0', '1'].includes(body.active)) {
        throw new ValidationError('active 非法')
      }
      const fields = ['number', 'type', 'capacity', 'status', 'sort_order', 'active']
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
      args.push(Date.now(), req.params.id)
      const r = fastify.db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id=? AND shop_id=?`).run(...args, req.user.shop_id)
      if (r.changes === 0) throw new NotFoundError('not found')
      const room = fastify.db.prepare(`SELECT * FROM rooms WHERE id=?`).get(req.params.id)
      fastify.broadcast({ type: 'room:updated', data: room })
      fastify.cache.invalidate(`rooms:${room.shop_id}:`)
      return room
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })
}
