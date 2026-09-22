// 顾客（会员）+ 钱包流水

import { nanoid } from 'nanoid'
import { notifyMembershipTopup } from '../notify/index.js'
import { BusinessError, NotFoundError, ValidationError, PermissionError } from '../lib/errors.js'
import { parsePagination, paginate } from '../lib/pagination.js'

export async function registerCustomerRoutes(fastify) {
  // 列表 + 搜索（手机号/名字/会员号）+ 分页
  fastify.get('/api/customers', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError('无权限访问')
      const { q } = req.query
      const { page, pageSize } = parsePagination(req)

      let countSql = `SELECT COUNT(*) AS total FROM customers WHERE 1=1 AND shop_id = ?`
      const countArgs = [shop_id]
      let dataSql = `SELECT * FROM customers WHERE 1=1 AND shop_id = ?`
      const dataArgs = [shop_id]

      if (q) {
        const like = `%${q}%`
        const cond = ` AND (name LIKE ? OR phone LIKE ? OR member_no LIKE ?)`
        countSql += cond
        countArgs.push(like, like, like)
        dataSql += cond
        dataArgs.push(like, like, like)
      }

      dataSql += ` ORDER BY last_visit_at DESC NULLS LAST, created_at DESC`

      return paginate(fastify.db, countSql, countArgs, dataSql, dataArgs, page, pageSize)
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('服务器内部错误', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  fastify.get('/api/customers/:id', async (req, reply) => {
    try {
      const c = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`).get(req.params.id, req.user.shop_id)
      if (!c) throw new NotFoundError('not found')
      return c
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('服务器内部错误', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  // 创建顾客
  fastify.post('/api/customers', async (req, reply) => {
    const shop_id = req.user?.shop_id
    if (!shop_id) throw new PermissionError('无权限访问')
    const { name, phone, gender, birthday, member_no, notes } = req.body || {}

    const id = nanoid(10)
    const now = Date.now()
    try {
      fastify.db.prepare(`
        INSERT INTO customers(id, shop_id, name, phone, gender, birthday, member_no, notes, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, shop_id, name || null, phone || null, gender || null,
            birthday || null, member_no || null, notes || null, now, now)
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new BusinessError('该手机号已存在', { code: 'CONFLICT', statusCode: 409 })
      }
      throw e
    }
    return fastify.db.prepare(`SELECT * FROM customers WHERE id=?`).get(id)
  })

  // 更新顾客
  fastify.put('/api/customers/:id', async (req, reply) => {
    const shop_id = req.user?.shop_id
    if (!shop_id) throw new PermissionError('无权限访问')
    const fields = ['name', 'phone', 'gender', 'birthday', 'member_no', 'notes', 'tags']
    const sets = []
    const args = []
    for (const f of fields) {
      if (req.body && req.body[f] !== undefined) {
        sets.push(`${f}=?`)
        args.push(req.body[f])
      }
    }
    if (!sets.length) throw new ValidationError('no fields')
    sets.push(`updated_at=?`)
    args.push(Date.now(), req.params.id, shop_id)
    const r = fastify.db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id=? AND shop_id=?`).run(...args)
    if (r.changes === 0) throw new NotFoundError('not found')
    return fastify.db.prepare(`SELECT * FROM customers WHERE id=?`).get(req.params.id)
  })

  // 储值卡充值
  fastify.post('/api/customers/:id/topup', async (req, reply) => {
    try {
      const { amount_cents, notes } = req.body || {}
      // 必须是正整数，防止字符串拼接/小数污染余额；上限防溢出
      const amount = Number(amount_cents)
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new ValidationError('amount_cents must be a positive integer')
      }
      if (amount > 100_000_000) { // 100 万元
        throw new ValidationError('单次充值金额过大')
      }

      const now = Date.now()
      const txId = nanoid(12)
      const createdBy = req.user.sub

      const result = fastify.db.transaction(() => {
        const customer = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`)
          .get(req.params.id, req.user.shop_id)
        if (!customer) throw new NotFoundError('customer not found')

        const newBalance = customer.balance_cents + amount
        if (!Number.isSafeInteger(newBalance)) throw new ValidationError('余额溢出')

        fastify.db.prepare(`UPDATE customers SET balance_cents=?, updated_at=? WHERE id=?`)
          .run(newBalance, now, customer.id)
        fastify.db.prepare(`
          INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents,
            balance_after, notes, created_by, created_at)
          VALUES(?, ?, ?, 'topup', ?, ?, ?, ?, ?)
        `).run(txId, customer.shop_id, customer.id, amount, newBalance,
              notes || null, createdBy, now)
        fastify.db.prepare(`
          INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at)
          VALUES(?, ?, 'customer.topup', 'customer', ?, ?, ?)
        `).run(nanoid(10), customer.shop_id, customer.id,
              JSON.stringify({ amount_cents: amount, balance_after: newBalance }), now)
        return { customer, newBalance }
      })()

      fastify.broadcast({ type: 'customer:topup', data: { customer_id: result.customer.id, balance_cents: result.newBalance } })
      notifyMembershipTopup({ ...result.customer, balance_cents: result.newBalance }, amount, 'topup').catch(() => {})
      return { ok: true, balance_cents: result.newBalance, transaction_id: txId }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('充值失败', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })

  // 钱包流水
  fastify.get('/api/customers/:id/wallet', async (req, reply) => {
    try {
      const rows = fastify.db.prepare(`
        SELECT w.*, s.name AS service_name
        FROM wallet_transactions w
        LEFT JOIN tickets tk ON w.ticket_id = tk.id
        LEFT JOIN services s ON tk.service_id = s.id
        WHERE w.customer_id=? AND w.shop_id=?
        ORDER BY w.created_at DESC LIMIT 200
      `).all(req.params.id, req.user.shop_id)
      return { data: rows, total: rows.length, page: 1, pageSize: rows.length || 1 }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new BusinessError('服务器内部错误', { code: 'INTERNAL_ERROR', statusCode: 500 })
    }
  })
}
