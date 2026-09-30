// 顾客（会员）+ 钱包流水

import { nanoid } from 'nanoid'
import { notifyMembershipTopup } from '../notify/index.js'
import { BusinessError, NotFoundError, ValidationError, PermissionError, ConflictError } from '../lib/errors.js'
import { parsePagination, paginate } from '../lib/pagination.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'
import { requireObject, optionalString, requireInt, requireString } from '../lib/validate.js'

// ── 充值提成：档位命中 + 计算（percent 万分比，与 services 约定一致）──
function matchTopupRule(db, shopId, amountCents) {
  return db.prepare(`
    SELECT * FROM topup_commission_rules
    WHERE shop_id=? AND active=1 AND min_cents <= ?
      AND (max_cents IS NULL OR max_cents >= ?)
    ORDER BY min_cents DESC LIMIT 1
  `).get(shopId, amountCents, amountCents)
}

function computeTopupCommission(amountCents, rule) {
  if (!rule) return 0
  if (rule.commission_type === 'fixed') return rule.commission_value
  return Math.round((amountCents * rule.commission_value) / 10000)
}

function assertOwnerExists(db, shopId, ownerUserId) {
  if (!ownerUserId) return
  const u = db.prepare(`SELECT id FROM users WHERE id=? AND shop_id=?`).get(ownerUserId, shopId)
  if (!u) throw new ValidationError('归属人不存在')
}

