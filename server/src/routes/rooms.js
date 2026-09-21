// 房间/床位

import { nanoid } from 'nanoid'

export async function registerRoomRoutes(fastify) {
  fastify.get('/api/rooms', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(403).send({ error: '无权限访问' })
      let sql = `SELECT * FROM rooms WHERE 1=1 AND shop_id = ?`
      const args = [shop_id]
      return fastify.db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/rooms', async (req, reply) => {
    try {
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
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.put('/api/rooms/:id', async (req, reply) => {
    try {
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
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}
