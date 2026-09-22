// 顾客端公开 API（免登录，白名单 /api/guest/*）
//
// 扫码顾客没有 token，原先 GuestView 打受保护接口会 401。
// 这里提供脱敏的只读列表 + 自助下单入口。

import { nanoid } from 'nanoid'
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js'
import { notifyTicketCreated } from '../notify/index.js'

export async function registerGuestRoutes(fastify) {
  const db = fastify.db

  // 默认门店（单店模式取第一家）
  function defaultShop() {
    return db.prepare(`SELECT * FROM shops ORDER BY created_at LIMIT 1`).get()
  }

  // ── 房间列表 ────────────────────────────
  fastify.get('/api/guest/rooms', async (req, reply) => {
    try {
      const rows = db.prepare(
        `SELECT id, shop_id, number, type, capacity, status FROM rooms WHERE active=1 ORDER BY sort_order, number`
      ).all()
      return { data: rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 单个房间 ────────────────────────────
  fastify.get('/api/guest/rooms/:id', async (req, reply) => {
    try {
      const room = db.prepare(
        `SELECT id, shop_id, number, type, capacity, status FROM rooms WHERE id=? AND active=1`
      ).get(req.params.id)
      if (!room) throw new NotFoundError('房间不存在')
      return room
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 技师列表（脱敏，不含 phone/webhook）──
  fastify.get('/api/guest/technicians', async (req, reply) => {
    try {
      const rows = db.prepare(`
        SELECT id, shop_id, number, name, level, years, status, ai_score, avg_rating, review_count, avatar, bio, specialties
        FROM technicians WHERE active=1 ORDER BY number
      `).all()
      return { data: rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 服务项目 ────────────────────────────
  fastify.get('/api/guest/services', async (req, reply) => {
    try {
      const rows = db.prepare(`
        SELECT id, shop_id, name, category, duration, price_cents, sort_order
        FROM services WHERE active=1 ORDER BY sort_order, name
      `).all()
      return { data: rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 门店信息（脱敏）─────────────────────
  fastify.get('/api/guest/shops/current', async (req, reply) => {
    try {
      const shop = defaultShop()
      if (!shop) return null
      return { id: shop.id, name: shop.name, address: shop.address }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 某房间今日钟单（公开给顾客看进度）──
  fastify.get('/api/guest/tickets', async (req, reply) => {
    try {
      const { room_id, shop_id } = req.query
      if (!room_id && !shop_id) throw new ValidationError('room_id required')
      const start = startOfDay(Date.now())
      let sql = `
        SELECT t.id, t.room_id, t.status, t.fulfillment, t.service_id, t.technician_id,
          t.price_cents, t.started_at,
          s.name AS service_name, s.duration AS service_duration,
          tech.name AS technician_name, tech.number AS technician_number,
          r.number AS room_number, r.type AS room_type
        FROM tickets t
        LEFT JOIN services s ON t.service_id=s.id
        LEFT JOIN technicians tech ON t.technician_id=tech.id
        LEFT JOIN rooms r ON t.room_id=r.id
        WHERE t.created_at>=? AND t.status IN ('pending','active','completed')
      `
      const args = [start]
      if (room_id) { sql += ' AND t.room_id=?'; args.push(room_id) }
      if (shop_id) { sql += ' AND t.shop_id=?'; args.push(shop_id) }
      sql += ' ORDER BY t.created_at DESC LIMIT 100'
      const rows = db.prepare(sql).all(...args)
      return { data: rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 顾客自助下单（自提/扫码开钟）────────
  fastify.post('/api/guest/tickets', async (req, reply) => {
    try {
      const { shop_id: bodyShop, service_id, technician_id, room_id, auto_start = false } = req.body || {}
      const shop = bodyShop
        ? db.prepare(`SELECT * FROM shops WHERE id=?`).get(bodyShop)
        : defaultShop()
      if (!shop) throw new NotFoundError('门店不存在')

      if (!service_id) throw new ValidationError('service_id required')
      const service = db.prepare(
        `SELECT * FROM services WHERE id=? AND shop_id=? AND active=1`
      ).get(service_id, shop.id)
      if (!service) throw new NotFoundError('service not found')

      if (room_id) {
        const room = db.prepare(`SELECT id, status FROM rooms WHERE id=? AND shop_id=? AND active=1`)
          .get(room_id, shop.id)
        if (!room) throw new NotFoundError('room not found')
        if (auto_start && room.status === 'occupied') throw new ConflictError('房间已被占用')
      }
      if (technician_id) {
        const tech = db.prepare(`SELECT id, status FROM technicians WHERE id=? AND shop_id=? AND active=1`)
          .get(technician_id, shop.id)
        if (!tech) throw new NotFoundError('technician not found')
        if (auto_start && tech.status === 'working') throw new ConflictError('技师正在上钟')
      }

      const id = nanoid(12)
      const now = Date.now()
      const status = auto_start ? 'active' : 'pending'
      const price = service.price_cents
      const commission = service.commission_type === 'fixed'
        ? service.commission_value
        : Math.round((price * service.commission_value) / 10000)

      db.transaction(() => {
        db.prepare(`
          INSERT INTO tickets(id, shop_id, customer_id, technician_id, room_id, service_id,
            status, fulfillment, price_cents, commission_cents, started_at, notes, created_at, updated_at)
          VALUES(?, ?, NULL, ?, ?, ?, ?, 'self', ?, ?, ?, ?, ?, ?)
        `).run(id, shop.id, technician_id || null, room_id || null,
              service_id, status, price, commission,
              auto_start ? now : null, '顾客扫码自助', now, now)

        if (room_id && auto_start) {
          db.prepare(`UPDATE rooms SET status='occupied', updated_at=? WHERE id=?`).run(now, room_id)
        }
        if (technician_id && auto_start) {
          db.prepare(`UPDATE technicians SET status='working', updated_at=? WHERE id=?`).run(now, technician_id)
        }
      })()

      const ticket = db.prepare(`SELECT t.*, s.name AS service_name FROM tickets t
        LEFT JOIN services s ON t.service_id=s.id WHERE t.id=?`).get(id)
      fastify.broadcast({ type: 'ticket:created', shop_id: shop.id, data: ticket })
      const tech = technician_id
        ? db.prepare(`SELECT webhook_url FROM technicians WHERE id=?`).get(technician_id)
        : null
      notifyTicketCreated(ticket, tech?.webhook_url).catch(() => {})
      return ticket
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
