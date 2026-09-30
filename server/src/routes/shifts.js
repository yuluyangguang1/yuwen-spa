// 交接班 / 钱箱对账
//
// GET  /api/shifts/current  — 当前开放班次 + 实时汇总
// POST /api/shifts/open     — 开班（已有开放班次 → 返回 409）
// POST /api/shifts/close    — 交班：快照 + 实际现金 + 差额
// GET  /api/shifts          — 历史班次（分页）
//
// 实时汇总按 paid_at ∈ [opened_at, now] 计算；
// 关班时把汇总落快照，便于历史对账。

import { nanoid } from 'nanoid'
import { NotFoundError, ValidationError, ConflictError, PermissionError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

const SHIFT_ROLES = new Set(['admin', 'pos', 'cs'])

export async function registerShiftRoutes(fastify) {
  const db = fastify.db

  function requireShiftRole(req) {
    if (!req.user?.shop_id) throw new PermissionError('无权限访问')
    if (!SHIFT_ROLES.has(req.user.role)) throw new PermissionError('仅收银/客服/管理员可操作班次')
    return req.user.shop_id
  }

  function emptySummary() {
    return {
      cash_cents: 0, wechat_cents: 0, alipay_cents: 0, balance_cents: 0, card_cents: 0,
      topup_cents: 0, topup_count: 0, revenue_cents: 0,
      ticket_count: 0, product_count: 0, product_paid_cents: 0, unpaid_orders: 0,
    }
  }

  // 班次期间汇总：钟单收款 + 点单收款 + 充值流入 + 退款扣减（按实际退回方式净额）
  function computeSummary(shopId, from, to) {
    const s = emptySummary()
    // 含 refunded：退款单的 paid_at 保留（钱收过），下面按退款方式扣回，避免跨班次退款漏减现金
    const ticketRows = db.prepare(`
      SELECT COALESCE(payment_method, 'cash') AS m, COUNT(*) AS c, COALESCE(SUM(price_cents), 0) AS amt
      FROM tickets
      WHERE shop_id=? AND status IN ('paid','refunded') AND paid_at >= ? AND paid_at <= ?
      GROUP BY m
    `).all(shopId, from, to)
    const paidOnlyRows = db.prepare(`
      SELECT COUNT(*) AS c FROM tickets
      WHERE shop_id=? AND status='paid' AND paid_at >= ? AND paid_at <= ?
    `).get(shopId, from, to)
    const orderRows = db.prepare(`
      SELECT COALESCE(payment_method, 'cash') AS m, COUNT(*) AS c, COALESCE(SUM(total_cents), 0) AS amt
      FROM product_orders
      WHERE shop_id=? AND paid_at IS NOT NULL AND paid_at >= ? AND paid_at <= ?
      GROUP BY m
    `).all(shopId, from, to)

    const methodKey = (m) => (['cash', 'wechat', 'alipay', 'balance', 'card'].includes(m) ? m : 'cash')
    for (const r of ticketRows) {
      const k = methodKey(r.m) + '_cents'
      s[k] += r.amt
      s.revenue_cents += r.amt
    }
    s.ticket_count = paidOnlyRows.c
    let productPaidCents = 0
    for (const r of orderRows) {
      const k = methodKey(r.m) + '_cents'
      s[k] += r.amt
      s.revenue_cents += r.amt
      s.product_count += r.c
      productPaidCents += r.amt
    }
    s.product_paid_cents = productPaidCents

    // 班次内退款：按实际退回方式冲减（refund_method 缺省回退原支付方式）
    // 只冲 ticket_cents：订单部分在退款时 paid_at 被清（不在收款查询里），冲了会双扣；
    // 跨班次退款的点单现金部分因此漏减（金额小、罕见，已知残留）
    const refundRows = db.prepare(`
      SELECT COALESCE(refund_method, payment_method) AS m, COALESCE(SUM(ticket_cents), 0) AS amt
      FROM refunds
      WHERE shop_id=? AND type='ticket' AND created_at >= ? AND created_at <= ?
        AND COALESCE(refund_method, payment_method) IN ('cash','wechat','alipay','balance','card')
      GROUP BY m
    `).all(shopId, from, to)
    for (const r of refundRows) {
      const k = methodKey(r.m) + '_cents'
      s[k] -= r.amt
      s.revenue_cents -= r.amt
    }

    const topup = db.prepare(`
      SELECT COUNT(CASE WHEN type='topup' THEN 1 END) AS c, COALESCE(SUM(amount_cents), 0) AS amt
      FROM wallet_transactions
      WHERE shop_id=? AND type IN ('topup','topup_refund') AND created_at >= ? AND created_at <= ?
    `).get(shopId, from, to)
    s.topup_count = topup.c
    s.topup_cents = topup.amt

    const unpaid = db.prepare(`
      SELECT COUNT(*) AS c FROM product_orders
      WHERE shop_id=? AND paid_at IS NULL AND status != 'canceled' AND created_at <= ?
    `).get(shopId, to)
    s.unpaid_orders = unpaid.c
    return s
  }

  function getOpenShift(shopId) {
    return db.prepare(
      `SELECT * FROM shifts WHERE shop_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1`
    ).get(shopId)
  }

  function shapeShift(row, summary) {
    if (!row) return null
    return { ...row, summary }
  }

  // ── 当前班次 + 实时汇总 ─────────────────────
  fastify.get('/api/shifts/current', async (req, reply) => {
    try {
      const shop_id = requireShiftRole(req)
      const open = getOpenShift(shop_id)
      if (!open) return { shift: null, summary: null }
      const summary = computeSummary(shop_id, open.opened_at, Date.now())
      return { shift: open, summary }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 开班 ────────────────────────────────────
  fastify.post('/api/shifts/open', async (req, reply) => {
    try {
      const shop_id = requireShiftRole(req)
      const id = nanoid(12)
      const now = Date.now()

      // 查重 + 插入同事务，避免并发开出两个 open 班次
      db.transaction(() => {
        const existing = getOpenShift(shop_id)
        if (existing) throw new ConflictError('已有进行中的班次，请先交班')
        db.prepare(`
          INSERT INTO shifts(id, shop_id, user_id, username, opened_at, status, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, 'open', ?, ?)
        `).run(id, shop_id, req.user.sub, req.user.username || req.user.name || null, now, now, now)
      })()

      const row = db.prepare(`SELECT * FROM shifts WHERE id=?`).get(id)
      return { shift: row, summary: emptySummary() }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 交班（快照 + 实际现金差额）──────────────
  fastify.post('/api/shifts/close', async (req, reply) => {
    try {
      const shop_id = requireShiftRole(req)
      const open = getOpenShift(shop_id)
      if (!open) throw new NotFoundError('没有进行中的班次')

      const { actual_cash_cents, notes } = req.body || {}
      if (actual_cash_cents == null || !Number.isInteger(Number(actual_cash_cents)) || Number(actual_cash_cents) < 0) {
        throw new ValidationError('actual_cash_cents 必须是非负整数（分）')
      }
      const actual = Number(actual_cash_cents)
      const now = Date.now()
      const summary = computeSummary(shop_id, open.opened_at, now)
      const diff = actual - summary.cash_cents

      db.prepare(`
        UPDATE shifts SET closed_at=?, status='closed',
          cash_cents=?, wechat_cents=?, alipay_cents=?, balance_cents=?, card_cents=?,
          topup_cents=?, revenue_cents=?, ticket_count=?, product_count=?,
          actual_cash_cents=?, diff_cents=?, notes=?, updated_at=?
        WHERE id=? AND status='open'
      `).run(
        now,
        summary.cash_cents, summary.wechat_cents, summary.alipay_cents,
        summary.balance_cents, summary.card_cents,
        summary.topup_cents, summary.revenue_cents,
        summary.ticket_count, summary.product_count,
        actual, diff, notes ? String(notes).slice(0, 500) : null, now,
        open.id
      )

      const row = db.prepare(`SELECT * FROM shifts WHERE id=?`).get(open.id)
      return { shift: row, summary, diff }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 历史班次 ────────────────────────────────
  fastify.get('/api/shifts', async (req, reply) => {
    try {
      const shop_id = requireShiftRole(req)
      const { page, pageSize, offset } = parsePagination(req)
      const total = Number(db.prepare(
        `SELECT COUNT(*) AS total FROM shifts WHERE shop_id=?`
      ).get(shop_id).total)
      const rows = db.prepare(
        `SELECT * FROM shifts WHERE shop_id=? ORDER BY opened_at DESC LIMIT ? OFFSET ?`
      ).all(shop_id, pageSize, offset)
      return { data: rows, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}
