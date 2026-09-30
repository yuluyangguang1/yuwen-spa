// 门店：单店模式下只用 GET / PUT 改名字+地址

import { NotFoundError } from '../lib/errors.js'

export async function registerShopRoutes(fastify) {
  fastify.get('/api/shops', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: '仅管理员可查看门店列表' })
      }
      // 门店列表仅返回本店，避免泄露其他租户信息
      const mine = req.user.shop_id
        ? fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).all(req.user.shop_id)
        : []
      return { data: mine, total: mine.length, page: 1, pageSize: Math.max(mine.length, 1) }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  fastify.get('/api/shops/current', async (req, reply) => {
    try {
      if (req.user?.shop_id) {
        const mine = fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).get(req.user.shop_id)
        if (mine) return mine
      }
      return fastify.db.prepare(`SELECT * FROM shops ORDER BY created_at LIMIT 1`).get() || null
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  fastify.put('/api/shops/:id', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: '仅管理员可修改门店信息' })
      }
      const { id } = req.params
      if (id !== req.user.shop_id) {
        return reply.code(403).send({ error: '无权限修改该门店' })
      }
      const { name, address, phone } = req.body || {}
      const now = Date.now()
      const r = fastify.db.prepare(`UPDATE shops SET name=COALESCE(?, name), address=COALESCE(?, address), phone=COALESCE(?, phone), updated_at=? WHERE id=?`).run(name, address, phone, now, id)
      if (r.changes === 0) throw new NotFoundError('not found')
      return fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })
}
