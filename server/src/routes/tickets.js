// 钟单：核心实体
//
// 状态机：
//   pending   -> active     (开钟，技师开始服务)
//   active    -> completed  (服务完成，等待结账)
//   completed -> paid       (结账)
//   *         -> canceled   (取消)

import { nanoid } from 'nanoid'
import { BusinessError, NotFoundError, ValidationError, PermissionError, ConflictError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { notifyTicketCreated, notifyTicketPaid, notifyBigTicket } from '../notify/index.js'

export async function registerTicketRoutes(fastify) {
  const db = fastify.db

  // ── 列表（带过滤 + 分页）─────────────────────────────
  fastify.get('/api/tickets', async (req, reply) => {
    try {
      const { status, technician_id, date_from, date_to } = req.query
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError()
      const { page, pageSize, offset } = parsePagination(req)
      const limitRaw = Number(req.query.limit)
      const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : pageSize

      let sql = `
        SELECT t.*,
          s.name AS service_name, s.duration AS service_duration,
          tech.name AS technician_name, tech.number AS technician_number,
          r.number AS room_number,
          c.name AS customer_name, c.phone AS customer_phone
        FROM tickets t
        LEFT JOIN services s ON t.service_id=s.id
        LEFT JOIN technicians tech ON t.technician_id=tech.id
        LEFT JOIN rooms r ON t.room_id=r.id
        LEFT JOIN customers c ON t.customer_id=c.id
        WHERE 1=1
      `
      const args = []
      if (shop_id) { sql += ` AND t.shop_id=?`; args.push(shop_id) }
      if (status) {
        const list = String(status).split(',')
        sql += ` AND t.status IN (${list.map(() => '?').join(',')})`
        args.push(...list)
      }
      if (technician_id) { sql += ` AND t.technician_id=?`; args.push(technician_id) }
      if (date_from) { sql += ` AND t.created_at>=?`; args.push(Number(date_from)) }
      if (date_to) { sql += ` AND t.created_at<=?`; args.push(Number(date_to)) }

      let countSql = `SELECT COUNT(*) AS total FROM tickets t WHERE 1=1`
      const countArgs = []
      if (shop_id) { countSql += ` AND t.shop_id=?`; countArgs.push(shop_id) }
      if (status) {
        const list = String(status).split(',')
        countSql += ` AND t.status IN (${list.map(() => '?').join(',')})`
        countArgs.push(...list)
      }
      if (technician_id) { countSql += ` AND t.technician_id=?`; countArgs.push(technician_id) }
      if (date_from) { countSql += ` AND t.created_at>=?`; countArgs.push(Number(date_from)) }
      if (date_to) { countSql += ` AND t.created_at<=?`; countArgs.push(Number(date_to)) }

      const totalResult = db.prepare(countSql).get(...countArgs)
      const total = Number(totalResult.total)
      const rows = db.prepare(`${sql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)

      return { data: rows, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 今日台子看板（分页）──────────────────────────────
  fastify.get('/api/tickets/today', async (req, reply) => {
    try {
      const { shop_id } = req.query
      const { page = 1, pageSize = 50 } = parsePagination(req)
      const effShopId = req.user?.shop_id || shop_id
      const start = startOfDay(Date.now())
      const offset = (page - 1) * pageSize

      const sql = `
        SELECT t.*,
          s.name AS service_name, s.duration AS service_duration,
          tech.name AS technician_name, tech.number AS technician_number,
          r.number AS room_number, r.type AS room_type,
          c.name AS customer_name, c.phone AS customer_phone
        FROM tickets t
        LEFT JOIN services s ON t.service_id=s.id
        LEFT JOIN technicians tech ON t.technician_id=tech.id
        LEFT JOIN rooms r ON t.room_id=r.id
        LEFT JOIN customers c ON t.customer_id=c.id
        WHERE ${effShopId ? `t.shop_id=? AND ` : ''}t.created_at>=?
        ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
      const args = effShopId ? [effShopId, start, pageSize, offset] : [start, pageSize, offset]
      const totalSql = `SELECT COUNT(*) AS total FROM tickets t WHERE ${effShopId ? `t.shop_id=? AND ` : ''}t.created_at>=?`
      const totalArgs = effShopId ? [effShopId, start] : [start]
      const totalResult = db.prepare(totalSql).get(...totalArgs)

      return { data: db.prepare(sql).all(...args), total: Number(totalResult.total), page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 创建钟单（开钟）─────────────────────────────────
  fastify.post('/api/tickets', async (req, reply) => {
      try {
        const { shop_id, customer_id, technician_id, room_id, service_id,
          price_cents: priceOverride, notes, auto_start = true, fulfillment = 'onsite' } = req.body || {}

        if (!shop_id || !req.user?.shop_id || shop_id !== req.user.shop_id) {
          throw new PermissionError('无权限访问该店铺')
        }
        if (!service_id) {
          throw new ValidationError('service_id required')
        }
        if (!['onsite', 'self'].includes(fulfillment)) {
          throw new ValidationError('fulfillment 必须是 onsite/self')
        }

        const service = db.prepare(`SELECT * FROM services WHERE id=? AND shop_id=? AND active=1`).get(service_id, shop_id)
        if (!service) throw new NotFoundError('service not found')

        // 关联实体必须属于本店，防止跨店占用房间/技师/会员钱包
        if (room_id) {
          const room = db.prepare(`SELECT id FROM rooms WHERE id=? AND shop_id=?`).get(room_id, shop_id)
          if (!room) throw new NotFoundError('room not found')
        }
        if (technician_id) {
          const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=?`).get(technician_id, shop_id)
          if (!tech) throw new NotFoundError('technician not found')
        }
        if (customer_id) {
          const customer = db.prepare(`SELECT id FROM customers WHERE id=? AND shop_id=?`).get(customer_id, shop_id)
          if (!customer) throw new NotFoundError('customer not found')
        }

        let finalPrice = priceOverride != null ? Number(priceOverride) : service.price_cents
        if (!Number.isInteger(finalPrice) || finalPrice < 0) throw new ValidationError('price_cents 非法')
        const commissionCents = computeCommission(finalPrice, service)
        const id = nanoid(12)
        const now = Date.now()
        const status = auto_start ? 'active' : 'pending'

        db.transaction(() => {
          // 占用校验：同房间/同技师不允许并行开钟
          if (room_id && auto_start) {
            const busy = db.prepare(`SELECT 1 FROM tickets WHERE room_id=? AND status IN ('pending','active') AND id!=?`).get(room_id, id)
            if (busy) throw new ConflictError('房间已被占用')
          }
          if (technician_id && auto_start) {
            const busy = db.prepare(`SELECT 1 FROM tickets WHERE technician_id=? AND status IN ('pending','active') AND id!=?`).get(technician_id, id)
            if (busy) throw new ConflictError('技师正在上钟')
          }

          db.prepare(`
            INSERT INTO tickets(id, shop_id, customer_id, technician_id, room_id, service_id,
              status, fulfillment, price_cents, commission_cents, started_at, notes, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, shop_id, customer_id || null, technician_id || null, room_id || null,
                service_id, status, fulfillment, finalPrice, commissionCents,
                auto_start ? now : null, notes || null, now, now)

          if (room_id && auto_start) {
            db.prepare(`UPDATE rooms SET status='occupied', updated_at=? WHERE id=?`).run(now, room_id)
          }
          if (technician_id && auto_start) {
            db.prepare(`UPDATE technicians SET status='working', updated_at=? WHERE id=?`).run(now, technician_id)
          }
        })()

        const ticket = getTicketWithJoins(db, id)
        fastify.broadcast({ type: 'ticket:created', shop_id, data: ticket })
        const tech = technician_id ? db.prepare(`SELECT webhook_url FROM technicians WHERE id=?`).get(technician_id) : null
        notifyTicketCreated(ticket, tech?.webhook_url).catch(() => {})
        notifyBigTicket(ticket).catch(() => {})
        return ticket
      } catch (e) {
        req.log.error(e)
        if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
        return reply.code(500).send({ error: '服务器内部错误' })
      }
    })

  // ── 状态转移 ──────────────────────────────────────
  fastify.post('/api/tickets/:id/start', async (req, reply) => {
    try { return changeStatus(fastify, req, reply, 'active', { setStartedAt: true }) }
    catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/tickets/:id/complete', async (req, reply) => {
    try { return changeStatus(fastify, req, reply, 'completed', { setCompletedAt: true, freeRoom: true, freeTech: true }) }
    catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/tickets/:id/cancel', async (req, reply) => {
    try { return changeStatus(fastify, req, reply, 'canceled', { freeRoom: true, freeTech: true }) }
    catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 结账 ──────────────────────────────────────────
  fastify.post('/api/tickets/:id/pay', async (req, reply) => {
    try {
      const { payment_method = 'cash', amount_cents } = req.body || {}
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      if (ticket.shop_id !== req.user?.shop_id) throw new PermissionError('无权限操作该钟单')
      if (ticket.status === 'paid') throw new ConflictError('已结账')
      if (ticket.status === 'canceled') throw new ConflictError('已取消')

      // 金额必须是 [0, 原价] 内的整数分：防止负数给会员反向充值
      let finalAmount = ticket.price_cents
      if (amount_cents != null) {
        const n = Number(amount_cents)
        if (!Number.isInteger(n) || n < 0 || n > ticket.price_cents) {
          throw new ValidationError('amount_cents 必须是 0 到订单金额之间的整数')
        }
        finalAmount = n
      }
      const now = Date.now()

      try {
        db.transaction(() => {
          if (payment_method === 'balance') {
            if (!ticket.customer_id) throw new ValidationError('余额支付需要顾客')
            const customer = db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`).get(ticket.customer_id, ticket.shop_id)
            if (!customer) throw new NotFoundError('顾客不存在')
            if (customer.balance_cents < finalAmount) throw new ValidationError('余额不足')

            const newBalance = customer.balance_cents - finalAmount
            db.prepare(`UPDATE customers SET balance_cents=?, total_spent_cents=total_spent_cents+?, visit_count=visit_count+1, last_visit_at=?, updated_at=? WHERE id=?`)
              .run(newBalance, finalAmount, now, now, customer.id)
            db.prepare(`INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents, balance_after, ticket_id, created_at) VALUES(?, ?, ?, 'consume', ?, ?, ?, ?)`)
              .run(nanoid(12), ticket.shop_id, customer.id, -finalAmount, newBalance, ticket.id, now)
          } else if (ticket.customer_id) {
            db.prepare(`UPDATE customers SET total_spent_cents=total_spent_cents+?, visit_count=visit_count+1, last_visit_at=?, updated_at=? WHERE id=?`)
              .run(finalAmount, now, now, ticket.customer_id)
          }

          db.prepare(`UPDATE tickets SET status='paid', paid_at=?, payment_method=?, price_cents=?, commission_cents=?, updated_at=? WHERE id=?`)
            .run(now, payment_method, finalAmount, recomputeCommission(db, ticket, finalAmount), now, ticket.id)

          if (ticket.room_id) db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
          if (ticket.technician_id) db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)

          db.prepare(`INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at) VALUES(?, ?, 'ticket.pay', 'ticket', ?, ?, ?)`)
            .run(nanoid(10), ticket.shop_id, ticket.id, JSON.stringify({ payment_method, amount_cents: finalAmount }), now)
        })()
      } catch (e) {
        throw e  // BusinessError will be caught below
      }

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: 'ticket:paid', shop_id: ticket.shop_id, data: t })
      const tech = t.technician_id ? db.prepare(`SELECT webhook_url FROM technicians WHERE id=?`).get(t.technician_id) : null
      notifyTicketPaid(t, tech?.webhook_url).catch(() => {})
      return t
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}

// ── helpers ──────────────────────────────────

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function computeCommission(priceCents, service) {
  if (service.commission_type === 'fixed') return service.commission_value
  return Math.round((priceCents * service.commission_value) / 10000)
}

function recomputeCommission(db, ticket, priceCents) {
  if (!ticket.technician_id) return 0
  const service = db.prepare(`SELECT commission_type, commission_value FROM services WHERE id=?`).get(ticket.service_id)
  if (!service) return ticket.commission_cents || 0
  return computeCommission(priceCents, service)
}

// 状态机：只允许这些 from -> to 转移
const STATUS_TRANSITIONS = {
  pending: new Set(['active', 'canceled']),
  active: new Set(['completed', 'canceled']),
  completed: new Set(['paid', 'canceled']),
  paid: new Set(),
  canceled: new Set(),
}

function getTicketWithJoins(db, id) {
  return db.prepare(`SELECT t.*, s.name AS service_name, s.duration AS service_duration, tech.name AS technician_name, tech.number AS technician_number, r.number AS room_number, r.type AS room_type, c.name AS customer_name, c.phone AS customer_phone FROM tickets t LEFT JOIN services s ON t.service_id=s.id LEFT JOIN technicians tech ON t.technician_id=tech.id LEFT JOIN rooms r ON t.room_id=r.id LEFT JOIN customers c ON t.customer_id=c.id WHERE t.id=?`).get(id)
}

function changeStatus(fastify, req, reply, target, opts = {}) {
    try {
      const db = fastify.db
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      if (ticket.shop_id !== req.user?.shop_id) throw new PermissionError('无权限操作该钟单')
      if (ticket.status === target) return getTicketWithJoins(db, ticket.id)
      const allowed = STATUS_TRANSITIONS[ticket.status]
      if (!allowed || !allowed.has(target)) {
        throw new ConflictError(`不能从 ${ticket.status} 转到 ${target}`)
      }

      const now = Date.now()
      const sets = ['status=?', 'updated_at=?']
      const args = [target, now]
      if (opts.setStartedAt && !ticket.started_at) { sets.push('started_at=?'); args.push(now) }
      if (opts.setCompletedAt) { sets.push('completed_at=?'); args.push(now) }
      args.push(ticket.id)

      db.transaction(() => {
        db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id=?`).run(...args)
        if (opts.setStartedAt) {
          if (ticket.room_id) db.prepare(`UPDATE rooms SET status='occupied', updated_at=? WHERE id=?`).run(now, ticket.room_id)
          if (ticket.technician_id) db.prepare(`UPDATE technicians SET status='working', updated_at=? WHERE id=?`).run(now, ticket.technician_id)
        }
        if (opts.freeRoom && ticket.room_id) db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
        if (opts.freeTech && ticket.technician_id) db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)
      })()

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: `ticket:${target}`, shop_id: ticket.shop_id, data: t })
      // 兼容客户端仍监听 ticket:updated 的旧版本
      fastify.broadcast({ type: 'ticket:updated', shop_id: ticket.shop_id, data: t })
      return t
    } catch (e) {
      req.log.error(e)
      throw e
    }
  }
