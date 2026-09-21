// 钟单：核心实体
//
// 状态机：
//   pending   -> active     (开钟，技师开始服务)
//   active    -> completed  (服务完成，等待结账)
//   completed -> paid       (结账)
//   *         -> canceled   (取消)
//
// 重要原则：
//   1. 所有写操作走事务（涉及多表：tickets + wallet_transactions + customers.balance）
//   2. 状态转换要校验，不能跳跃
//   3. 价格在创建时锁定（即使 service 后来改价不影响历史单）
//   4. 提成在创建时计算并写入（不依赖运行时计算）
//   5. 每次状态变化都 broadcast，让所有屏幕实时刷新

import { nanoid } from 'nanoid'
import { notifyTicketCreated, notifyTicketPaid, notifyBigTicket } from '../notify/index.js'

export async function registerTicketRoutes(fastify) {
  const db = fastify.db

  // ── 列表（带过滤）─────────────────────────────────────
  fastify.get('/api/tickets', async (req, reply) => {
    try {
    const { shop_id, status, technician_id, date_from, date_to, limit = 200 } = req.query
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
    sql += ` ORDER BY t.created_at DESC LIMIT ?`
    args.push(Number(limit))
    return db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 今日台子看板（用于实时大屏）────────────────────────
  // 返回所有正在进行 + 当日所有未完成的钟，前端按房间分组渲染
  fastify.get('/api/tickets/today', async (req, reply) => {
    try {
      const { shop_id } = req.query
      const start = startOfDay(Date.now())
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
        WHERE ${shop_id ? `t.shop_id=? AND ` : ''}t.created_at>=?
        ORDER BY t.created_at DESC
      `
      const args = shop_id ? [shop_id, start] : [start]
      return db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 创建钟单（开钟）───────────────────────────────────
  fastify.post('/api/tickets', async (req, reply) => {
      try {
        const { shop_id, customer_id, technician_id, room_id, service_id,
          price_cents: priceOverride, notes, auto_start = true } = req.body || {}

        // 验证用户有权访问该 shop_id
        if (!shop_id || shop_id !== req.user?.shop_id) {
          return reply.code(403).send({ error: '无权限访问该店铺' })
        }
        if (!service_id) {
          return reply.code(400).send({ error: 'service_id required' })
        }

        const service = db.prepare(`SELECT * FROM services WHERE id=?`).get(service_id)
        if (!service) return reply.code(400).send({ error: 'service not found' })

        // 价格锁定：以 service 当前价为准，除非手动 override
        const finalPrice = priceOverride != null ? priceOverride : service.price_cents

        // 提成计算（创建时落库，不依赖运行时）
        const commissionCents = computeCommission(finalPrice, service)

        const id = nanoid(12)
        const now = Date.now()
        const status = auto_start ? 'active' : 'pending'

        db.transaction(() => {
          db.prepare(`
            INSERT INTO tickets(id, shop_id, customer_id, technician_id, room_id, service_id,
              status, price_cents, commission_cents, started_at, notes, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, shop_id, customer_id || null, technician_id || null, room_id || null,
                service_id, status, finalPrice, commissionCents,
                auto_start ? now : null, notes || null, now, now)

          // 房间状态联动
          if (room_id && auto_start) {
            db.prepare(`UPDATE rooms SET status='occupied', updated_at=? WHERE id=?`).run(now, room_id)
          }
          // 技师状态联动
          if (technician_id && auto_start) {
            db.prepare(`UPDATE technicians SET status='working', updated_at=? WHERE id=?`).run(now, technician_id)
          }
        })()

        const ticket = getTicketWithJoins(db, id)
        fastify.broadcast({ type: 'ticket:created', data: ticket })
        // 企业微信 webhook 通知（群 + 技师个人）
        const tech = technician_id ? db.prepare(`SELECT webhook_url FROM technicians WHERE id=?`).get(technician_id) : null
        notifyTicketCreated(ticket, tech?.webhook_url).catch(() => {})
        // 大额订单提醒（≥200元推大群）
        notifyBigTicket(ticket).catch(() => {})
        return ticket
      } catch (e) {
        req.log.error(e)
        return reply.code(500).send({ error: e.message })
      }
    })

  // ── 状态转移 ─────────────────────────────────────────
  // POST /api/tickets/:id/start    -> active
  // POST /api/tickets/:id/complete -> completed
  // POST /api/tickets/:id/pay      -> paid
  // POST /api/tickets/:id/cancel   -> canceled
  fastify.post('/api/tickets/:id/start', async (req, reply) => {
    try {
      return changeStatus(fastify, req, reply, 'active', { setStartedAt: true })
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/tickets/:id/complete', async (req, reply) => {
    try {
      return changeStatus(fastify, req, reply, 'completed', { setCompletedAt: true, freeRoom: true, freeTech: true })
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/tickets/:id/cancel', async (req, reply) => {
    try {
      return changeStatus(fastify, req, reply, 'canceled', { freeRoom: true, freeTech: true })
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 结账 ─────────────────────────────────────────────
  // 比单纯状态切换复杂：要扣余额 / 写流水 / 累计客户消费
  fastify.post('/api/tickets/:id/pay', async (req, reply) => {
    try {
      const { payment_method = 'cash', amount_cents } = req.body || {}
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) return reply.code(404).send({ error: 'not found' })
      if (ticket.status === 'paid') return reply.code(409).send({ error: '已结账' })
      if (ticket.status === 'canceled') return reply.code(409).send({ error: '已取消' })

      const finalAmount = amount_cents != null ? amount_cents : ticket.price_cents
      const now = Date.now()

      try {
        db.transaction(() => {
          // 余额支付：检查并扣减
          if (payment_method === 'balance') {
            if (!ticket.customer_id) throw new Error('余额支付需要顾客')
            const customer = db.prepare(`SELECT * FROM customers WHERE id=?`).get(ticket.customer_id)
            if (!customer) throw new Error('顾客不存在')
            if (customer.balance_cents < finalAmount) throw new Error('余额不足')

            const newBalance = customer.balance_cents - finalAmount
            db.prepare(`
              UPDATE customers SET balance_cents=?, total_spent_cents=total_spent_cents+?,
                visit_count=visit_count+1, last_visit_at=?, updated_at=? WHERE id=?
            `).run(newBalance, finalAmount, now, now, customer.id)

            db.prepare(`
              INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents,
                balance_after, ticket_id, created_at)
              VALUES(?, ?, ?, 'consume', ?, ?, ?, ?)
            `).run(nanoid(12), ticket.shop_id, customer.id, -finalAmount, newBalance, ticket.id, now)
          } else if (ticket.customer_id) {
            // 非余额支付，但有客户：累计消费 + 来访
            db.prepare(`
              UPDATE customers SET total_spent_cents=total_spent_cents+?,
                visit_count=visit_count+1, last_visit_at=?, updated_at=? WHERE id=?
            `).run(finalAmount, now, now, ticket.customer_id)
          }

          db.prepare(`
            UPDATE tickets SET status='paid', paid_at=?, payment_method=?,
              price_cents=?, updated_at=? WHERE id=?
          `).run(now, payment_method, finalAmount, now, ticket.id)

          // 房间和技师释放（如果还没释放）
          if (ticket.room_id) {
            db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
          }
          if (ticket.technician_id) {
            db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)
          }

          // 审计
          db.prepare(`
            INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at)
            VALUES(?, ?, 'ticket.pay', 'ticket', ?, ?, ?)
          `).run(nanoid(10), ticket.shop_id, ticket.id,
              JSON.stringify({ payment_method, amount_cents: finalAmount }), now)
        })()
      } catch (e) {
        return reply.code(400).send({ error: e.message })
      }

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: 'ticket:paid', data: t })
      // 结账通知（群 + 技师个人）
      const tech = t.technician_id ? db.prepare(`SELECT webhook_url FROM technicians WHERE id=?`).get(t.technician_id) : null
      notifyTicketPaid(t, tech?.webhook_url).catch(() => {})
      return t
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}

// ─────────────── helpers ───────────────

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function computeCommission(priceCents, service) {
  if (service.commission_type === 'fixed') return service.commission_value
  // percent: commission_value 存的是百分点 *100（比如 20% 存 2000）
  return Math.round((priceCents * service.commission_value) / 10000)
}

function getTicketWithJoins(db, id) {
  return db.prepare(`
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
    WHERE t.id=?
  `).get(id)
}

function changeStatus(fastify, req, reply, target, opts = {}) {
    try {
      const db = fastify.db
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) return reply.code(404).send({ error: 'not found' })
      if (ticket.status === target) return getTicketWithJoins(db, ticket.id)

      const now = Date.now()
      const sets = ['status=?', 'updated_at=?']
      const args = [target, now]
      if (opts.setStartedAt && !ticket.started_at) { sets.push('started_at=?'); args.push(now) }
      if (opts.setCompletedAt) { sets.push('completed_at=?'); args.push(now) }
      args.push(ticket.id)

      db.transaction(() => {
        db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id=?`).run(...args)
        if (opts.freeRoom && ticket.room_id) {
          db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
        }
        if (opts.freeTech && ticket.technician_id) {
          db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)
        }
      })()

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: `ticket:${target}`, data: t })
      return t
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  }
