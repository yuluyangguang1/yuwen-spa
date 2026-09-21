// 顾客（会员）+ 钱包流水

import { nanoid } from 'nanoid'
import { notifyMembershipTopup } from '../notify/index.js'

export async function registerCustomerRoutes(fastify) {
  // 列表 + 搜索（手机号/名字/会员号）
  fastify.get('/api/customers', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(403).send({ error: '无权限访问' })
      const { q, limit = 50 } = req.query
      let sql = `SELECT * FROM customers WHERE 1=1 AND shop_id = ?`
      const args = [shop_id]
      if (q) {
        sql += ` AND (name LIKE ? OR phone LIKE ? OR member_no LIKE ?)`
        const like = `%${q}%`
        args.push(like, like, like)
      }
      sql += ` ORDER BY last_visit_at DESC NULLS LAST, created_at DESC LIMIT ?`
      args.push(Number(limit))
      return fastify.db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.get('/api/customers/:id', async (req, reply) => {
    try {
      const c = fastify.db.prepare(`SELECT * FROM customers WHERE id=? AND shop_id=?`).get(req.params.id, req.user.shop_id)
      if (!c) return reply.code(404).send({ error: 'not found' })
      return c
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/customers', async (req, reply) => {
    try {
      const { shop_id, name, phone, gender, birthday, member_no, notes } = req.body || {}
      if (!shop_id) return reply.code(400).send({ error: 'shop_id required' })
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
          return reply.code(409).send({ error: '该手机号已存在' })
        }
        throw e
      }
      return fastify.db.prepare(`SELECT * FROM customers WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.put('/api/customers/:id', async (req, reply) => {
    try {
      const fields = ['name', 'phone', 'gender', 'birthday', 'member_no', 'notes', 'tags']
      const sets = []
      const args = []
      for (const f of fields) {
        if (req.body && req.body[f] !== undefined) {
          sets.push(`${f}=?`)
          args.push(req.body[f])
        }
      }
      if (!sets.length) return reply.code(400).send({ error: 'no fields' })
      sets.push(`updated_at=?`)
      args.push(Date.now(), req.params.id)
      const r = fastify.db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id=?`).run(...args)
      if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
      return fastify.db.prepare(`SELECT * FROM customers WHERE id=?`).get(req.params.id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // 储值卡充值
  fastify.post('/api/customers/:id/topup', async (req, reply) => {
    try {
      const { amount_cents, notes, created_by } = req.body || {}
      if (!amount_cents || amount_cents <= 0) {
        return reply.code(400).send({ error: 'amount_cents must be positive' })
      }
      const customer = fastify.db.prepare(`SELECT * FROM customers WHERE id=?`).get(req.params.id)
      if (!customer) return reply.code(404).send({ error: 'customer not found' })

      const newBalance = customer.balance_cents + amount_cents
      const now = Date.now()
      const txId = nanoid(12)

      fastify.db.transaction(() => {
        fastify.db.prepare(`UPDATE customers SET balance_cents=?, updated_at=? WHERE id=?`)
          .run(newBalance, now, customer.id)
        fastify.db.prepare(`
          INSERT INTO wallet_transactions(id, shop_id, customer_id, type, amount_cents,
            balance_after, notes, created_by, created_at)
          VALUES(?, ?, ?, 'topup', ?, ?, ?, ?, ?)
        `).run(txId, customer.shop_id, customer.id, amount_cents, newBalance,
              notes || null, created_by || null, now)
      })()

      fastify.broadcast({ type: 'customer:topup', data: { customer_id: customer.id, balance_cents: newBalance } })
      // 会员充值通知推大群
      notifyMembershipTopup({ ...customer, balance_cents: newBalance }, amount_cents, 'topup').catch(() => {})
      return { ok: true, balance_cents: newBalance, transaction_id: txId }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // 钱包流水
  fastify.get('/api/customers/:id/wallet', async (req, reply) => {
    try {
      return fastify.db.prepare(`
        SELECT * FROM wallet_transactions WHERE customer_id=? ORDER BY created_at DESC LIMIT 200
      `).all(req.params.id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}
