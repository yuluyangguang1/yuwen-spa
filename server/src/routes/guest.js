// 顾客端公开 API（免登录，白名单 /api/guest/*）
//
// 扫码顾客没有 token，原先 GuestView 打受保护接口会 401。
// 这里提供脱敏的只读列表 + 自助下单入口。

import { nanoid } from 'nanoid'
import { NotFoundError, ValidationError, ConflictError, BusinessError } from '../lib/errors.js'
import { notifyTicketCreated } from '../notify/index.js'
import { checkRateLimit, clientKey } from '../auth/ratelimit.js'
import { createGuestToken, verifyGuestToken, sanitizeGuestTicket } from '../auth/guest-token.js'

// 过夜睡眠服务附加费（与前端 GuestView 常量保持一致）
const OVERNIGHT_FEE_CENTS = 3000

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
        SELECT id, shop_id, number, name, level, years, status, ai_score, avg_rating, review_count, avatar, bio, specialties, is_star
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
      return { id: shop.id, name: shop.name, address: shop.address, logo: shop.logo || null, short_name: shop.short_name || null }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 某房间今日钟单（公开给顾客看进度）──
  fastify.get('/api/guest/tickets', async (req, reply) => {
    try {
      const { room_id } = req.query
      // 必须限定房间：shop_id 单独使用会整店泄露当日钟单
      if (!room_id) throw new ValidationError('room_id required')
      const start = startOfDay(Date.now())
      let sql = `
        SELECT t.id, t.room_id, t.status, t.fulfillment, t.service_id, t.technician_id,
          t.price_cents, t.started_at, t.overnight,
          s.name AS service_name, s.duration AS service_duration,
          tech.name AS technician_name, tech.number AS technician_number,
          r.number AS room_number, r.type AS room_type,
          CASE WHEN EXISTS(SELECT 1 FROM reviews rv WHERE rv.ticket_id = t.id) THEN 1 ELSE 0 END AS reviewed
        FROM tickets t
        LEFT JOIN services s ON t.service_id=s.id
        LEFT JOIN technicians tech ON t.technician_id=tech.id
        LEFT JOIN rooms r ON t.room_id=r.id
        WHERE t.created_at>=? AND t.status IN ('pending','active','completed','paid')
          AND t.room_id=?
      `
      const args = [start, room_id]
      sql += ' ORDER BY t.created_at DESC LIMIT 100'
      const rows = db.prepare(sql).all(...args)
      return { data: rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 单条钟单查询（顾客凭 token 找回自己的单）──
  // 场景：顾客进店扫码下单时还没有房间号，刷新页面后需要找回自己的单。
  // 鉴权：下单时签发的 token（HMAC 签名，绑定 ticket_id + shop_id，24h 有效）。
  // 安全：token 内的 ticket_id 必须与 URL 中的一致（防 IDOR）。
  fastify.get('/api/guest/tickets/:id', async (req, reply) => {
    try {
      const ticketId = req.params.id
      const token = req.query.t
      const claim = verifyGuestToken(token, ticketId)
      if (!claim) {
        // 凭证无效时按 IP 限流（挡暴力猜 token）；合法请求按单限流
        const rlBad = checkRateLimit(`guest-bad|${req.ip || 'unknown'}`, { maxAttempts: 30, windowMs: 10 * 60 * 1000 })
        if (!rlBad.ok) {
          return reply.code(429).send({ error: `请求过于频繁，请 ${rlBad.retryAfter}s 后再试`, code: 'RATE_LIMITED' })
        }
        return reply.code(403).send({ error: '凭证无效或已过期，请重新扫码', code: 'INVALID_TOKEN' })
      }

      // 限流：按「单」而非「IP」。
      // 店内所有顾客共用同一出口 IP，按 IP 限流会让一个人的轮询挤掉所有人。
      // 每张单独立额度（15 秒轮询 ≈ 4 次/分钟，200 次/10分钟余量充足）。
      req.guestTicketId = claim.ticketId
      const rl = checkRateLimit(clientKey(req, 'guest-ticket-get'), { maxAttempts: 200, windowMs: 10 * 60 * 1000 })
      if (!rl.ok) {
        return reply.code(429).send({ error: `查询过于频繁，请 ${rl.retryAfter}s 后再试`, code: 'RATE_LIMITED' })
      }

      const row = db.prepare(`
        SELECT t.id, t.room_id, t.status, t.fulfillment, t.service_id, t.technician_id,
          t.price_cents, t.started_at, t.completed_at, t.paid_at, t.overnight, t.created_at,
          s.name AS service_name, s.duration AS service_duration,
          tech.name AS technician_name, tech.number AS technician_number, tech.level AS technician_level,
          r.number AS room_number, r.type AS room_type,
          CASE WHEN EXISTS(SELECT 1 FROM reviews rv WHERE rv.ticket_id = t.id) THEN 1 ELSE 0 END AS reviewed
        FROM tickets t
        LEFT JOIN services s ON t.service_id=s.id
        LEFT JOIN technicians tech ON t.technician_id=tech.id
        LEFT JOIN rooms r ON t.room_id=r.id
        WHERE t.id=? AND t.shop_id=?
      `).get(ticketId, claim.shopId)

      if (!row) throw new NotFoundError('订单不存在')

      // 该房间未收款点单合计（顾客看自己消费了多少钱）
      let orders_cents = 0
      if (row.room_id) {
        const o = db.prepare(`
          SELECT COALESCE(SUM(total_cents),0) AS c FROM product_orders
          WHERE room_id=? AND paid_at IS NULL AND status != 'canceled' AND created_at >= ?
        `).get(row.room_id, startOfDay(row.created_at))
        orders_cents = o?.c || 0
      }

      return {
        ...sanitizeGuestTicket(row),
        orders_cents,
        total_cents: row.price_cents + orders_cents,
        token_expires_hint: '24 小时内有效',
      }
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 顾客自助下单（自提/扫码开钟）────────
  fastify.post('/api/guest/tickets', async (req, reply) => {
    try {
      // 限流：店内多人共用出口 IP，20 次/10 分钟会让「一桌人各自下单」互相挤占。
      // 放宽到 60 次（仍足以挡住脚本刷单）。
      const rl = checkRateLimit(`guest-ticket|${req.ip || 'unknown'}`, { maxAttempts: 60, windowMs: 10 * 60 * 1000 })
      if (!rl.ok) {
        return reply.code(429).send({ error: `下单过于频繁，请 ${rl.retryAfter}s 后再试`, code: 'RATE_LIMITED' })
      }
      const { shop_id: bodyShop, service_id, technician_id, room_id, auto_start = false, overnight = false } = req.body || {}
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
      const overnightFlag = overnight ? 1 : 0
      // 落单价 = 项目价 + 过夜服务费；提成只按项目价算（过夜费归门店）
      const price = service.price_cents + (overnightFlag ? OVERNIGHT_FEE_CENTS : 0)
      const commission = service.commission_type === 'fixed'
        ? service.commission_value
        : Math.round((service.price_cents * service.commission_value) / 10000)
      const notes = overnightFlag ? '顾客扫码自助 · 过夜睡眠' : '顾客扫码自助'

      db.transaction(() => {
        db.prepare(`
          INSERT INTO tickets(id, shop_id, customer_id, technician_id, room_id, service_id,
            status, fulfillment, price_cents, commission_cents, started_at, overnight, notes, created_at, updated_at)
          VALUES(?, ?, NULL, ?, ?, ?, ?, 'self', ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop.id, technician_id || null, room_id || null,
              service_id, status, price, commission,
              auto_start ? now : null, overnightFlag, notes, now, now)

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
      // 返回顾客访问凭证：顾客端持久化后，刷新页面可凭此找回自己的单
      return {
        ...sanitizeGuestTicket(ticket),
        guest_token: createGuestToken(id, shop.id, now),
      }
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 食物用品菜单（顾客端）──────────────────
  fastify.get('/api/guest/products', async (req, reply) => {
    try {
      const rows = db.prepare(`
        SELECT id, name, category, price_cents, stock, sort_order
        FROM products WHERE active=1 ORDER BY sort_order, name
      `).all()
      return { data: rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 某房间今日点单（顾客查看进度）────────────
  fastify.get('/api/guest/product-orders', async (req, reply) => {
    try {
      const { room_id } = req.query
      if (!room_id) throw new ValidationError('room_id required')
      const start = startOfDay(Date.now())
      const rows = db.prepare(`
        SELECT po.*, r.number AS room_number
        FROM product_orders po
        LEFT JOIN rooms r ON po.room_id = r.id
        WHERE po.room_id = ? AND po.created_at >= ?
        ORDER BY po.created_at DESC LIMIT 50
      `).all(room_id, start)
      const data = rows.map(o => ({
        ...o,
        items: db.prepare(`SELECT * FROM product_order_items WHERE order_id=? ORDER BY created_at`).all(o.id),
      }))
      return { data, total: data.length, page: 1, pageSize: Math.max(data.length, 1) }
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 顾客扫码提交技师评价（免登录，限流）────
  fastify.post('/api/guest/reviews', async (req, reply) => {
    try {
      const ip = req.ip || 'unknown'
      const rl = checkRateLimit(`guest-review|${ip}`, { maxAttempts: 15, windowMs: 10 * 60 * 1000 })
      if (!rl.ok) {
        return reply.code(429).send({ error: `提交过于频繁，请 ${rl.retryAfter}s 后再试`, code: 'RATE_LIMITED' })
      }

      const { ticket_id, room_id, shop_id: bodyShop, technician_id, rating, tags, comment, anonymous = true } = req.body || {}
      const r = Math.round(Number(rating))
      if (!ticket_id || !Number.isFinite(r) || r < 1 || r > 5) {
        throw new ValidationError('ticket_id、rating(1-5) required')
      }

      const shop = bodyShop
        ? db.prepare(`SELECT * FROM shops WHERE id=?`).get(bodyShop)
        : defaultShop()
      if (!shop) throw new NotFoundError('门店不存在')

      const ticket = db.prepare(`
        SELECT t.*, tech.name AS technician_name
        FROM tickets t
        LEFT JOIN technicians tech ON t.technician_id=tech.id
        WHERE t.id=? AND t.shop_id=?
      `).get(ticket_id, shop.id)
      if (!ticket) throw new NotFoundError('ticket not found')
      // 房间一致性：房间号传入时必须匹配，防止串房刷评价
      if (room_id && ticket.room_id !== room_id) throw new ValidationError('room 不匹配')
      // 只能评价已技师完成/已结账的单，且必须有技师
      if (!['completed', 'paid'].includes(ticket.status)) {
        throw new ValidationError('服务完成或结账后才能评价')
      }
      if (!ticket.technician_id) throw new ValidationError('该钟单无技师，无法评价')
      if (technician_id && technician_id !== ticket.technician_id) {
        throw new ValidationError('technician 与钟单不符')
      }
      const already = db.prepare(`SELECT id FROM reviews WHERE ticket_id=?`).get(ticket_id)
      if (already) throw new ConflictError('该服务单已评价')

      const techId = ticket.technician_id
      const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=?`).get(techId, shop.id)
      if (!tech) throw new NotFoundError('technician not found')

      const id = nanoid(12)
      const now = Date.now()
      db.transaction(() => {
        db.prepare(`
          INSERT INTO reviews(id, shop_id, ticket_id, technician_id, customer_id, rating, tags, comment, anonymous, created_at)
          VALUES(?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `).run(id, shop.id, ticket_id, techId, r,
              tags && Array.isArray(tags) ? JSON.stringify(tags) : null,
              comment ? String(comment).slice(0, 500) : null,
              anonymous ? 1 : 0, now)

        const stats = db.prepare(`
          SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews WHERE technician_id=? AND shop_id=?
        `).get(techId, shop.id)
        db.prepare(`
          UPDATE technicians SET review_count=?, avg_rating=?, updated_at=? WHERE id=? AND shop_id=?
        `).run(stats.cnt, Math.round((stats.avg || 0) * 10) / 10, now, techId, shop.id)
      })()

      fastify.broadcast({ type: 'review:created', shop_id: shop.id, data: { technician_id: techId, rating: r, ticket_id } })
      return { ok: true, id }
    } catch (e) {
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      if (e instanceof BusinessError) return reply.code(400).send({ error: e.message, code: e.code || 'BUSINESS_ERROR' })
      req.log.error(e)
      return reply.code(500).send({ error: '提交失败' })
    }
  })

  // ── 顾客点单下单 ───────────────────────────
  fastify.post('/api/guest/product-orders', async (req, reply) => {
    try {
      const rl = checkRateLimit(`guest-order|${req.ip || 'unknown'}`, { maxAttempts: 30, windowMs: 10 * 60 * 1000 })
      if (!rl.ok) {
        return reply.code(429).send({ error: `点单过于频繁，请 ${rl.retryAfter}s 后再试`, code: 'RATE_LIMITED' })
      }
      const { room_id, items, notes } = req.body || {}
      if (!room_id) throw new ValidationError('room_id required')
      if (!Array.isArray(items) || !items.length) throw new ValidationError('items required')
      if (items.length > 20) throw new ValidationError('单次最多 20 种商品')

      const room = db.prepare(`SELECT id, shop_id FROM rooms WHERE id=? AND active=1`).get(room_id)
      if (!room) throw new NotFoundError('room not found')

      // 校验并解析商品
      const parsed = []
      for (const it of items) {
        const qty = Number(it?.qty)
        if (!it?.product_id || !Number.isInteger(qty) || qty < 1 || qty > 99) {
          throw new ValidationError('商品数量非法')
        }
        const p = db.prepare(
          `SELECT * FROM products WHERE id=? AND shop_id=? AND active=1`
        ).get(it.product_id, room.shop_id)
        if (!p) throw new NotFoundError('商品不存在或已下架')
        const existing = parsed.find(x => x.product.id === p.id)
        const totalQty = (existing ? existing.qty : 0) + qty
        if (p.stock != null && totalQty > p.stock) {
          throw new ValidationError(`「${p.name}」库存不足`)
        }
        if (existing) existing.qty = totalQty
        else parsed.push({ product: p, qty })
      }

      const total = parsed.reduce((s, x) => s + x.product.price_cents * x.qty, 0)
      const id = nanoid(12)
      const now = Date.now()

      db.transaction(() => {
        db.prepare(`
          INSERT INTO product_orders(id, shop_id, room_id, ticket_id, status, total_cents, notes, created_at, updated_at)
          VALUES(?, ?, ?, NULL, 'pending', ?, ?, ?, ?)
        `).run(id, room.shop_id, room_id, total, notes || null, now, now)

        const insertItem = db.prepare(`
          INSERT INTO product_order_items(id, order_id, product_id, product_name, price_cents, qty, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?)
        `)
        for (const x of parsed) {
          insertItem.run(nanoid(10), id, x.product.id, x.product.name, x.product.price_cents, x.qty, now)
          if (x.product.stock != null) {
            // 库存守卫：跨进程/并发下禁止扣成负数
            const r = db.prepare(
              `UPDATE products SET stock = stock - ?, updated_at=? WHERE id=? AND stock >= ?`
            ).run(x.qty, now, x.product.id, x.qty)
            if (r.changes === 0) {
              throw new ValidationError(`「${x.product.name}」库存不足`)
            }
            const after = db.prepare(`SELECT stock FROM products WHERE id=?`).get(x.product.id)
            db.prepare(`
              INSERT INTO stock_movements(id, shop_id, product_id, type, qty, stock_after, ref_type, ref_id, notes, created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?)
            `).run(nanoid(12), room.shop_id, x.product.id, 'out', -x.qty,
                   after?.stock ?? 0, 'order', id, `点单 ${x.product.name}`, now)
          }
        }
      })()

      const order = db.prepare(`
        SELECT po.*, r.number AS room_number, r.type AS room_type
        FROM product_orders po LEFT JOIN rooms r ON po.room_id=r.id WHERE po.id=?
      `).get(id)
      order.items = db.prepare(`SELECT * FROM product_order_items WHERE order_id=? ORDER BY created_at`).all(id)

      // 实时推送到收银端 / 客服端（WebSocket 广播，同店）
      fastify.broadcast({ type: 'product_order:created', shop_id: room.shop_id, data: order })
      return order
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
