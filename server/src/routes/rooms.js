// 房间/床位

import { nanoid } from 'nanoid'

export async function registerRoomRoutes(fastify) {
  fastify.get('/api/rooms', async (req) => {
    const { shop_id, active } = req.query
    let sql = `SELECT * FROM rooms WHERE 1=1`
    const args = []
    if (shop_id) { sql += ` AND shop_id=?`; args.push(shop_id) }
    if (active === '1') sql += ` AND active=1`
    sql += ` ORDER BY sort_order`
    return fastify.db.prepare(sql).all(...args)
  })

  fastify.post('/api/rooms', async (req, reply) => {
    const { shop_id, number, type, capacity = 1, sort_order = 0 } = req.body || {}
    if (!shop_id || !number) return reply.code(400).send({ error: 'missing fields' })
    const id = nanoid(10)
    const now = Date.now()
    try {
      fastify.db.prepare(`
        INSERT INTO rooms(id, shop_id, number, type, capacity, sort_order, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, shop_id, number, type || null, capacity, sort_order, now, now)
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return reply.code(409).send({ error: '房号已存在' })
      }
      throw e
    }
    return fastify.db.prepare(`SELECT * FROM rooms WHERE id=?`).get(id)
  })

  fastify.put('/api/rooms/:id', async (req, reply) => {
    const fields = ['number', 'type', 'capacity', 'status', 'sort_order', 'active']
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
    const r = fastify.db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id=?`).run(...args)
    if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
    const room = fastify.db.prepare(`SELECT * FROM rooms WHERE id=?`).get(req.params.id)
    fastify.broadcast({ type: 'room:updated', data: room })
    return room
  })
}
