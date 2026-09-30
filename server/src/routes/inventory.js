// 库存 / 耗材：出入库流水
//
// GET  /api/inventory/movements  流水列表（staff）
// POST /api/inventory/movements  手工入库/出库/盘点（admin）
// GET  /api/inventory/summary    库存概览（staff）
//
// 自动流水：顾客下单扣减（guest）、订单取消回补（products）。

import { nanoid } from 'nanoid'
import { NotFoundError, ValidationError, PermissionError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { requireRole, ADMIN_ROLES, STAFF_ROLES } from '../auth/roles.js'
import { requireObject, requireString, requireInt, optionalString } from '../lib/validate.js'

const TYPES = new Set(['in', 'out', 'adjust'])

/**
 * 应用库存变更并写流水（须在事务内调用）。
 * qty 为有符号增减；type=adjust 时 qty 即目标与当前的差值。
 * stock 为 NULL（不限库存）时：手工 in/out/adjust 可初始化为数量，自动流水跳过。
 */
export function applyStockMovement(db, {
  shop_id, product_id, type, qty, ref_type = null, ref_id = null,
  notes = null, created_by = null, now = Date.now(),
}) {
  if (!TYPES.has(type)) throw new ValidationError('type 必须是 in/out/adjust')
  const delta = Number(qty)
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError('qty 必须是非零整数')
  if (type === 'in' && delta < 0) throw new ValidationError('入库 qty 必须为正')
  if (type === 'out' && delta > 0) throw new ValidationError('出库 qty 必须为负')

  const product = db.prepare(`SELECT * FROM products WHERE id=? AND shop_id=?`).get(product_id, shop_id)
  if (!product) throw new NotFoundError('product not found')

  const before = product.stock
  let after
  if (before == null) {
    if (type === 'adjust' || ref_type === 'manual') after = Math.max(0, delta)
    else return null // 不限库存且非手工：不记流水
  } else {
    after = before + delta
    if (after < 0) throw new ValidationError(`「${product.name}」库存不足（当前 ${before}）`)
  }

  const id = nanoid(12)
  db.prepare(`UPDATE products SET stock=?, updated_at=? WHERE id=?`).run(after, now, product_id)
  db.prepare(`
    INSERT INTO stock_movements(id, shop_id, product_id, type, qty, stock_after, ref_type, ref_id, notes, created_by, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, shop_id, product_id, type, delta, after, ref_type, ref_id, notes, created_by, now)
  return { id, stock_after: after }
}

export async function registerInventoryRoutes(fastify) {
  const db = fastify.db
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) }
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }

  fastify.get('/api/inventory/movements', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const { page, pageSize, offset } = parsePagination(req)
    const { product_id, type, date_from, date_to } = req.query

    const where = ['m.shop_id=?']
    const args = [shop_id]
    if (product_id) { where.push('m.product_id=?'); args.push(String(product_id)) }
    if (type && TYPES.has(String(type))) { where.push('m.type=?'); args.push(String(type)) }
    if (date_from) { where.push('m.created_at>=?'); args.push(Number(date_from)) }
    if (date_to) { where.push('m.created_at<=?'); args.push(Number(date_to)) }
    const whereSql = ` AND ${where.join(' AND ')}`

    const total = Number(db.prepare(
      `SELECT COUNT(*) AS total FROM stock_movements m WHERE 1=1${whereSql}`
    ).get(...args)?.total ?? 0)
    const rows = db.prepare(`
      SELECT m.*, p.name AS product_name, p.category AS product_category, p.stock AS product_stock
      FROM stock_movements m
      LEFT JOIN products p ON m.product_id = p.id
      WHERE 1=1${whereSql}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset)
    return { data: rows, total, page, pageSize }
  })

  fastify.post('/api/inventory/movements', adminOnly, async (req) => {
    requireObject(req.body)
    const shop_id = req.user.shop_id
    const product_id = requireString(req.body.product_id, 'product_id', { max: 64 })
    const type = requireString(req.body.type, 'type', { max: 16 })
    if (!TYPES.has(type)) throw new ValidationError('type 必须是 in/out/adjust')
    let qty = requireInt(req.body.qty, 'qty', { min: -1_000_000, max: 1_000_000 })
    if (qty === 0) throw new ValidationError('qty 不能为 0')
    if (type === 'in' && qty < 0) qty = Math.abs(qty)
    if (type === 'out' && qty > 0) qty = -qty
    const notes = optionalString(req.body.notes, 'notes', { max: 200 })

    const now = Date.now()
    let result
    db.transaction(() => {
      result = applyStockMovement(db, {
        shop_id, product_id, type, qty,
        ref_type: 'manual', notes, created_by: req.user.sub, now,
      })
      db.prepare(`
        INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
        VALUES(?,?,?,?, 'product', ?, ?, ?)
      `).run(nanoid(10), shop_id, req.user.sub, `inventory.${type}`, product_id,
             JSON.stringify({ qty, stock_after: result?.stock_after, notes }), now)
    })()

    return {
      ok: true,
      id: result?.id,
      stock_after: result?.stock_after,
      product: db.prepare(`SELECT id, name, stock FROM products WHERE id=?`).get(product_id),
    }
  })

  fastify.get('/api/inventory/summary', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const low = Number(req.query.low || 10)
    const products = db.prepare(`
      SELECT id, name, category, price_cents, stock, active, sort_order, updated_at
      FROM products WHERE shop_id=? ORDER BY sort_order, name
    `).all(shop_id)
    const tracked = products.filter(p => p.stock != null)
    const lowStock = tracked.filter(p => p.stock <= low)
    const outOfStock = tracked.filter(p => p.stock === 0)
    return {
      data: {
        products,
        tracked_count: tracked.length,
        unlimited_count: products.length - tracked.length,
        low_stock: lowStock,
        out_of_stock: outOfStock,
        low_threshold: low,
      },
      total: products.length,
      page: 1,
      pageSize: Math.max(products.length, 1),
    }
  })
}
