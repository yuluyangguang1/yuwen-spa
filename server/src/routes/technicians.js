// 技师 CRUD + 状态切换（idle/working/break/off）

import { nanoid } from 'nanoid'

export async function registerTechnicianRoutes(fastify) {
  fastify.get('/api/technicians', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(403).send({ error: '无权限访问' })
      let sql = `SELECT * FROM technicians WHERE 1=1 AND shop_id = ?`
      const args = [shop_id]
      sql += ` ORDER BY number`
      return fastify.db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/technicians', async (req, reply) => {
    try {
      const { shop_id, number, name, level, phone } = req.body || {}
      if (!shop_id || !number || !name) {
        return reply.code(400).send({ error: 'missing fields' })
      }
      const id = nanoid(10)
      const now = Date.now()
      try {
        fastify.db.prepare(`
          INSERT INTO technicians(id, shop_id, number, name, level, phone, hired_at, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop_id, number, name, level || null, phone || null, now, now, now)
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
          return reply.code(409).send({ error: '工号已存在' })
        }
        throw e
      }
      return fastify.db.prepare(`SELECT * FROM technicians WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.put('/api/technicians/:id', async (req, reply) => {
    try {
      const fields = ['number', 'name', 'level', 'phone', 'status', 'active', 'webhook_url']
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
      const r = fastify.db.prepare(`UPDATE technicians SET ${sets.join(', ')} WHERE id=?`).run(...args)
      if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
      const tech = fastify.db.prepare(`SELECT * FROM technicians WHERE id=?`).get(req.params.id)
      fastify.broadcast({ type: 'technician:updated', data: tech })
      return tech
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // 当日业绩（钟数 + 提成）
  fastify.get('/api/technicians/:id/today', async (req, reply) => {
    try {
      const start = startOfDay(Date.now())
      const stat = fastify.db.prepare(`
        SELECT
          COUNT(*) AS ticket_count,
          COALESCE(SUM(price_cents), 0) AS revenue_cents,
          COALESCE(SUM(commission_cents), 0) AS commission_cents
        FROM tickets
        WHERE technician_id=? AND created_at>=? AND status IN ('completed', 'paid')
      `).get(req.params.id, start)
      return stat
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
