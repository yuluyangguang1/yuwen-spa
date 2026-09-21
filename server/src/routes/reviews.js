// 评价系统 API
//
// 顾客结账后可以评价技师（1-5 星 + 标签 + 文字）

import { nanoid } from 'nanoid'

export async function registerReviewRoutes(fastify) {
  const db = fastify.db

  // 获取技师的评价列表
  fastify.get('/api/reviews', async (req, reply) => {
    try {
      const { technician_id, shop_id, limit = 50 } = req.query
      let sql = `SELECT r.*, c.name AS customer_name FROM reviews r LEFT JOIN customers c ON r.customer_id=c.id WHERE 1=1`
      const args = []
      if (technician_id) { sql += ` AND r.technician_id=?`; args.push(technician_id) }
      if (shop_id) { sql += ` AND r.shop_id=?`; args.push(shop_id) }
      sql += ` ORDER BY r.created_at DESC LIMIT ?`
      args.push(Number(limit))
      return db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // 提交评价
  fastify.post('/api/reviews', async (req, reply) => {
    try {
      const { shop_id, ticket_id, technician_id, customer_id, rating, tags, comment, anonymous } = req.body || {}
      if (!shop_id || !technician_id || !rating || rating < 1 || rating > 5) {
        return reply.code(400).send({ error: 'shop_id, technician_id, rating(1-5) required' })
      }

      const id = nanoid(12)
      const now = Date.now()

      db.transaction(() => {
        db.prepare(`
          INSERT INTO reviews(id, shop_id, ticket_id, technician_id, customer_id, rating, tags, comment, anonymous, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop_id, ticket_id || null, technician_id, customer_id || null,
              rating, tags ? JSON.stringify(tags) : null, comment || null, anonymous ? 1 : 0, now)

        // 更新技师的平均评分和评价数
        const stats = db.prepare(`
          SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews WHERE technician_id=?
        `).get(technician_id)
        db.prepare(`
          UPDATE technicians SET review_count=?, avg_rating=?, updated_at=? WHERE id=?
        `).run(stats.cnt, Math.round(stats.avg * 10) / 10, now, technician_id)
      })()

      fastify.broadcast({ type: 'review:created', data: { technician_id, rating } })
      return { ok: true, id }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })

  // 获取技师详情（含评价统计 + 最近评价）
  fastify.get('/api/technicians/:id/profile', async (req, reply) => {
    try {
      const tech = db.prepare(`SELECT * FROM technicians WHERE id=?`).get(req.params.id)
      if (!tech) return reply.code(404).send({ error: 'not found' })

      const recentReviews = db.prepare(`
        SELECT r.*, c.name AS customer_name
        FROM reviews r LEFT JOIN customers c ON r.customer_id=c.id
        WHERE r.technician_id=?
        ORDER BY r.created_at DESC LIMIT 10
      `).all(req.params.id)

      // 评分分布
      const distribution = db.prepare(`
        SELECT rating, COUNT(*) AS count FROM reviews WHERE technician_id=? GROUP BY rating ORDER BY rating
      `).all(req.params.id)

      // 最近 AI 评分
      const aiScore = db.prepare(`
        SELECT * FROM ai_scores WHERE technician_id=? ORDER BY created_at DESC LIMIT 1
      `).get(req.params.id)

      return {
        ...tech,
        specialties: tech.specialties ? JSON.parse(tech.specialties) : [],
        recentReviews: recentReviews.map(r => ({
          ...r,
          tags: r.tags ? JSON.parse(r.tags) : [],
        })),
        distribution,
        aiScore: aiScore ? { ...aiScore, dimensions: aiScore.dimensions ? JSON.parse(aiScore.dimensions) : {} } : null,
      }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}
