// 充值提成规则（档位）CRUD
//
// GET    /api/topup-commission-rules        — 列表（staff，充值预览需要）
// POST   /api/topup-commission-rules        — 新增（admin）
// PUT    /api/topup-commission-rules/:id    — 修改（admin）
// DELETE /api/topup-commission-rules/:id    — 删除（admin）
//
// commission_type=percent → commission_value 为万分比（与 services 一致，UI *100 换算 %）
// commission_type=fixed   → commission_value 为分

import { nanoid } from 'nanoid'
import { requireRole, STAFF_ROLES, ADMIN_ROLES } from '../auth/roles.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { requireObject, optionalString, optionalInt, requireInt, requireOneOf } from '../lib/validate.js'

export async function registerCommissionRuleRoutes(fastify) {
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) }

  function validateRuleBody(b, { partial = false } = {}) {
    const out = {}
    if (!partial || b.name !== undefined) out.name = optionalString(b.name, 'name', { max: 100 })
    if (!partial || b.min_cents !== undefined) out.min_cents = requireInt(b.min_cents ?? 0, 'min_cents', { min: 0, max: 100_000_000 })
    if (!partial || b.max_cents !== undefined) {
      out.max_cents = (b.max_cents == null || b.max_cents === '')
        ? null : requireInt(b.max_cents, 'max_cents', { min: 0, max: 100_000_000 })
    }
    if (!partial || b.commission_type !== undefined) {
      out.commission_type = requireOneOf(b.commission_type ?? 'percent', 'commission_type', ['percent', 'fixed'])
    }
    if (!partial || b.commission_value !== undefined) {
      out.commission_value = requireInt(b.commission_value ?? 0, 'commission_value', { min: 0, max: 100_000_000 })
    }
    if (out.commission_type === 'percent' && out.commission_value > 10000) {
      throw new ValidationError('percent 万分比不能超过 10000（即 100%）')
    }
    if (out.min_cents != null && out.max_cents != null && out.max_cents < out.min_cents) {
      throw new ValidationError('max_cents 不能小于 min_cents')
    }
    if (!partial || b.active !== undefined) out.active = (b.active === undefined || b.active) ? 1 : 0
    if (!partial || b.sort_order !== undefined) out.sort_order = optionalInt(b.sort_order, 'sort_order', { min: 0, max: 9999 }) ?? 0
    return out
  }

  fastify.get('/api/topup-commission-rules', staffOnly, async (req) => {
    const rows = fastify.db.prepare(`
      SELECT * FROM topup_commission_rules WHERE shop_id=? ORDER BY sort_order, min_cents
    `).all(req.user.shop_id)
    return { data: rows, total: rows.length, page: 1, pageSize: rows.length }
  })

  fastify.post('/api/topup-commission-rules', adminOnly, async (req, reply) => {
    const b = requireObject(req.body)
    const v = validateRuleBody(b)
    const id = nanoid(10)
    const now = Date.now()
    fastify.db.prepare(`
      INSERT INTO topup_commission_rules(id, shop_id, name, min_cents, max_cents,
        commission_type, commission_value, active, sort_order, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.shop_id, v.name ?? null, v.min_cents, v.max_cents ?? null,
          v.commission_type, v.commission_value, v.active, v.sort_order, now, now)
    fastify.db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?, ?, ?, 'topup_commission_rule.create', 'topup_commission_rule', ?, ?, ?)
    `).run(nanoid(10), req.user.shop_id, req.user.sub || null, id, JSON.stringify(v), now)
    return fastify.db.prepare(`SELECT * FROM topup_commission_rules WHERE id=?`).get(id)
  })

  fastify.put('/api/topup-commission-rules/:id', adminOnly, async (req, reply) => {
    const b = requireObject(req.body)
    const existing = fastify.db.prepare(`SELECT * FROM topup_commission_rules WHERE id=? AND shop_id=?`)
      .get(req.params.id, req.user.shop_id)
    if (!existing) throw new NotFoundError('not found')
    const v = validateRuleBody(b, { partial: true })
    const keys = Object.keys(v)
    if (!keys.length) throw new ValidationError('no fields')
    const now = Date.now()
    const sets = keys.map(k => `${k}=?`)
    const args = keys.map(k => v[k])
    sets.push('updated_at=?')
    args.push(now, req.params.id)
    fastify.db.prepare(`UPDATE topup_commission_rules SET ${sets.join(', ')} WHERE id=?`).run(...args)
    fastify.db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?, ?, ?, 'topup_commission_rule.update', 'topup_commission_rule', ?, ?, ?)
    `).run(nanoid(10), req.user.shop_id, req.user.sub || null, req.params.id, JSON.stringify(v), now)
    return fastify.db.prepare(`SELECT * FROM topup_commission_rules WHERE id=?`).get(req.params.id)
  })

  fastify.delete('/api/topup-commission-rules/:id', adminOnly, async (req, reply) => {
    const existing = fastify.db.prepare(`SELECT * FROM topup_commission_rules WHERE id=? AND shop_id=?`)
      .get(req.params.id, req.user.shop_id)
    if (!existing) throw new NotFoundError('not found')
    fastify.db.prepare(`DELETE FROM topup_commission_rules WHERE id=?`).run(req.params.id)
    fastify.db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?, ?, ?, 'topup_commission_rule.delete', 'topup_commission_rule', ?, ?, ?)
    `).run(nanoid(10), req.user.shop_id, req.user.sub || null, req.params.id,
          JSON.stringify({ name: existing.name, min_cents: existing.min_cents }), Date.now())
    return { ok: true }
  })
}
