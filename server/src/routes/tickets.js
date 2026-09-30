// 钟单：核心实体
//
// 状态机：
//   pending   -> active     (开钟，技师开始服务)
//   active    -> completed  (服务完成，等待结账)
//   completed -> paid       (结账)
//   paid      -> refunded   (退款/反结账，终态)
//   *         -> canceled   (取消)

import { nanoid } from 'nanoid'
import { BusinessError, NotFoundError, ValidationError, PermissionError, ConflictError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { notifyTicketCreated, notifyTicketPaid, notifyBigTicket } from '../notify/index.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'
import { calcCouponDiscount } from './coupons.js'
import { requireObject, optionalString, optionalInt } from '../lib/validate.js'

export async function registerTicketRoutes(fastify) {
  const db = fastify.db
  // 开单/收款/取消：admin/pos/cs；tech 只走 start/complete 状态机
  const staffWrite = { preHandler: requireRole(...STAFF_ROLES) }
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }

  // ── 列表（带过滤 + 分页）─────────────────────────────
  fastify.get('/api/tickets', async (req, reply) => {
    try {
      const { status, technician_id, date_from, date_to } = req.query
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError()
      const { page, pageSize, offset } = parsePagination(req)

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
      if (date_from != null && date_from !== '') { sql += ` AND t.created_at>=?`; args.push(optionalInt(date_from, 'date_from', { min: 0 })) }
      if (date_to != null && date_to !== '') { sql += ` AND t.created_at<=?`; args.push(optionalInt(date_to, 'date_to', { min: 0 })) }

      let countSql = `SELECT COUNT(*) AS total FROM tickets t WHERE 1=1`
      const countArgs = []
      if (shop_id) { countSql += ` AND t.shop_id=?`; countArgs.push(shop_id) }
      if (status) {
        const list = String(status).split(',')
        countSql += ` AND t.status IN (${list.map(() => '?').join(',')})`
        countArgs.push(...list)
      }
      if (technician_id) { countSql += ` AND t.technician_id=?`; countArgs.push(technician_id) }
      if (date_from != null && date_from !== '') { countSql += ` AND t.created_at>=?`; countArgs.push(optionalInt(date_from, 'date_from', { min: 0 })) }
      if (date_to != null && date_to !== '') { countSql += ` AND t.created_at<=?`; countArgs.push(optionalInt(date_to, 'date_to', { min: 0 })) }

      const totalResult = db.prepare(countSql).get(...countArgs)
      const total = Number(totalResult.total)
      const rows = db.prepare(`${sql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset)

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
      const { page, pageSize, offset } = parsePagination(req)
      const effShopId = req.user?.shop_id || shop_id
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
  fastify.post('/api/tickets', staffWrite, async (req, reply) => {
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

  // ── 待派钟队列：pending 或 active 且无技师 ──────
  fastify.get('/api/tickets/queue', staffOnly, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError()
      const rows = db.prepare(`
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
        WHERE t.shop_id=?
          AND t.status IN ('pending','active')
          AND (t.technician_id IS NULL OR t.status='pending')
        ORDER BY t.created_at ASC
        LIMIT 200
      `).all(shop_id)
      // pending 单也进队列（可能已指定技师但仍待开钟）；active 无技师必须派
      return { data: rows, total: rows.length, page: 1, pageSize: rows.length || 1 }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 指派/改派技师、房间 ─────────────────────────
  // body: { technician_id?: string|null, room_id?: string|null, also_start?: boolean }
  fastify.post('/api/tickets/:id/assign', staffWrite, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError()
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      if (ticket.shop_id !== shop_id) throw new PermissionError('无权限操作该钟单')
      if (!['pending', 'active'].includes(ticket.status)) {
        throw new ConflictError('仅待开钟/上钟中的单可指派')
      }

      const body = req.body || {}
      const hasTech = Object.prototype.hasOwnProperty.call(body, 'technician_id')
      const hasRoom = Object.prototype.hasOwnProperty.call(body, 'room_id')
      if (!hasTech && !hasRoom) throw new ValidationError('需要 technician_id 或 room_id')

      let technician_id = ticket.technician_id
      let room_id = ticket.room_id
      if (hasTech) {
        technician_id = body.technician_id ? String(body.technician_id) : null
        if (technician_id) {
          const tech = db.prepare(`SELECT id, status, active FROM technicians WHERE id=? AND shop_id=?`)
            .get(technician_id, shop_id)
          if (!tech || !tech.active) throw new NotFoundError('技师不存在或已停用')
          const busy = db.prepare(
            `SELECT 1 FROM tickets WHERE technician_id=? AND status IN ('pending','active') AND id!=?`
          ).get(technician_id, ticket.id)
          if (busy) throw new ConflictError('技师已有进行中的钟单')
        }
      }
      if (hasRoom) {
        room_id = body.room_id ? String(body.room_id) : null
        if (room_id) {
          const room = db.prepare(`SELECT id FROM rooms WHERE id=? AND shop_id=?`).get(room_id, shop_id)
          if (!room) throw new NotFoundError('房间不存在')
          const busy = db.prepare(
            `SELECT 1 FROM tickets WHERE room_id=? AND status IN ('pending','active') AND id!=?`
          ).get(room_id, ticket.id)
          if (busy) throw new ConflictError('房间已被占用')
        }
      }

      const now = Date.now()
      db.transaction(() => {
        db.prepare(`UPDATE tickets SET technician_id=?, room_id=?, updated_at=? WHERE id=?`)
          .run(technician_id, room_id, now, ticket.id)
        // 仅上钟中的单同步占用房间/技师
        if (ticket.status === 'active') {
          if (technician_id && technician_id !== ticket.technician_id) {
            if (ticket.technician_id) {
              db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=? AND status='working'`)
                .run(now, ticket.technician_id)
            }
            db.prepare(`UPDATE technicians SET status='working', updated_at=? WHERE id=?`).run(now, technician_id)
          }
          if (room_id && room_id !== ticket.room_id) {
            if (ticket.room_id) {
              db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=? AND status='occupied'`)
                .run(now, ticket.room_id)
            }
            db.prepare(`UPDATE rooms SET status='occupied', updated_at=? WHERE id=?`).run(now, room_id)
          }
        }
        db.prepare(`
          INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
          VALUES(?,?,?,'ticket.assign','ticket',?,?,?)
        `).run(nanoid(10), shop_id, req.user.sub,
               ticket.id,
               JSON.stringify({
                 technician_id, room_id,
                 prev_technician_id: ticket.technician_id,
                 prev_room_id: ticket.room_id,
               }),
               now)
      })()

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: 'ticket:updated', shop_id, data: t })
      fastify.broadcast({ type: 'ticket:assigned', shop_id, data: t })
      return t
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 状态转移 ──────────────────────────────────────
  // 角色：staff 任意单；tech 仅本人关联的单
  function assertCanOperate(req, ticket) {
    if (ticket.shop_id !== req.user?.shop_id) throw new PermissionError('无权限操作该钟单')
    if (req.user.role === 'tech') {
      const tid = req.user.technician_id
      if (!tid || ticket.technician_id !== tid) throw new PermissionError('只能操作自己的钟单')
      return
    }
    if (!STAFF_ROLES.includes(req.user.role)) throw new PermissionError('当前角色无权操作钟单')
  }

  // start 时可带 technician_id：无技师单先补人再开钟
  function prepareStart(fastify, req, reply, target, opts = {}) {
    const db2 = fastify.db
    const ticket = db2.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
    if (!ticket) throw new NotFoundError('not found')
    assertCanOperate(req, ticket)

    const body = req.body || {}
    if (body.technician_id && ticket.status === 'pending' && !ticket.technician_id) {
      const techId = String(body.technician_id)
      const tech = db2.prepare(`SELECT id, active FROM technicians WHERE id=? AND shop_id=?`)
        .get(techId, ticket.shop_id)
      if (!tech || !tech.active) throw new NotFoundError('技师不存在或已停用')
      const busy = db2.prepare(
        `SELECT 1 FROM tickets WHERE technician_id=? AND status IN ('pending','active') AND id!=?`
      ).get(techId, ticket.id)
      if (busy) throw new ConflictError('技师已有进行中的钟单')
      db2.prepare(`UPDATE tickets SET technician_id=?, updated_at=? WHERE id=?`)
        .run(techId, Date.now(), ticket.id)
      ticket.technician_id = techId
    } else if (body.technician_id && ticket.technician_id && body.technician_id !== ticket.technician_id) {
      // 已有技师的单 start 时改人 → 走 assign 语义（staff）
      if (req.user.role === 'tech') throw new PermissionError('技师不能改派')
      // 复用 assign 校验：直接允许 staff 改（简化：仍做 busy 检查）
      const techId = String(body.technician_id)
      const busy = db2.prepare(
        `SELECT 1 FROM tickets WHERE technician_id=? AND status IN ('pending','active') AND id!=?`
      ).get(techId, ticket.id)
      if (busy) throw new ConflictError('技师已有进行中的钟单')
      db2.prepare(`UPDATE tickets SET technician_id=?, updated_at=? WHERE id=?`)
        .run(techId, Date.now(), ticket.id)
      ticket.technician_id = techId
    }

    // 开钟前校验技师/房可用（与创建 auto_start 一致）
    if (ticket.status === 'pending') {
      if (ticket.room_id) {
        const busyRoom = db2.prepare(
          `SELECT 1 FROM tickets WHERE room_id=? AND status='active' AND id!=?`
        ).get(ticket.room_id, ticket.id)
        if (busyRoom) throw new ConflictError('房间已被占用')
      }
      if (ticket.technician_id) {
        const busyTech = db2.prepare(
          `SELECT 1 FROM tickets WHERE technician_id=? AND status='active' AND id!=?`
        ).get(ticket.technician_id, ticket.id)
        if (busyTech) throw new ConflictError('技师正在上钟')
      }
    }

    return changeStatus(fastify, req, reply, target, opts)
  }

  fastify.post('/api/tickets/:id/start', async (req, reply) => {
    try { return prepareStart(fastify, req, reply, 'active', { setStartedAt: true }) }
    catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  fastify.post('/api/tickets/:id/complete', async (req, reply) => {
    try {
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      assertCanOperate(req, ticket)
      return changeStatus(fastify, req, reply, 'completed', { setCompletedAt: true, freeRoom: true, freeTech: true })
    }
    catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  fastify.post('/api/tickets/:id/cancel', staffWrite, async (req, reply) => {
    try { return changeStatus(fastify, req, reply, 'canceled', { freeRoom: true, freeTech: true }) }
    catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 结账 ──────────────────────────────────────────
  // include_orders: true 时同房间未收款点单一并结清
  // amount_cents ∈ [点单合计, 点单合计+钟单价]，余款记到钟单
  fastify.post('/api/tickets/:id/pay', staffWrite, async (req, reply) => {
    try {
      const { payment_method = 'cash', amount_cents, include_orders = false } = req.body || {}
      const couponCode = req.body?.coupon_code ? String(req.body.coupon_code).toUpperCase() : null
      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      if (ticket.shop_id !== req.user?.shop_id) throw new PermissionError('无权限操作该钟单')
      if (ticket.status === 'paid') throw new ConflictError('已结账')
      if (ticket.status === 'canceled') throw new ConflictError('已取消')
      if (ticket.status === 'refunded') throw new ConflictError('已退款，请重新开单')

      // 同房间今日未收款、未取消的点单
      const unpaidOrders = include_orders && ticket.room_id
        ? db.prepare(`
            SELECT * FROM product_orders
            WHERE shop_id=? AND room_id=? AND paid_at IS NULL AND status != 'canceled' AND created_at >= ?
            ORDER BY created_at
          `).all(ticket.shop_id, ticket.room_id, startOfDay(nowMs()))
        : []
      const ordersTotal = unpaidOrders.reduce((s, o) => s + o.total_cents, 0)

      // 金额校验：无点单时 [0, 钟单价]；带单时 [点单合计, 点单合计+钟单价]
      // 优惠券抵扣钟单价（ordersTotal 部分不受券影响，抵扣后仍约束在原范围内）
      let baseAmount = ticket.price_cents
      let coupon = null
      let couponDiscount = 0
      if (couponCode) {
        coupon = db.prepare(`SELECT * FROM coupons WHERE shop_id=? AND code=?`)
          .get(ticket.shop_id, couponCode)
        if (!coupon) throw new ValidationError('优惠券不存在')
        const calc = calcCouponDiscount(coupon, ticket.price_cents)
        couponDiscount = calc.discount_cents
        baseAmount = calc.pay_cents
      }

      let finalAmount = baseAmount
      if (amount_cents != null) {
        const n = Number(amount_cents)
        const min = ordersTotal
        const max = ordersTotal + baseAmount
        if (!Number.isInteger(n) || n < min || n > max) {
          throw new ValidationError(`amount_cents 必须是 ${min} 到 ${max} 之间的整数`)
        }
        finalAmount = n
      } else if (ordersTotal) {
        finalAmount = ordersTotal + baseAmount
      }
      const ticketPaid = finalAmount - ordersTotal  // 钟单实收（已含券抵扣）
      const totalDebit = finalAmount                 // 本次总收款
      const now = Date.now()

      try {
        db.transaction(() => {
          if (payment_method === 'balance') {
            if (!ticket.customer_id) throw new ValidationError('余额支付需要顾客')
            const customer = db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`).get(ticket.customer_id, ticket.shop_id)
            if (!customer) throw new NotFoundError('顾客不存在')
            if (customer.balance_cents < totalDebit) throw new ValidationError('余额不足')

            const newBalance = customer.balance_cents - totalDebit
            db.prepare(`UPDATE customers SET balance_cents=?, total_spent_cents=total_spent_cents+?, visit_count=visit_count+1, last_visit_at=?, updated_at=? WHERE id=?`)
              .run(newBalance, totalDebit, now, now, customer.id)
            db.prepare(`INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents, balance_after, ticket_id, created_at) VALUES(?, ?, ?, 'consume', ?, ?, ?, ?)`)
              .run(nanoid(12), ticket.shop_id, customer.id, -totalDebit, newBalance, ticket.id, now)
          } else if (ticket.customer_id) {
            db.prepare(`UPDATE customers SET total_spent_cents=total_spent_cents+?, visit_count=visit_count+1, last_visit_at=?, updated_at=? WHERE id=?`)
              .run(totalDebit, now, now, ticket.customer_id)
          }

          // 点单逐笔标记收款
          for (const o of unpaidOrders) {
            db.prepare(`UPDATE product_orders SET paid_at=?, payment_method=?, paid_by=?, ticket_id=?, updated_at=? WHERE id=?`)
              .run(now, payment_method, req.user.sub || null, ticket.id, now, o.id)
            db.prepare(`INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at) VALUES(?, ?, 'product_order.pay', 'product_order', ?, ?, ?)`)
              .run(nanoid(10), ticket.shop_id, o.id,
                   JSON.stringify({ payment_method, total_cents: o.total_cents, via_ticket: ticket.id }), now)
          }

          const payRes = db.prepare(`UPDATE tickets SET status='paid', paid_at=?, payment_method=?, price_cents=?, commission_cents=?, updated_at=? WHERE id=? AND status NOT IN ('paid','canceled','refunded')`)
            .run(now, payment_method, ticketPaid, recomputeCommission(db, ticket, ticketPaid), now, ticket.id)
          if (payRes.changes === 0) throw new ConflictError('钟单状态已变更，请刷新后重试')

          if (coupon && couponDiscount > 0) {
            const useRes = db.prepare(`UPDATE coupons SET used_count = used_count + 1, updated_at=? WHERE id=? AND (max_uses IS NULL OR used_count < max_uses)`)
              .run(now, coupon.id)
            if (useRes.changes === 0) throw new ConflictError('优惠券已用完')
          }

          if (ticket.room_id) db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
          if (ticket.technician_id) db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)

          db.prepare(`INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at) VALUES(?, ?, 'ticket.pay', 'ticket', ?, ?, ?)`)
            .run(nanoid(10), ticket.shop_id, ticket.id,
                 JSON.stringify({
                   payment_method,
                   amount_cents: totalDebit,
                   ticket_cents: ticketPaid,
                   order_cents: ordersTotal,
                   order_ids: unpaidOrders.map(o => o.id),
                   coupon_code: coupon?.code || null,
                   coupon_discount_cents: couponDiscount || 0,
                   list_price_cents: ticket.price_cents,
                 }), now)
          if (coupon) {
            db.prepare(`INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at) VALUES(?, ?, ?, 'coupon.use', 'coupon', ?, ?, ?)`)
              .run(nanoid(10), ticket.shop_id, req.user.sub || null, coupon.id,
                   JSON.stringify({ code: coupon.code, discount_cents: couponDiscount, ticket_id: ticket.id }), now)
          }
        })()
      } catch (e) {
        throw e  // BusinessError will be caught below
      }

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: 'ticket:paid', shop_id: ticket.shop_id, data: t })
      for (const o of unpaidOrders) {
        const upd = db.prepare(`
          SELECT po.*, r.number AS room_number, r.type AS room_type
          FROM product_orders po LEFT JOIN rooms r ON po.room_id=r.id WHERE po.id=?
        `).get(o.id)
        if (upd) {
          upd.items = db.prepare(`SELECT * FROM product_order_items WHERE order_id=? ORDER BY created_at`).all(o.id)
          fastify.broadcast({ type: 'product_order:updated', shop_id: ticket.shop_id, data: upd })
        }
      }
      const tech = t.technician_id ? db.prepare(`SELECT webhook_url FROM technicians WHERE id=?`).get(t.technician_id) : null
      notifyTicketPaid(t, tech?.webhook_url).catch(() => {})
      return {
        ...t,
        paid_orders: unpaidOrders.length,
        paid_orders_cents: ordersTotal,
        coupon_code: coupon?.code || null,
        coupon_discount_cents: couponDiscount || 0,
      }
      } catch (e) {
        req.log.error(e)
        if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
        return reply.code(500).send({ error: '服务器内部错误' })
      }
    })

  // ── 退款/反结账（staff）──────────────────────
  // 决策A：独立 refunds 表 + 状态 paid→refunded；余额原路退回，提成随 status 出报表
  fastify.post('/api/tickets/:id/refund', staffWrite, async (req, reply) => {
    try {
      requireObject(req.body || {})
      const reason = optionalString(req.body?.reason, 'reason', { max: 200 })
      const refundMethod = optionalString(req.body?.refund_method, 'refund_method', { max: 32 })

      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      if (ticket.shop_id !== req.user?.shop_id) throw new PermissionError('无权限操作该钟单')
      if (ticket.status !== 'paid') throw new ConflictError('只能退款已结账钟单')

      const payAudit = db.prepare(`
        SELECT payload FROM audit_logs
        WHERE action='ticket.pay' AND target_id=?
        ORDER BY created_at DESC LIMIT 1
      `).get(ticket.id)
      let payPayload = {}
      try { payPayload = JSON.parse(payAudit?.payload || '{}') } catch (_) {}

      const paidOrders = db.prepare(`
        SELECT * FROM product_orders WHERE ticket_id=? AND paid_at IS NOT NULL
      `).all(ticket.id)
      const orderCents = paidOrders.reduce((s, o) => s + o.total_cents, 0)
      const ticketCents = ticket.price_cents
      const refundTotal = ticketCents + orderCents
      const now = Date.now()
      const refundId = nanoid(12)

      db.transaction(() => {
        const r = db.prepare(`UPDATE tickets SET status='refunded', updated_at=? WHERE id=? AND status='paid'`)
          .run(now, ticket.id)
        if (r.changes === 0) throw new ConflictError('钟单状态已变更，请刷新后重试')

        if (ticket.customer_id && refundTotal > 0) {
          const customer = db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`)
            .get(ticket.customer_id, ticket.shop_id)
          if (customer) {
            const newSpent = Math.max(0, customer.total_spent_cents - refundTotal)
            const newVisits = Math.max(0, customer.visit_count - 1)
            if (ticket.payment_method === 'balance') {
              const newBalance = customer.balance_cents + refundTotal
              db.prepare(`UPDATE customers SET balance_cents=?, total_spent_cents=?, visit_count=?, updated_at=? WHERE id=?`)
                .run(newBalance, newSpent, newVisits, now, customer.id)
              db.prepare(`INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents, balance_after, ticket_id, notes, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
                .run(nanoid(12), ticket.shop_id, customer.id, 'refund', refundTotal, newBalance,
                     ticket.id, reason || '钟单退款', req.user.sub || null, now)
            } else {
              db.prepare(`UPDATE customers SET total_spent_cents=?, visit_count=?, updated_at=? WHERE id=?`)
                .run(newSpent, newVisits, now, customer.id)
            }
          }
        }

        for (const o of paidOrders) {
          db.prepare(`UPDATE product_orders SET paid_at=NULL, payment_method=NULL, paid_by=NULL, ticket_id=NULL, updated_at=? WHERE id=?`)
            .run(now, o.id)
        }

        if (payPayload.coupon_code) {
          db.prepare(`UPDATE coupons SET used_count=MAX(0, used_count-1), updated_at=? WHERE shop_id=? AND code=?`)
            .run(now, ticket.shop_id, payPayload.coupon_code)
        }

        db.prepare(`
          INSERT INTO refunds(id, shop_id, type, ticket_id, customer_id, amount_cents,
            ticket_cents, order_cents, payment_method, refund_method, reason, created_by, created_at)
          VALUES(?, ?, 'ticket', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(refundId, ticket.shop_id, ticket.id, ticket.customer_id, refundTotal,
               ticketCents, orderCents, ticket.payment_method || null,
               refundMethod || ticket.payment_method || null, reason,
               req.user.sub || null, now)

        db.prepare(`INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at) VALUES(?,?,?, 'ticket.refund', 'ticket', ?, ?, ?)`)
          .run(nanoid(10), ticket.shop_id, req.user.sub || null, ticket.id,
               JSON.stringify({
                 refund_id: refundId,
                 amount_cents: refundTotal,
                 ticket_cents: ticketCents,
                 order_cents: orderCents,
                 payment_method: ticket.payment_method || null,
                 refund_method: refundMethod || ticket.payment_method || null,
                 reason: reason || null,
                 commission_cents: ticket.commission_cents || 0,
               }), now)
      })()

      const t = getTicketWithJoins(db, ticket.id)
      fastify.broadcast({ type: 'ticket:refunded', shop_id: ticket.shop_id, data: t })
      fastify.broadcast({ type: 'ticket:updated', shop_id: ticket.shop_id, data: t })
      return { ...t, refund_id: refundId, refund_cents: refundTotal }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 收据/发票数据（打印用，staff）────────────
  fastify.get('/api/tickets/:id/receipt', { preHandler: requireRole(...STAFF_ROLES) }, async (req, reply) => {
    try {
      const ticket = getTicketWithJoins(db, req.params.id)
      if (!ticket) throw new NotFoundError('not found')
      if (ticket.shop_id !== req.user?.shop_id) throw new PermissionError('无权限')
      const shop = db.prepare(`SELECT name, address, phone FROM shops WHERE id=?`).get(ticket.shop_id)

      const paidOrders = db.prepare(`
        SELECT po.*, r.number AS room_number
        FROM product_orders po
        LEFT JOIN rooms r ON po.room_id=r.id
        WHERE po.ticket_id=? AND po.paid_at IS NOT NULL
        ORDER BY po.created_at
      `).all(ticket.id)
      const orders = paidOrders.map(o => ({
        ...o,
        items: db.prepare(
          `SELECT product_name, price_cents, qty FROM product_order_items WHERE order_id=? ORDER BY created_at`
        ).all(o.id),
      }))

      let coupon = null
      if (ticket.status === 'paid') {
        const audit = db.prepare(`
          SELECT payload FROM audit_logs
          WHERE action='ticket.pay' AND target_id=? AND payload LIKE '%coupon_code%'
          ORDER BY created_at DESC LIMIT 1
        `).get(ticket.id)
        if (audit?.payload) {
          try {
            const p = JSON.parse(audit.payload)
            if (p.coupon_code) {
              coupon = { code: p.coupon_code, discount_cents: p.coupon_discount_cents || 0, list_price_cents: p.list_price_cents }
            }
          } catch (_) {}
        }
      }

      const ordersCents = orders.reduce((s, o) => s + o.total_cents, 0)
      const method = ticket.payment_method || null
      return {
        shop: shop || { name: '足韵', address: null, phone: null },
        ticket,
        orders,
        coupon,
        service_cents: ticket.price_cents,
        orders_cents: ordersCents,
        total_cents: ticket.status === 'paid' ? ticket.price_cents + ordersCents : null,
        payment_method: method,
        paid_at: ticket.paid_at,
        receipt_no: ticket.id,
      }
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

function nowMs() { return Date.now() }

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
  paid: new Set(['refunded']),
  refunded: new Set(),
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
