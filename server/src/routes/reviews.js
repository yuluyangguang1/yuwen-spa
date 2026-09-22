// 评价系统 API
//
// 顾客结账后可以评价技师（1-5 星 + 标签 + 文字）

import { nanoid } from 'nanoid'

function parseJsonSafe(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return fallback }
}

export async function registerReviewRoutes(fastify) {
  const db = fastify.db

  // 获取技师的评价列表（GET 公开，供顾客扫码查看）
  fastify.get('/api/reviews', async (req, reply) => {
    try {
      const { technician_id, shop_id, limit = 50 } = req.query
      const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
      // 匿名评价不返回真实姓名
      let sql = `SELECT r.*, CASE WHEN r.anonymous=1 THEN NULL ELSE c.name END AS customer_name
        FROM reviews r LEFT JOIN customers c ON r.customer_id=c.id WHERE 1=1`
      const args = []
      if (technician_id) { sql += ` AND r.technician_id=?`; args.push(technician_id) }
      // 公开接口必须带 shop_id，避免匿名拉取全部租户评价
      if (shop_id) { sql += ` AND r.shop_id=?`; args.push(shop_id) }
      else if (!technician_id) { return reply.code(400).send({ error: 'shop_id or technician_id required' }) }
      sql += ` ORDER BY r.created_at DESC LIMIT ?`
      args.push(lim)
      return db.prepare(sql).all(...args)
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '查询失败' })
    }
  })

  // 提交评价（需登录，见 auth/hook）
  fastify.post('/api/reviews', async (req, reply) => {
    try {
      const { ticket_id, technician_id, customer_id, rating, tags, comment, anonymous } = req.body || {}
      // 租户以登录用户为准，忽略客户端传入的 shop_id
      const effShop = req.user.shop_id
      const r = Math.round(Number(rating))
      if (!technician_id || !Number.isFinite(r) || r < 1 || r > 5) {
        return reply.code(400).send({ error: 'technician_id, rating(1-5) required' })
      }
      const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=?`).get(technician_id, effShop)
      if (!tech) return reply.code(400).send({ error: 'technician not found' })
      if (ticket_id) {
        const ticket = db.prepare(`SELECT id FROM tickets WHERE id=? AND shop_id=?`).get(ticket_id, effShop)
        if (!ticket) return reply.code(400).send({ error: 'ticket not found' })
      }
      if (customer_id) {
        const customer = db.prepare(`SELECT id FROM customers WHERE id=? AND shop_id=?`).get(customer_id, effShop)
        if (!customer) return reply.code(400).send({ error: 'customer not found' })
      }

      const id = nanoid(12)
      const now = Date.now()

      db.transaction(() => {
        db.prepare(`
          INSERT INTO reviews(id, shop_id, ticket_id, technician_id, customer_id, rating, tags, comment, anonymous, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, effShop, ticket_id || null, technician_id, customer_id || null,
              r, tags ? JSON.stringify(tags) : null, comment || null, anonymous ? 1 : 0, now)

        // 更新技师的平均评分和评价数（限定本店技师）
        const stats = db.prepare(`
          SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews WHERE technician_id=? AND shop_id=?
        `).get(technician_id, effShop)
        db.prepare(`
          UPDATE technicians SET review_count=?, avg_rating=?, updated_at=? WHERE id=? AND shop_id=?
        `).run(stats.cnt, Math.round((stats.avg || 0) * 10) / 10, now, technician_id, effShop)
      })()

      fastify.broadcast({ type: 'review:created', data: { technician_id, rating: r } })
      return { ok: true, id }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '提交失败' })
    }
  })

  // 获取技师详情（含评价统计 + 最近评价）
  // 顾客端未登录也可看（脱敏）；登录用户可看完整信息（限本店）
  fastify.get('/api/technicians/:id/profile', async (req, reply) => {
    try {
      const authed = !!req.user?.shop_id
      const tech = authed
        ? db.prepare(`SELECT * FROM technicians WHERE id=? AND shop_id=?`).get(req.params.id, req.user.shop_id)
        : db.prepare(`SELECT * FROM technicians WHERE id=? AND active=1`).get(req.params.id)
      if (!tech) return reply.code(404).send({ error: 'not found' })
      // 未登录脱敏：不返回手机号/ webhook
      if (!authed) {
        delete tech.phone
        delete tech.webhook_url
      }

      const recentReviews = db.prepare(`
        SELECT r.*, CASE WHEN r.anonymous=1 THEN NULL ELSE c.name END AS customer_name
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
        specialties: parseJsonSafe(tech.specialties, []),
        recentReviews: recentReviews.map(r => ({
          ...r,
          tags: parseJsonSafe(r.tags, []),
        })),
        distribution,
        aiScore: aiScore ? { ...aiScore, dimensions: parseJsonSafe(aiScore.dimensions, {}) } : null,
      }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}
