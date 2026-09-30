// 评价系统 API
//
// 顾客结账后可以评价技师（1-5 星 + 标签 + 文字）

import { nanoid } from 'nanoid'
import { ValidationError, ConflictError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { requireObject, requireString, requireInt } from '../lib/validate.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'

function parseJsonSafe(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return fallback }
}

export async function registerReviewRoutes(fastify) {
  const db = fastify.db

  // 获取技师的评价列表（GET 公开，供顾客扫码查看）— 标准分页
  fastify.get('/api/reviews', async (req, reply) => {
    try {
      const { technician_id, shop_id } = req.query
      const { page, pageSize, offset } = parsePagination(req)
      const where = []
      const args = []
      if (technician_id) { where.push('r.technician_id=?'); args.push(technician_id) }
      // 公开接口必须带 shop_id，避免匿名拉取全部租户评价
      if (shop_id) { where.push('r.shop_id=?'); args.push(shop_id) }
      else if (!technician_id) {
        return reply.code(400).send({ error: 'shop_id or technician_id required', code: 'VALIDATION_ERROR' })
      }
      const whereSql = where.length ? ` AND ${where.join(' AND ')}` : ''
      const total = Number(db.prepare(
        `SELECT COUNT(*) AS total FROM reviews r WHERE 1=1${whereSql}`
      ).get(...args)?.total ?? 0)
      const rows = db.prepare(`
        SELECT r.*, CASE WHEN r.anonymous=1 THEN NULL ELSE c.name END AS customer_name
        FROM reviews r LEFT JOIN customers c ON r.customer_id=c.id
        WHERE 1=1${whereSql}
        ORDER BY r.created_at DESC LIMIT ? OFFSET ?
      `).all(...args, pageSize, offset)
      return { data: rows, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '查询失败', code: 'INTERNAL_ERROR' })
    }
  })

  // 提交评价（仅员工端；与顾客端 /api/guest/reviews 同规则：限本店 + 钟单状态 + 每单一次）
  fastify.post('/api/reviews', { preHandler: requireRole(...STAFF_ROLES) }, async (req, reply) => {
    try {
      requireObject(req.body)
      const { ticket_id, customer_id, tags, comment, anonymous } = req.body
      const technician_id = requireString(req.body.technician_id, 'technician_id', { max: 64 })
      const rating = requireInt(req.body.rating, 'rating', { min: 1, max: 5 })
      const r = Math.round(Number(rating))
      // 租户以登录用户为准，忽略客户端传入的 shop_id
      const effShop = req.user.shop_id
      const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=?`).get(technician_id, effShop)
      if (!tech) return reply.code(400).send({ error: 'technician not found', code: 'VALIDATION_ERROR' })
      if (ticket_id) {
        const ticket = db.prepare(`SELECT id, status FROM tickets WHERE id=? AND shop_id=?`).get(ticket_id, effShop)
        if (!ticket) return reply.code(400).send({ error: 'ticket not found', code: 'VALIDATION_ERROR' })
        if (!['completed', 'paid'].includes(ticket.status)) {
          throw new ValidationError('服务完成或结账后才能评价')
        }
        const already = db.prepare(`SELECT id FROM reviews WHERE ticket_id=?`).get(ticket_id)
        if (already) throw new ConflictError('该服务单已评价')
      }
      if (customer_id) {
        const customer = db.prepare(`SELECT id FROM customers WHERE id=? AND shop_id=?`).get(customer_id, effShop)
        if (!customer) return reply.code(400).send({ error: 'customer not found', code: 'VALIDATION_ERROR' })
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
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '提交失败', code: 'INTERNAL_ERROR' })
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
      throw e
    }
  })
}
