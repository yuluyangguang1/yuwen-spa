// 技师 CRUD + 状态切换（idle/working/break/off）

import { nanoid } from 'nanoid'

export async function registerTechnicianRoutes(fastify) {
  fastify.get('/api/technicians', async (req) => {
    const { shop_id, active } = req.query
    let sql = `SELECT * FROM technicians WHERE 1=1`
    const args = []
    if (shop_id) { sql += ` AND shop_id=?`; args.push(shop_id) }
    if (active === '1') sql += ` AND active=1`
    sql += ` ORDER BY number`
    return fastify.db.prepare(sql).all(...args)
  })

  fastify.post('/api/technicians', async (req, reply) => {
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
  })

  fastify.put('/api/technicians/:id', async (req, reply) => {
    const fields = ['number', 'name', 'level', 'phone', 'status', 'active']
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
  })

  // 当日业绩（钟数 + 提成）
  fastify.get('/api/technicians/:id/today', async (req) => {
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
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
