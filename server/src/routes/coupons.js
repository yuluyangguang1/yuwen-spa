// 优惠券：创建 → 验证 → 使用 → 统计
//
// GET    /api/coupons              列表（admin）
// POST   /api/coupons              创建（admin）
// PUT    /api/coupons/:id          更新/启停（admin）
// DELETE /api/coupons/:id          删除（admin）
// POST   /api/coupons/validate     验证 { code, amount_cents } → 折扣明细（staff）
// GET    /api/coupons/stats        使用统计（admin）

import { nanoid } from 'nanoid'
import {
  NotFoundError, ValidationError, PermissionError, ConflictError,
} from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { requireRole, ADMIN_ROLES, STAFF_ROLES } from '../auth/roles.js'
import { requireObject, requireString, requireInt, optionalInt } from '../lib/validate.js'

const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/

/**
 * 计算优惠券折扣（分）。返回 { discount_cents, pay_cents }
 * 失败抛 ValidationError / ConflictError
 */
export function calcCouponDiscount(coupon, amountCents) {
  const now = Date.now()
  if (!coupon || coupon.active !== 1) throw new ValidationError('优惠券无效')
  if (coupon.starts_at && now < coupon.starts_at) throw new ValidationError('优惠券未生效')
  if (coupon.ends_at && now > coupon.ends_at) throw new ValidationError('优惠券已过期')
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
    throw new ConflictError('优惠券已用完')
  }
  const amount = Number(amountCents)
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('amount_cents 非法')
  if (amount < coupon.min_spend_cents) {
    throw new ValidationError(`满 ${(coupon.min_spend_cents / 100).toFixed(0)} 元可用`)
  }

  let discount = 0
  if (coupon.type === 'percent') {
    // value = 折扣百分比（如 20 = 8折，即减 20%）
    const pct = Math.min(Math.max(Number(coupon.value), 0), 99)
    discount = Math.floor((amount * pct) / 100)
  } else {
    discount = Math.min(Number(coupon.value), amount)
  }
  discount = Math.max(0, Math.min(discount, amount))
  return { discount_cents: discount, pay_cents: amount - discount }
}

