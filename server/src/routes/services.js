// 服务项目（足浴/按摩/采耳 等）

import { nanoid } from 'nanoid'

export async function registerServiceRoutes(fastify) {
  fastify.get('/api/services', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(403).send({ error: '无权限访问' })
      let sql = `SELECT * FROM services WHERE 1=1 AND shop_id = ?`
      const args = [shop_id]
      sql += ` ORDER BY sort_order, name`
      return fastify.db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.post('/api/services', async (req, reply) => {
    try {
      const { shop_id, name, category, duration, price_cents,
        commission_type = 'percent', commission_value = 0, sort_order = 0 } = req.body || {}
      if (!shop_id || !name || !duration || price_cents == null) {
        return reply.code(400).send({ error: 'missing fields' })
      }
      const id = nanoid(10)
      const now = Date.now()
      fastify.db.prepare(`
        INSERT INTO services(id, shop_id, name, category, duration, price_cents,
          commission_type, commission_value, sort_order, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, shop_id, name, category || null, duration, price_cents,
          commission_type, commission_value, sort_order, now, now)
      return fastify.db.prepare(`SELECT * FROM services WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.put('/api/services/:id', async (req, reply) => {
    try {
      const { id } = req.params
      const fields = ['name', 'category', 'duration', 'price_cents',
        'commission_type', 'commission_value', 'active', 'sort_order']
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
      args.push(Date.now(), id)
      const r = fastify.db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id=?`).run(...args)
      if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
      return fastify.db.prepare(`SELECT * FROM services WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.delete('/api/services/:id', async (req, reply) => {
    try {
      // 软删除：active=0，避免影响历史钟单的外键
      const r = fastify.db.prepare(`UPDATE services SET active=0, updated_at=? WHERE id=?`)
        .run(Date.now(), req.params.id)
      if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}
