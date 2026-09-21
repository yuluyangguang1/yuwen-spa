// 门店：单店模式下只用 GET / PUT 改名字+地址
// 多店扩展时再加 POST/DELETE

export async function registerShopRoutes(fastify) {
  fastify.get('/api/shops', async (req, reply) => {
    try {
      return fastify.db.prepare(`SELECT * FROM shops ORDER BY created_at`).all()
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.get('/api/shops/current', async (req, reply) => {
    try {
      return fastify.db.prepare(`SELECT * FROM shops ORDER BY created_at LIMIT 1`).get() || null
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  fastify.put('/api/shops/:id', async (req, reply) => {
    try {
      const { id } = req.params
      const { name, address, phone } = req.body || {}
      const now = Date.now()
      const r = fastify.db.prepare(`
        UPDATE shops SET name=COALESCE(?, name), address=COALESCE(?, address),
          phone=COALESCE(?, phone), updated_at=? WHERE id=?
      `).run(name, address, phone, now, id)
      if (r.changes === 0) return reply.code(404).send({ error: 'not found' })
      return fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}