export async function registerCouponRoutes(fastify) {
  const db = fastify.db
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) }
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }

  // ── 列表 ──────────────────────────────────
  fastify.get('/api/coupons', adminOnly, async (req) => {
    const shop_id = req.user.shop_id
    const { page, pageSize, offset } = parsePagination(req)
    const total = Number(db.prepare(
      `SELECT COUNT(*) AS total FROM coupons WHERE shop_id=?`
    ).get(shop_id)?.total ?? 0)
    const rows = db.prepare(
      `SELECT * FROM coupons WHERE shop_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(shop_id, pageSize, offset)
    return { data: rows, total, page, pageSize }
  })

  // ── 创建 ──────────────────────────────────
  fastify.post('/api/coupons', adminOnly, async (req) => {
    requireObject(req.body)
    const shop_id = req.user.shop_id
    const code = requireString(req.body.code, 'code', { max: 32 }).toUpperCase()
    if (!CODE_RE.test(code)) throw new ValidationError('码只能是 4-32 位字母数字-_')
    const name = requireString(req.body.name, 'name', { max: 64 })
    const type = req.body.type === 'fixed' ? 'fixed' : 'percent'
    const value = requireInt(req.body.value, 'value', { min: 1, max: 1_000_000_000 })
    if (type === 'percent' && value > 99) throw new ValidationError('折扣百分比不能超过 99')
    const min_spend_cents = optionalInt(req.body.min_spend_cents, 'min_spend_cents', { min: 0 }) ?? 0
    const max_uses = optionalInt(req.body.max_uses, 'max_uses', { min: 1 })
    const starts_at = optionalInt(req.body.starts_at, 'starts_at')
    const ends_at = optionalInt(req.body.ends_at, 'ends_at')

    const exists = db.prepare(`SELECT id FROM coupons WHERE shop_id=? AND code=?`).get(shop_id, code)
    if (exists) throw new ConflictError('券码已存在')

    const now = Date.now()
    const id = nanoid(12)
    try {
      db.prepare(`
        INSERT INTO coupons(id, shop_id, code, name, type, value, min_spend_cents,
          max_uses, used_count, starts_at, ends_at, active, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?, ?,0,?,?,1,?,?)
      `).run(id, shop_id, code, name, type, value, min_spend_cents,
             max_uses, starts_at, ends_at, now, now)
    } catch (e) {
      if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(e?.message || ''))) {
        throw new ConflictError('券码已存在')
      }
      throw e
    }

    db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?,?,?,?, 'coupon', ?, ?, ?)
    `).run(nanoid(10), shop_id, req.user.sub, 'coupon.create', id,
           JSON.stringify({ code, name, type, value }), now)

    return db.prepare(`SELECT * FROM coupons WHERE id=?`).get(id)
  })

  // ── 更新 / 启停 ───────────────────────────
  fastify.put('/api/coupons/:id', adminOnly, async (req) => {
    const shop_id = req.user.shop_id
    const coupon = db.prepare(`SELECT * FROM coupons WHERE id=? AND shop_id=?`).get(req.params.id, shop_id)
    if (!coupon) throw new NotFoundError('not found')
    requireObject(req.body)
    const b = req.body
    const sets = []
    const args = []
    if (b.name !== undefined) { sets.push('name=?'); args.push(requireString(b.name, 'name', { max: 64 })) }
    if (b.active !== undefined) { sets.push('active=?'); args.push(b.active ? 1 : 0) }
    if (b.min_spend_cents !== undefined) { sets.push('min_spend_cents=?'); args.push(Number(b.min_spend_cents) || 0) }
    if (b.max_uses !== undefined) { sets.push('max_uses=?'); args.push(b.max_uses == null ? null : Number(b.max_uses)) }
    if (b.starts_at !== undefined) { sets.push('starts_at=?'); args.push(b.starts_at == null ? null : Number(b.starts_at)) }
    if (b.ends_at !== undefined) { sets.push('ends_at=?'); args.push(b.ends_at == null ? null : Number(b.ends_at)) }
    if (b.value !== undefined) {
      const v = Number(b.value)
      if (!Number.isInteger(v) || v < 1) throw new ValidationError('value 非法')
      if (coupon.type === 'percent' && v > 99) throw new ValidationError('折扣百分比不能超过 99')
      sets.push('value=?'); args.push(v)
    }
    if (!sets.length) throw new ValidationError('no fields')
    sets.push('updated_at=?')
    args.push(Date.now(), req.params.id, shop_id)
    db.prepare(`UPDATE coupons SET ${sets.join(', ')} WHERE id=? AND shop_id=?`).run(...args)
    return db.prepare(`SELECT * FROM coupons WHERE id=?`).get(req.params.id)
  })

  // ── 删除 ──────────────────────────────────
  fastify.delete('/api/coupons/:id', adminOnly, async (req) => {
    const shop_id = req.user.shop_id
    const r = db.prepare(`DELETE FROM coupons WHERE id=? AND shop_id=?`).run(req.params.id, shop_id)
    if (r.changes === 0) throw new NotFoundError('not found')
    return { ok: true }
  })

  // ── 验证（收银台试算）──────────────────────
  fastify.post('/api/coupons/validate', staffOnly, async (req) => {
    requireObject(req.body)
    const code = requireString(req.body.code, 'code', { max: 32 }).toUpperCase()
    const amount = requireInt(req.body.amount_cents, 'amount_cents', { min: 1, max: 10_000_000_000 })
    const coupon = db.prepare(`SELECT * FROM coupons WHERE shop_id=? AND code=?`)
      .get(req.user.shop_id, code)
    if (!coupon) throw new ValidationError('优惠券不存在')
    const { discount_cents, pay_cents } = calcCouponDiscount(coupon, amount)
    return {
      ok: true,
      code: coupon.code,
      name: coupon.name,
      type: coupon.type,
      value: coupon.value,
      discount_cents,
      pay_cents,
      amount_cents: amount,
    }
  })

  // ── 统计 ──────────────────────────────────
  fastify.get('/api/coupons/stats', adminOnly, async (req) => {
    const shop_id = req.user.shop_id
    const rows = db.prepare(`
      SELECT code, name, type, value, used_count, active, max_uses,
        starts_at, ends_at, created_at
      FROM coupons WHERE shop_id=?
      ORDER BY used_count DESC, created_at DESC
    `).all(shop_id)
    const activeCount = rows.filter(c => c.active === 1).length
    const totalUses = rows.reduce((s, c) => s + (c.used_count || 0), 0)
    return { data: rows, activeCount, totalUses }
  })
}
