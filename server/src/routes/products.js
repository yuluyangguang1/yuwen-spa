// 食物用品（商品）+ 顾客点单订单（员工端）
//
// 商品 CRUD 仿 services.js（admin 写、全员读）。
// 点单订单：顾客在扫码端下单 → 这里供收银/客服查看与流转状态。
// 履约状态机：pending → accepted → delivered
//                      ↘ canceled（回补库存）
// 收款独立维度：paid_at 非空 = 已收款；已收款禁止取消。

import { nanoid } from 'nanoid'
import { NotFoundError, ValidationError, PermissionError, ConflictError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'

const ORDER_STATUSES = ['pending', 'accepted', 'delivered', 'canceled']
// 合法转移：from → 允许的 to 列表
const ORDER_TRANSITIONS = {
  pending: ['accepted', 'canceled'],
  accepted: ['delivered', 'canceled'],
  delivered: [],
  canceled: [],
}

export async function registerProductRoutes(fastify) {
  function requireAdmin(req) {
    if (req.user?.role !== 'admin') throw new PermissionError('仅管理员可操作')
  }

  // ── 商品列表（员工端，可看停用）───────────────
  fastify.get('/api/products', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { page, pageSize, offset } = parsePagination(req)
      const active = req.query.active
      const activeCond = active === '1' ? ' AND active=1' : active === '0' ? ' AND active=0' : ''
      const total = Number(fastify.db.prepare(
        `SELECT COUNT(*) AS total FROM products WHERE shop_id = ?${activeCond}`
      ).get(shop_id).total)
      const rows = fastify.db.prepare(
        `SELECT * FROM products WHERE shop_id = ?${activeCond} ORDER BY sort_order, name LIMIT ? OFFSET ?`
      ).all(shop_id, pageSize, offset)
      return { data: rows, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 新增商品（admin）────────────────────────
  fastify.post('/api/products', async (req, reply) => {
    try {
      requireAdmin(req)
      const { name, category, price_cents, stock, sort_order = 0 } = req.body || {}
      if (!name || price_cents == null) throw new ValidationError('missing fields')
      if (!Number.isInteger(Number(price_cents)) || Number(price_cents) < 0) {
        throw new ValidationError('price_cents 必须是非负整数')
      }
      if (stock != null && (!Number.isInteger(Number(stock)) || Number(stock) < 0)) {
        throw new ValidationError('stock 必须是非负整数或留空')
      }
      const id = nanoid(10)
      const now = Date.now()
      fastify.db.prepare(`
        INSERT INTO products(id, shop_id, name, category, price_cents, stock, sort_order, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.user.shop_id, name, category || null, Number(price_cents),
            stock == null ? null : Number(stock), Number(sort_order), now, now)
      return fastify.db.prepare(`SELECT * FROM products WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 修改商品（admin）────────────────────────
  fastify.put('/api/products/:id', async (req, reply) => {
    try {
      requireAdmin(req)
      const { id } = req.params
      const existing = fastify.db.prepare(`SELECT id, shop_id FROM products WHERE id=?`).get(id)
      if (!existing) throw new NotFoundError('not found')
      if (existing.shop_id !== req.user.shop_id) throw new PermissionError('无权限操作该店铺的商品')

      const body = req.body || {}
      if (body.price_cents !== undefined && (!Number.isInteger(Number(body.price_cents)) || Number(body.price_cents) < 0)) {
        throw new ValidationError('price_cents 必须是非负整数')
      }
      if (body.stock !== undefined && body.stock !== null &&
          (!Number.isInteger(Number(body.stock)) || Number(body.stock) < 0)) {
        throw new ValidationError('stock 必须是非负整数或 null')
      }
      if (body.active !== undefined && ![0, 1, true, false, '0', '1'].includes(body.active)) {
        throw new ValidationError('active 非法')
      }

      const fields = ['name', 'category', 'price_cents', 'stock', 'active', 'sort_order']
      const sets = []
      const args = []
      for (const f of fields) {
        if (body[f] !== undefined) {
          sets.push(`${f}=?`)
          args.push(body[f] === null ? null : (f === 'active' ? Number(body[f]) : body[f]))
        }
      }
      if (!sets.length) throw new ValidationError('no fields')
      sets.push('updated_at=?')
      args.push(Date.now(), id)
      const r = fastify.db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id=? AND shop_id=?`)
        .run(...args, req.user.shop_id)
      if (r.changes === 0) throw new NotFoundError('not found')
      return fastify.db.prepare(`SELECT * FROM products WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 停用商品（软删，admin）────────────────────
  fastify.delete('/api/products/:id', async (req, reply) => {
    try {
      requireAdmin(req)
      const r = fastify.db.prepare(`UPDATE products SET active=0, updated_at=? WHERE id=? AND shop_id=?`)
        .run(Date.now(), req.params.id, req.user.shop_id)
      if (r.changes === 0) throw new NotFoundError('not found')
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 点单订单列表（收银/客服/管理）──────────────
  fastify.get('/api/product-orders', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { page, pageSize, offset } = parsePagination(req)
      const status = req.query.status
      const today = req.query.today !== '0'
      const start = startOfDay(Date.now())

      let cond = ' WHERE po.shop_id = ?'
      const args = [shop_id]
      if (status && ORDER_STATUSES.includes(status)) { cond += ' AND po.status = ?'; args.push(status) }
      if (today) { cond += ' AND po.created_at >= ?'; args.push(start) }
      if (req.query.paid === '1') cond += ' AND po.paid_at IS NOT NULL'
      else if (req.query.paid === '0') cond += ' AND po.paid_at IS NULL'

      const total = Number(fastify.db.prepare(
        `SELECT COUNT(*) AS total FROM product_orders po${cond}`
      ).get(...args).total)
      const rows = fastify.db.prepare(`
        SELECT po.*, r.number AS room_number, r.type AS room_type
        FROM product_orders po
        LEFT JOIN rooms r ON po.room_id = r.id
        ${cond}
        ORDER BY po.created_at DESC LIMIT ? OFFSET ?
      `).all(...args, pageSize, offset)

      // 批量取 items
      const ids = rows.map(r => r.id)
      let itemsByOrder = {}
      if (ids.length) {
        const ph = ids.map(() => '?').join(',')
        const items = fastify.db.prepare(
          `SELECT * FROM product_order_items WHERE order_id IN (${ph}) ORDER BY created_at`
        ).all(...ids)
        for (const it of items) {
          (itemsByOrder[it.order_id] ||= []).push(it)
        }
      }
      const data = rows.map(r => ({ ...r, items: itemsByOrder[r.id] || [] }))
      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 点单收据（打印用，staff）────────────────────
  fastify.get('/api/product-orders/:id/receipt', { preHandler: requireRole(...STAFF_ROLES) }, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const order = getOrderWithJoins(fastify, req.params.id)
      if (!order || order.shop_id !== shop_id) throw new NotFoundError('not found')
      const shop = fastify.db.prepare(`SELECT name, address, phone FROM shops WHERE id=?`).get(shop_id)
      if (!order.paid_at) throw new ValidationError('订单尚未收款，无法打印收据')
      return {
        shop: shop || { name: '足韵', address: null, phone: null },
        order,
        total_cents: order.total_cents,
        payment_method: order.payment_method,
        paid_at: order.paid_at,
        receipt_no: order.id,
      }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 订单收款（单笔，收银/客服）──────────────────
  fastify.post('/api/product-orders/:id/pay', { preHandler: requireRole(...STAFF_ROLES) }, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { payment_method = 'cash', customer_id } = req.body || {}
      const METHODS = ['cash', 'wechat', 'alipay', 'balance', 'card']
      if (!METHODS.includes(payment_method)) throw new ValidationError('payment_method 非法')

      const order = fastify.db.prepare(`SELECT * FROM product_orders WHERE id=? AND shop_id=?`)
        .get(req.params.id, shop_id)
      if (!order) throw new NotFoundError('not found')
      if (order.paid_at) throw new ConflictError('该订单已收款')
      if (order.status === 'canceled') throw new ConflictError('已取消订单不可收款')

      const now = Date.now()
      const buyerId = customer_id || null

      if (payment_method === 'balance') {
        if (!buyerId) throw new ValidationError('余额支付需要指定顾客')
        fastify.db.transaction(() => {
          const customer = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`).get(buyerId, shop_id)
          if (!customer) throw new NotFoundError('顾客不存在')
          if (customer.balance_cents < order.total_cents) throw new ValidationError('余额不足')
          const newBalance = customer.balance_cents - order.total_cents
          fastify.db.prepare(`UPDATE customers SET balance_cents=?, total_spent_cents=total_spent_cents+?, last_visit_at=?, updated_at=? WHERE id=?`)
            .run(newBalance, order.total_cents, now, now, customer.id)
          fastify.db.prepare(`INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents, balance_after, created_at) VALUES(?, ?, ?, 'consume', ?, ?, ?)`)
            .run(nanoid(12), shop_id, customer.id, -order.total_cents, newBalance, now)
          markOrderPaid(fastify.db, order, payment_method, req.user.sub, now, shop_id)
        })()
      } else {
        fastify.db.transaction(() => {
          if (buyerId) {
            const customer = fastify.db.prepare(`SELECT id FROM customers WHERE id=? AND shop_id=?`).get(buyerId, shop_id)
            if (customer) {
              fastify.db.prepare(`UPDATE customers SET total_spent_cents=total_spent_cents+?, last_visit_at=?, updated_at=? WHERE id=?`)
                .run(order.total_cents, now, now, buyerId)
            }
          }
          markOrderPaid(fastify.db, order, payment_method, req.user.sub, now, shop_id)
        })()
      }

      const updated = getOrderWithJoins(fastify, order.id)
      fastify.broadcast({ type: 'product_order:updated', shop_id, data: updated })
      return updated
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 订单状态流转（接单/送达/取消）──────────────
  fastify.post('/api/product-orders/:id/status', { preHandler: requireRole(...STAFF_ROLES) }, async (req, reply) => {
    try {
      const { status } = req.body || {}
      if (!ORDER_STATUSES.includes(status)) throw new ValidationError('status 非法')
      const order = fastify.db.prepare(`SELECT * FROM product_orders WHERE id=? AND shop_id=?`)
        .get(req.params.id, req.user.shop_id)
      if (!order) throw new NotFoundError('not found')
      const allowed = ORDER_TRANSITIONS[order.status] || []
      if (!allowed.includes(status)) {
        throw new ValidationError(`不能从 ${order.status} 变为 ${status}`)
      }
      // 已收款禁止取消：先走退款流程（人工），避免收入凭空蒸发
      if (status === 'canceled' && order.paid_at) {
        throw new ConflictError('已收款订单不可取消，请先线下退款')
      }
      const now = Date.now()
      fastify.db.transaction(() => {
        fastify.db.prepare(`UPDATE product_orders SET status=?, updated_at=? WHERE id=?`)
          .run(status, now, order.id)
        // 取消回补库存（下单时只扣了 stock IS NOT NULL 的）
        if (status === 'canceled') {
          const items = fastify.db.prepare(
            `SELECT product_id, qty FROM product_order_items WHERE order_id=?`
          ).all(order.id)
          for (const it of items) {
            if (it.product_id) {
              const p = fastify.db.prepare(`SELECT stock, name FROM products WHERE id=?`).get(it.product_id)
              if (p?.stock != null) {
                fastify.db.prepare(
                  `UPDATE products SET stock = stock + ?, updated_at=? WHERE id=? AND stock IS NOT NULL`
                ).run(it.qty, now, it.product_id)
                fastify.db.prepare(`
                  INSERT INTO stock_movements(id, shop_id, product_id, type, qty, stock_after, ref_type, ref_id, notes, created_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)
                `).run(nanoid(12), order.shop_id, it.product_id, 'in', it.qty,
                       p.stock + it.qty, 'cancel', order.id, `取消回补 ${p.name}`, now)
              }
            }
          }
        }
      })()
      const updated = getOrderWithJoins(fastify, order.id)
      fastify.broadcast({ type: 'product_order:updated', shop_id: order.shop_id, data: updated })
      return updated
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })
}

function getOrderWithJoins(fastify, id) {
  const updated = fastify.db.prepare(`
    SELECT po.*, r.number AS room_number, r.type AS room_type
    FROM product_orders po LEFT JOIN rooms r ON po.room_id=r.id WHERE po.id=?
  `).get(id)
  updated.items = fastify.db.prepare(
    `SELECT * FROM product_order_items WHERE order_id=? ORDER BY created_at`
  ).all(id)
  return updated
}

function markOrderPaid(db, order, payment_method, paidBy, now, shop_id) {
  db.prepare(`UPDATE product_orders SET paid_at=?, payment_method=?, paid_by=?, updated_at=? WHERE id=?`)
    .run(now, payment_method, paidBy || null, now, order.id)
  db.prepare(`INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at) VALUES(?, ?, 'product_order.pay', 'product_order', ?, ?, ?)`)
    .run(nanoid(10), shop_id, order.id,
         JSON.stringify({ payment_method, total_cents: order.total_cents, paid_by: paidBy || null }), now)
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