export async function registerCustomerRoutes(fastify) {
  // 写操作（建档/改档/充值）：admin/pos/cs，tech 不可动会员钱包
  const staffWrite = { preHandler: requireRole(...STAFF_ROLES) }

  // 列表 + 搜索（手机号/名字/会员号）+ 分页（带归属人显示名）
  fastify.get('/api/customers', staffWrite, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { q } = req.query
      const { page, pageSize } = parsePagination(req)

      let countSql = `SELECT COUNT(*) AS total FROM customers WHERE 1=1 AND shop_id = ?`
      const countArgs = [shop_id]
      let dataSql = `SELECT c.*, u.display_name AS owner_name, u.username AS owner_username
        FROM customers c LEFT JOIN users u ON c.owner_user_id = u.id
        WHERE 1=1 AND c.shop_id = ?`
      const dataArgs = [shop_id]

      if (q) {
        const like = `%${q}%`
        countSql += ` AND (name LIKE ? OR phone LIKE ? OR member_no LIKE ?)`
        countArgs.push(like, like, like)
        dataSql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.member_no LIKE ?)`
        dataArgs.push(like, like, like)
      }

      dataSql += ` ORDER BY c.last_visit_at DESC NULLS LAST, c.created_at DESC`

      return paginate(fastify.db, countSql, countArgs, dataSql, dataArgs, page, pageSize)
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('服务器内部错误', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  fastify.get('/api/customers/:id', staffWrite, async (req, reply) => {
    try {
      const c = fastify.db.prepare(`
        SELECT c.*, u.display_name AS owner_name, u.username AS owner_username
        FROM customers c LEFT JOIN users u ON c.owner_user_id = u.id
        WHERE c.id=? AND c.shop_id=?`).get(req.params.id, req.user.shop_id)
      if (!c) throw new NotFoundError('not found')
      return c
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('服务器内部错误', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  // 创建顾客（默认归属=建档人 = 拉新）
  fastify.post('/api/customers', staffWrite, async (req, reply) => {
    const shop_id = req.user?.shop_id
    if (!shop_id) throw new PermissionError('无权限访问')
    const { name, phone, gender, birthday, member_no, notes, source } = req.body || {}
    // owner_user_id 显式 null = 公海；未传 = 当前操作人
    const hasOwner = req.body && Object.prototype.hasOwnProperty.call(req.body, 'owner_user_id')
    const ownerUserId = hasOwner ? (req.body.owner_user_id || null) : (req.user.sub || null)
    assertOwnerExists(fastify.db, shop_id, ownerUserId)

    const id = nanoid(10)
    const now = Date.now()
    try {
      fastify.db.transaction(() => {
        fastify.db.prepare(`
          INSERT INTO customers(id, shop_id, name, phone, gender, birthday, member_no, notes, source,
            owner_user_id, owner_assigned_at, owner_assigned_by, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop_id, name || null, phone || null, gender || null,
              birthday || null, member_no || null, notes || null, source || null,
              ownerUserId, ownerUserId ? now : null, ownerUserId ? (req.user.sub || null) : null, now, now)
        fastify.db.prepare(`
          INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
          VALUES(?, ?, ?, 'customer.create', 'customer', ?, ?, ?)
        `).run(nanoid(10), shop_id, req.user.sub || null, id,
              JSON.stringify({ owner_user_id: ownerUserId, source: source || null, phone: phone || null }), now)
      })()
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new BusinessError('该手机号已存在', { code: 'CONFLICT', statusCode: 409 })
      }
      throw e
    }
    return fastify.db.prepare(`
      SELECT c.*, u.display_name AS owner_name, u.username AS owner_username
      FROM customers c LEFT JOIN users u ON c.owner_user_id = u.id WHERE c.id=?`).get(id)
  })

  // 更新顾客（含归属变更留痕）
  fastify.put('/api/customers/:id', staffWrite, async (req, reply) => {
    const shop_id = req.user?.shop_id
    if (!shop_id) throw new PermissionError('无权限访问')
    const fields = ['name', 'phone', 'gender', 'birthday', 'member_no', 'notes', 'tags', 'source']
    const sets = []
    const args = []
    const now = Date.now()

    const existing = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`)
      .get(req.params.id, shop_id)
    if (!existing) throw new NotFoundError('not found')

    for (const f of fields) {
      if (req.body && req.body[f] !== undefined) {
        sets.push(`${f}=?`)
        args.push(req.body[f])
      }
    }

    let ownerChanged = false
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'owner_user_id')) {
      const newOwner = req.body.owner_user_id || null
      assertOwnerExists(fastify.db, shop_id, newOwner)
      if (newOwner !== (existing.owner_user_id || null)) {
        ownerChanged = true
        sets.push(`owner_user_id=?`, `owner_assigned_at=?`, `owner_assigned_by=?`)
        args.push(newOwner, newOwner ? now : null, newOwner ? (req.user.sub || null) : null)
      }
    }

    if (!sets.length) throw new ValidationError('no fields')
    sets.push(`updated_at=?`)
    args.push(now, req.params.id, shop_id)
    fastify.db.transaction(() => {
      const r = fastify.db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id=? AND shop_id=?`).run(...args)
      if (r.changes === 0) throw new NotFoundError('not found')
      if (ownerChanged) {
        fastify.db.prepare(`
          INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
          VALUES(?, ?, ?, 'customer.owner_change', 'customer', ?, ?, ?)
        `).run(nanoid(10), shop_id, req.user.sub || null, req.params.id,
              JSON.stringify({ from: existing.owner_user_id || null, to: req.body.owner_user_id || null }), now)
      }
    })()
    return fastify.db.prepare(`
      SELECT c.*, u.display_name AS owner_name, u.username AS owner_username
      FROM customers c LEFT JOIN users u ON c.owner_user_id = u.id WHERE c.id=?`).get(req.params.id)
  })

  // 储值卡充值（按档位计充卡提成 → 归属人，无归属归操作人）
  fastify.post('/api/customers/:id/topup', staffWrite, async (req, reply) => {
    try {
      requireObject(req.body)
      const amount = requireInt(req.body.amount_cents, 'amount_cents', { min: 1, max: 100_000_000 })
      const notes = optionalString(req.body.notes, 'notes', { max: 500 })

      const now = Date.now()
      const txId = nanoid(12)
      const createdBy = req.user.sub

      const result = fastify.db.transaction(() => {
        const customer = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`)
          .get(req.params.id, req.user.shop_id)
        if (!customer) throw new NotFoundError('customer not found')

        const newBalance = customer.balance_cents + amount
        if (!Number.isSafeInteger(newBalance)) throw new ValidationError('余额溢出')

        // 提成归属：客户归属人 > 当次操作人（存量无归属 → 操作人）
        const commissionUserId = customer.owner_user_id || createdBy || null
        const rule = matchTopupRule(fastify.db, customer.shop_id, amount)
        const commissionCents = computeTopupCommission(amount, rule)

        fastify.db.prepare(`UPDATE customers SET balance_cents=?, updated_at=? WHERE id=?`)
          .run(newBalance, now, customer.id)
        fastify.db.prepare(`
          INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents,
            balance_after, notes, created_by, commission_cents, commission_user_id, created_at)
          VALUES(?, ?, ?, 'topup', ?, ?, ?, ?, ?, ?, ?)
        `).run(txId, customer.shop_id, customer.id, amount, newBalance,
              notes || null, createdBy, commissionCents, commissionCents > 0 ? commissionUserId : null, now)
        fastify.db.prepare(`
          INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
          VALUES(?, ?, ?, 'customer.topup', 'customer', ?, ?, ?)
        `).run(nanoid(10), customer.shop_id, createdBy || null, customer.id,
              JSON.stringify({
                amount_cents: amount,
                balance_after: newBalance,
                commission_cents: commissionCents,
                commission_user_id: commissionCents > 0 ? commissionUserId : null,
                rule_id: rule?.id || null,
                transaction_id: txId,
              }), now)
        return { customer, newBalance, commissionCents, commissionUserId }
      })()

      fastify.broadcast({ type: 'customer:topup', data: { customer_id: result.customer.id, balance_cents: result.newBalance } })
      notifyMembershipTopup({ ...result.customer, balance_cents: result.newBalance }, amount, 'topup').catch(() => {})
      return {
        ok: true,
        balance_cents: result.newBalance,
        transaction_id: txId,
        commission_cents: result.commissionCents,
        commission_user_id: result.commissionCents > 0 ? result.commissionUserId : null,
      }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('充值失败', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  // 退卡（充值退款）：负向流水 type=topup_refund，反冲该笔充值提成（决策A）
  fastify.post('/api/customers/:id/topup-refund', staffWrite, async (req, reply) => {
    try {
      requireObject(req.body)
      const txnId = requireString(req.body.wallet_txn_id, 'wallet_txn_id', { max: 64 })
      const reason = optionalString(req.body.reason, 'reason', { max: 200 })

      const now = Date.now()
      const refundId = nanoid(12)

      const result = fastify.db.transaction(() => {
        const customer = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`)
          .get(req.params.id, req.user.shop_id)
        if (!customer) throw new NotFoundError('customer not found')

        const txn = fastify.db.prepare(`SELECT * FROM wallet_transactions WHERE id=? AND customer_id=? AND type='topup'`)
          .get(txnId, customer.id)
        if (!txn) throw new NotFoundError('充值流水不存在')
        if (txn.amount_cents <= 0) throw new ValidationError('充值流水金额非法')

        const dup = fastify.db.prepare(`SELECT id FROM refunds WHERE wallet_txn_id=?`).get(txn.id)
        if (dup) throw new ConflictError('该笔充值已退过款')

        if (customer.balance_cents < txn.amount_cents) {
          throw new ConflictError('余额不足以退卡（已消费部分请先处理）')
        }

        const newBalance = customer.balance_cents - txn.amount_cents
        fastify.db.prepare(`UPDATE customers SET balance_cents=?, updated_at=? WHERE id=?`)
          .run(newBalance, now, customer.id)

        // 负向流水：amount 为负表示扣回余额；提成写负数供报表直接汇总净额
        fastify.db.prepare(`
          INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents,
            balance_after, notes, created_by, commission_cents, commission_user_id, created_at)
          VALUES(?, ?, ?, 'topup_refund', ?, ?, ?, ?, ?, ?, ?)
        `).run(refundId, customer.shop_id, customer.id, -txn.amount_cents, newBalance,
               reason || `退卡（原流水 ${txn.id}）`, req.user.sub || null,
               -(txn.commission_cents || 0), txn.commission_user_id || null, now)

        fastify.db.prepare(`
          INSERT INTO refunds(id, shop_id, type, wallet_txn_id, customer_id, amount_cents,
            payment_method, reason, commission_cents, created_by, created_at)
          VALUES(?, ?, 'topup', ?, ?, ?, 'balance', ?, ?, ?, ?)
        `).run(refundId, customer.shop_id, txn.id, customer.id, txn.amount_cents,
               reason, txn.commission_cents || 0, req.user.sub || null, now)

        fastify.db.prepare(`
          INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
          VALUES(?, ?, ?, 'customer.topup_refund', 'customer', ?, ?, ?)
        `).run(nanoid(10), customer.shop_id, req.user.sub || null, customer.id,
               JSON.stringify({
                 wallet_txn_id: txn.id,
                 amount_cents: txn.amount_cents,
                 balance_after: newBalance,
                 commission_cents: txn.commission_cents || 0,
                 commission_user_id: txn.commission_user_id || null,
                 reason: reason || null,
                 refund_id: refundId,
               }), now)

        return { customer, newBalance, amount: txn.amount_cents,
                 commissionCents: txn.commission_cents || 0 }
      })()

      fastify.broadcast({ type: 'customer:topup', data: { customer_id: result.customer.id, balance_cents: result.newBalance } })
      return {
        ok: true,
        balance_cents: result.newBalance,
        refund_id: refundId,
        amount_cents: result.amount,
        commission_reversed_cents: result.commissionCents,
      }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('退卡失败', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  // 钱包流水（真 total + 分页）
  fastify.get('/api/customers/:id/wallet', staffWrite, async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const count = fastify.db.prepare(
        `SELECT COUNT(*) AS total FROM wallet_transactions WHERE customer_id=? AND shop_id=?`
      ).get(req.params.id, req.user.shop_id)
      const rows = fastify.db.prepare(`
        SELECT w.*, s.name AS service_name
        FROM wallet_transactions w
        LEFT JOIN tickets tk ON w.ticket_id = tk.id
        LEFT JOIN services s ON tk.service_id = s.id
        WHERE w.customer_id=? AND w.shop_id=?
        ORDER BY w.created_at DESC LIMIT ? OFFSET ?
      `).all(req.params.id, req.user.shop_id, pageSize, (page - 1) * pageSize)
      return { data: rows, total: Number(count?.total ?? 0), page, pageSize }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('服务器内部错误', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })
}
