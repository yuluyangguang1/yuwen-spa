// 预约：customer → 预约 → 到店确认 → 开钟
//
// POST   /api/appointments              员工代客新建（staff，批次3）
// GET    /api/appointments              列表（staff）
// POST   /api/appointments/:id/confirm  确认到店（staff）
// POST   /api/appointments/:id/cancel   取消（staff）
// POST   /api/appointments/:id/open     由预约开钟（staff）→ 创建 pending/active 钟单
// GET    /api/guest/appointments        顾客按房间查今日预约（公开）
// POST   /api/guest/appointments        顾客提交预约（公开，限流）

import { nanoid } from 'nanoid'
import {
  NotFoundError, ValidationError, ConflictError, PermissionError,
} from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'
import { requireObject, requireString, requireInt, optionalInt, optionalString } from '../lib/validate.js'
import { checkRateLimit } from '../auth/ratelimit.js'

const STATUS_LABEL = {
  pending: '待确认', confirmed: '已确认', canceled: '已取消', completed: '已完成',
}

export async function registerAppointmentRoutes(fastify) {
  const db = fastify.db
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }

  function defaultShop() {
    return db.prepare(`SELECT * FROM shops ORDER BY created_at LIMIT 1`).get()
  }

  function withJoins(row) {
    if (!row) return row
    const tech = row.technician_id
      ? db.prepare(`SELECT id, name, number FROM technicians WHERE id=?`).get(row.technician_id)
      : null
    const svc = row.service_id
      ? db.prepare(`SELECT id, name, price_cents, duration FROM services WHERE id=?`).get(row.service_id)
      : null
    const room = row.room_id
      ? db.prepare(`SELECT id, number FROM rooms WHERE id=?`).get(row.room_id)
      : null
    return {
      ...row,
      status_label: STATUS_LABEL[row.status] || row.status,
      technician_name: tech?.name || null,
      technician_number: tech?.number || null,
      service_name: svc?.name || null,
      service_price_cents: svc?.price_cents ?? null,
      room_number: room?.number || null,
    }
  }

  // 区间重叠检查（旧实现只用新单时长比较 ABS，会漏掉「新单落在旧单中间」）
  // 区间 [start, start + durationMin*60000) 与已有单 [O, O + duration_min*60000) 相交即冲突
  function findApptConflict({ shopId, technicianId, roomId, start, durationMin, excludeId = null }) {
    const conds = [`status IN ('pending','confirmed')`, `shop_id=?`,
      `scheduled_at < ?`, `scheduled_at + duration_min * 60000 > ?`]
    const args = [shopId, start + durationMin * 60000, start]
    if (technicianId) { conds.push('technician_id=?'); args.push(technicianId) }
    if (roomId) { conds.push('room_id=?'); args.push(roomId) }
    if (excludeId) { conds.push('id!=?'); args.push(excludeId) }
    return db.prepare(`SELECT id FROM appointments WHERE ${conds.join(' AND ')} LIMIT 1`).get(...args)
  }

  function assertNoConflict(shopId, technicianId, roomId, start, durationMin, excludeId = null) {
    if (technicianId) {
      const c = findApptConflict({ shopId, technicianId, start, durationMin, excludeId })
      if (c) throw new ConflictError('该技师该时段已有预约')
    }
    if (roomId) {
      const c = findApptConflict({ shopId, roomId, start, durationMin, excludeId })
      if (c) throw new ConflictError('该房间该时段已有预约')
    }
  }

  // ── 员工代客新建预约（批次3）────────────────
  fastify.post('/api/appointments', staffOnly, async (req, reply) => {
    try {
      requireObject(req.body)
      const shop_id = req.user.shop_id

      const scheduled_at = requireInt(req.body.scheduled_at, 'scheduled_at', { min: Date.now() - 3600000 })
      const service_id = optionalString(req.body.service_id, 'service_id', { max: 64 })
      const technician_id = optionalString(req.body.technician_id, 'technician_id', { max: 64 })
      const room_id = optionalString(req.body.room_id, 'room_id', { max: 64 })
      const customer_id = optionalString(req.body.customer_id, 'customer_id', { max: 64 })
      const customer_phone = optionalString(req.body.customer_phone, 'customer_phone', { max: 32 })
      const notes = optionalString(req.body.notes, 'notes', { max: 500 })
      const duration_min = optionalInt(req.body.duration_min, 'duration_min', { min: 15, max: 480 }) ?? 60

      let customer_name = optionalString(req.body.customer_name, 'customer_name', { max: 64 })
      if (customer_id) {
        const c = db.prepare(`SELECT id, name, phone FROM customers WHERE id=? AND shop_id=?`).get(customer_id, shop_id)
        if (!c) throw new NotFoundError('customer not found')
        customer_name = customer_name || c.name
      }
      if (!customer_name) throw new ValidationError('customer_name required')

      if (room_id) {
        const room = db.prepare(`SELECT id FROM rooms WHERE id=? AND shop_id=? AND active=1`).get(room_id, shop_id)
        if (!room) throw new NotFoundError('room not found')
      }
      if (service_id) {
        const svc = db.prepare(`SELECT id FROM services WHERE id=? AND shop_id=? AND active=1`).get(service_id, shop_id)
        if (!svc) throw new NotFoundError('service not found')
      }
      if (technician_id) {
        const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=? AND active=1`).get(technician_id, shop_id)
        if (!tech) throw new NotFoundError('technician not found')
      }
      assertNoConflict(shop_id, technician_id, room_id, scheduled_at, duration_min)

      const now = Date.now()
      const id = nanoid(12)
      db.prepare(`
        INSERT INTO appointments(id, shop_id, customer_id, technician_id, service_id, room_id,
          customer_name, customer_phone, notes, scheduled_at, duration_min, status,
          created_by, source, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'staff', ?, ?)
      `).run(id, shop_id, customer_id, technician_id, service_id, room_id,
             customer_name, customer_phone, notes, scheduled_at, duration_min,
             req.user.sub || null, now, now)

      db.prepare(`
        INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
        VALUES(?, ?, ?, 'appointment.create', 'appointment', ?, ?, ?)
      `).run(nanoid(10), shop_id, req.user.sub || null, id,
             JSON.stringify({
               customer_id, customer_name, technician_id, service_id, room_id,
               scheduled_at, duration_min, source: 'staff',
             }), now)

      return withJoins(db.prepare(`SELECT * FROM appointments WHERE id=?`).get(id))
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '创建预约失败' })
    }
  })

  // ── 员工端列表 ────────────────────────────
  fastify.get('/api/appointments', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const { page, pageSize, offset } = parsePagination(req)
    const { status, date_from, date_to, technician_id } = req.query

    const where = ['a.shop_id=?']
    const args = [shop_id]
    if (status) { where.push('a.status=?'); args.push(String(status)) }
    if (date_from) { where.push('a.scheduled_at>=?'); args.push(Number(date_from)) }
    if (date_to) { where.push('a.scheduled_at<=?'); args.push(Number(date_to)) }
    if (technician_id) { where.push('a.technician_id=?'); args.push(String(technician_id)) }
    const whereSql = ` AND ${where.join(' AND ')}`

    const total = Number(db.prepare(
      `SELECT COUNT(*) AS total FROM appointments a WHERE 1=1${whereSql}`
    ).get(...args)?.total ?? 0)

    const rows = db.prepare(`
      SELECT a.* FROM appointments a
      WHERE 1=1${whereSql}
      ORDER BY a.scheduled_at DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset)

    return { data: rows.map(withJoins), total, page, pageSize }
  })

  // ── 确认到店 ──────────────────────────────
  fastify.post('/api/appointments/:id/confirm', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const appt = db.prepare(`SELECT * FROM appointments WHERE id=? AND shop_id=?`)
      .get(req.params.id, shop_id)
    if (!appt) throw new NotFoundError('not found')
    if (appt.status !== 'pending') throw new ConflictError(`当前状态不可确认（${STATUS_LABEL[appt.status]}）`)
    const now = Date.now()
    db.prepare(`UPDATE appointments SET status='confirmed', updated_at=? WHERE id=?`).run(now, appt.id)
    db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?,?,?,?, 'appointment', ?, ?, ?)
    `).run(nanoid(10), shop_id, req.user.sub, 'appointment.confirm', appt.id,
           JSON.stringify({ scheduled_at: appt.scheduled_at }), now)
    return withJoins(db.prepare(`SELECT * FROM appointments WHERE id=?`).get(appt.id))
  })

  // ── 取消 ──────────────────────────────────
  fastify.post('/api/appointments/:id/cancel', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const appt = db.prepare(`SELECT * FROM appointments WHERE id=? AND shop_id=?`)
      .get(req.params.id, shop_id)
    if (!appt) throw new NotFoundError('not found')
    if (appt.status === 'completed' || appt.status === 'canceled') {
      throw new ConflictError('该预约已结束')
    }
    const now = Date.now()
    db.prepare(`UPDATE appointments SET status='canceled', updated_at=? WHERE id=?`).run(now, appt.id)
    db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?,?,?,?, 'appointment', ?, ?, ?)
    `).run(nanoid(10), shop_id, req.user.sub, 'appointment.cancel', appt.id, '{}', now)
    return withJoins(db.prepare(`SELECT * FROM appointments WHERE id=?`).get(appt.id))
  })

  // ── 由预约开钟 ────────────────────────────
  // 确认预约 → 创建钟单（pending 或 auto_start=active），预约标记 completed 并挂 ticket_id
  fastify.post('/api/appointments/:id/open', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const appt = db.prepare(`SELECT * FROM appointments WHERE id=? AND shop_id=?`)
      .get(req.params.id, shop_id)
    if (!appt) throw new NotFoundError('not found')
    if (appt.status === 'canceled') throw new ConflictError('预约已取消')
    if (appt.status === 'completed' && appt.ticket_id) throw new ConflictError('已开过钟')

    const body = req.body || {}
    const room_id = body.room_id || appt.room_id || null
    const technician_id = body.technician_id || appt.technician_id || null
    const service_id = body.service_id || appt.service_id || null
    const auto_start = body.auto_start !== false
    const customer_id = appt.customer_id || null

    if (!service_id) throw new ValidationError('service_id required')
    const service = db.prepare(`SELECT * FROM services WHERE id=? AND shop_id=? AND active=1`)
      .get(service_id, shop_id)
    if (!service) throw new NotFoundError('service not found')

    if (room_id) {
      const room = db.prepare(`SELECT id FROM rooms WHERE id=? AND shop_id=?`).get(room_id, shop_id)
      if (!room) throw new NotFoundError('room not found')
    }
    if (technician_id) {
      const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=?`).get(technician_id, shop_id)
      if (!tech) throw new NotFoundError('technician not found')
    }

    const price = service.price_cents
    const commission_type = service.commission_type || 'percent'
    const commission_value = service.commission_value || 0
    const commissionCents = commission_type === 'percent'
      ? Math.round((price * commission_value) / 10000)
      : commission_value

    const id = nanoid(12)
    const now = Date.now()
    const status = auto_start ? 'active' : 'pending'

    db.transaction(() => {
      if (room_id && auto_start) {
        const busy = db.prepare(
          `SELECT 1 FROM tickets WHERE room_id=? AND status IN ('pending','active') AND id!=?`
        ).get(room_id, id)
        if (busy) throw new ConflictError('房间已被占用')
      }
      if (technician_id && auto_start) {
        const busy = db.prepare(
          `SELECT 1 FROM tickets WHERE technician_id=? AND status IN ('pending','active') AND id!=?`
        ).get(technician_id, id)
        if (busy) throw new ConflictError('技师正在上钟')
      }

      db.prepare(`
        INSERT INTO tickets(id, shop_id, customer_id, technician_id, room_id, service_id,
          status, fulfillment, price_cents, commission_cents, started_at, notes, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?, 'onsite', ?,?,?,?,?,?)
      `).run(id, shop_id, customer_id, technician_id, room_id, service_id,
             status, price, commissionCents,
             auto_start ? now : null, appt.notes || null, now, now)

      if (room_id && auto_start) {
        db.prepare(`UPDATE rooms SET status='occupied', updated_at=? WHERE id=?`).run(now, room_id)
      }
      if (technician_id && auto_start) {
        db.prepare(`UPDATE technicians SET status='working', updated_at=? WHERE id=?`).run(now, technician_id)
      }

      db.prepare(`UPDATE appointments SET status='completed', ticket_id=?, updated_at=? WHERE id=?`)
        .run(id, now, appt.id)

      db.prepare(`
        INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
        VALUES(?,?,?,?, 'appointment', ?, ?, ?)
      `).run(nanoid(10), shop_id, req.user.sub, 'appointment.open', appt.id,
             JSON.stringify({ ticket_id: id, room_id, technician_id }), now)
    })()

    const ticket = db.prepare(`
      SELECT t.*, s.name AS service_name, tech.name AS technician_name, tech.number AS technician_number,
        r.number AS room_number
      FROM tickets t
      LEFT JOIN services s ON t.service_id=s.id
      LEFT JOIN technicians tech ON t.technician_id=tech.id
      LEFT JOIN rooms r ON t.room_id=r.id
      WHERE t.id=?
    `).get(id)
    fastify.broadcast({ type: 'ticket:created', shop_id, data: ticket })
    return ticket
  })

  // ── 改期 / 改技师（日历拖拽）──────────────
  fastify.post('/api/appointments/:id/reschedule', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const appt = db.prepare(`SELECT * FROM appointments WHERE id=? AND shop_id=?`)
      .get(req.params.id, shop_id)
    if (!appt) throw new NotFoundError('not found')
    if (appt.status === 'completed' || appt.status === 'canceled') {
      throw new ConflictError('该预约已结束')
    }

    const body = req.body || {}
    const scheduled_at = body.scheduled_at != null
      ? requireInt(body.scheduled_at, 'scheduled_at', { min: Date.now() - 3600000 })
      : appt.scheduled_at
    const technician_id = body.technician_id !== undefined
      ? (body.technician_id ? requireString(body.technician_id, 'technician_id', { max: 64 }) : null)
      : appt.technician_id
    const duration_min = body.duration_min != null
      ? requireInt(body.duration_min, 'duration_min', { min: 15, max: 480 })
      : appt.duration_min

    if (technician_id) {
      const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=? AND active=1`)
        .get(technician_id, shop_id)
      if (!tech) throw new NotFoundError('technician not found')
    }
    // 技师 + 房间都按新时间/新时长做区间重叠检查（排除自身）
    assertNoConflict(shop_id, technician_id, appt.room_id, scheduled_at, duration_min, appt.id)

    const now = Date.now()
    db.prepare(`
      UPDATE appointments SET scheduled_at=?, technician_id=?, duration_min=?, updated_at=?
      WHERE id=?
    `).run(scheduled_at, technician_id, duration_min, now, appt.id)
    db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?,?,?,?, 'appointment', ?, ?, ?)
    `).run(nanoid(10), shop_id, req.user.sub, 'appointment.reschedule', appt.id,
           JSON.stringify({
             from: { scheduled_at: appt.scheduled_at, technician_id: appt.technician_id },
             to: { scheduled_at, technician_id },
           }), now)
    return withJoins(db.prepare(`SELECT * FROM appointments WHERE id=?`).get(appt.id))
  })

  // ── 顾客端：按房间查今日+未来7天预约 ──────
  fastify.get('/api/guest/appointments', async (req) => {
    const { room_id } = req.query
    if (!room_id) throw new ValidationError('room_id required')
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = start.getTime() + 7 * 86400000
    const rows = db.prepare(`
      SELECT id, room_id, technician_id, service_id, customer_name, notes,
        scheduled_at, duration_min, status, created_at
      FROM appointments
      WHERE room_id=? AND scheduled_at>=? AND scheduled_at<? AND status IN ('pending','confirmed')
      ORDER BY scheduled_at
    `).all(room_id, start.getTime(), end)
    return { data: rows.map(withJoins), total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
  })

  // ── 顾客端：提交预约 ──────────────────────
  fastify.post('/api/guest/appointments', async (req, reply) => {
    try {
      const rl = checkRateLimit(`guest:appt:${req.ip}`, { maxAttempts: 10, windowMs: 10 * 60 * 1000 })
      if (!rl.ok) {
        return reply.code(429).send({ error: `预约过于频繁，请 ${rl.retryAfter} 秒后重试`, code: 'RATE_LIMITED' })
      }
      requireObject(req.body)
      const shop = defaultShop()
      if (!shop) throw new NotFoundError('门店不存在')

      const room_id = requireString(req.body.room_id, 'room_id', { max: 64 })
      const scheduled_at = requireInt(req.body.scheduled_at, 'scheduled_at', { min: Date.now() - 3600000 })
      const service_id = optionalString(req.body.service_id, 'service_id', { max: 64 })
      const technician_id = optionalString(req.body.technician_id, 'technician_id', { max: 64 })
      const customer_name = requireString(req.body.customer_name, 'customer_name', { max: 64 })
      const customer_phone = optionalString(req.body.customer_phone, 'customer_phone', { max: 32 })
      const notes = optionalString(req.body.notes, 'notes', { max: 500 })
      const duration_min = optionalInt(req.body.duration_min, 'duration_min', { min: 15, max: 480 }) ?? 60

      const room = db.prepare(`SELECT id FROM rooms WHERE id=? AND shop_id=? AND active=1`).get(room_id, shop.id)
      if (!room) throw new NotFoundError('room not found')
      if (service_id) {
        const svc = db.prepare(`SELECT id FROM services WHERE id=? AND shop_id=? AND active=1`).get(service_id, shop.id)
        if (!svc) throw new NotFoundError('service not found')
      }
      if (technician_id) {
        const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=? AND active=1`).get(technician_id, shop.id)
        if (!tech) throw new NotFoundError('technician not found')
      }
      // 同技师/同房间时段冲突（区间相交判定）
      assertNoConflict(shop.id, technician_id, room_id, scheduled_at, duration_min)

      const now = Date.now()
      const id = nanoid(12)
      db.prepare(`
        INSERT INTO appointments(id, shop_id, customer_id, technician_id, service_id, room_id,
          customer_name, customer_phone, notes, scheduled_at, duration_min, status, created_by, source, created_at, updated_at)
        VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 'guest', ?, ?)
      `).run(id, shop.id, technician_id, service_id, room_id,
             customer_name, customer_phone, notes, scheduled_at, duration_min, now, now)

      db.prepare(`
        INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
        VALUES(?, ?, NULL, 'appointment.create', 'appointment', ?, ?, ?)
      `).run(nanoid(10), shop.id, id,
             JSON.stringify({
               customer_name, technician_id, service_id, room_id,
               scheduled_at, duration_min, source: 'guest',
             }), now)

      return { ok: true, id, scheduled_at, status: 'pending' }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '预约失败', code: 'INTERNAL_ERROR' })
    }
  })
}
