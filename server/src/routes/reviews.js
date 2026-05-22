// 评价系统 API
//
// 顾客结账后可以评价技师（1-5 星 + 标签 + 文字）
// AI 每月汇总评价生成综合评分

import { nanoid } from 'nanoid'

export async function registerReviewRoutes(fastify) {
  const db = fastify.db

  // 获取技师的评价列表
  fastify.get('/api/reviews', async (req) => {
    const { technician_id, shop_id, limit = 50 } = req.query
    let sql = `SELECT r.*, c.name AS customer_name FROM reviews r LEFT JOIN customers c ON r.customer_id=c.id WHERE 1=1`
    const args = []
    if (technician_id) { sql += ` AND r.technician_id=?`; args.push(technician_id) }
    if (shop_id) { sql += ` AND r.shop_id=?`; args.push(shop_id) }
    sql += ` ORDER BY r.created_at DESC LIMIT ?`
    args.push(Number(limit))
    return db.prepare(sql).all(...args)
  })

  // 提交评价
  fastify.post('/api/reviews', async (req, reply) => {
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
  })

  // 获取技师详情（含评价统计 + 最近评价）
  fastify.get('/api/technicians/:id/profile', async (req, reply) => {
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
  })

  // AI 月度评分（手动触发或定时任务调用）
  // 基于当月所有评价，计算多维度评分
  fastify.post('/api/ai/score-technicians', async (req) => {
    const techs = db.prepare(`SELECT * FROM technicians WHERE active=1`).all()
    const month = new Date().toISOString().slice(0, 7) // "2026-05"
    const now = Date.now()
    const results = []

    for (const tech of techs) {
      // 获取当月评价
      const monthStart = new Date(month + '-01').getTime()
      const reviews = db.prepare(`
        SELECT * FROM reviews WHERE technician_id=? AND created_at>=?
      `).all(tech.id, monthStart)

      if (reviews.length === 0) {
        results.push({ id: tech.id, name: tech.name, score: tech.ai_score, msg: '本月无评价' })
        continue
      }

      // AI 评分算法（本地计算，不依赖外部 API）
      // 维度：服务质量(rating均值)、稳定性(方差)、活跃度(单量)、好评率(4-5星占比)
      const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      const variance = reviews.reduce((s, r) => s + Math.pow(r.rating - avgRating, 2), 0) / reviews.length
      const stability = Math.max(0, 5 - variance * 2) // 方差越小越稳定
      const goodRate = reviews.filter(r => r.rating >= 4).length / reviews.length
      const volume = Math.min(5, reviews.length / 5) // 5单=1分，25单=满分

      // 综合评分（加权）
      const dimensions = {
        service: Math.round(avgRating * 10) / 10,
        stability: Math.round(stability * 10) / 10,
        popularity: Math.round(goodRate * 5 * 10) / 10,
        volume: Math.round(volume * 10) / 10,
      }
      const score = Math.round((
        dimensions.service * 0.4 +
        dimensions.stability * 0.2 +
        dimensions.popularity * 0.25 +
        dimensions.volume * 0.15
      ) * 10) / 10

      // 生成总结
      const summary = generateSummary(tech.name, dimensions, reviews.length)

      db.transaction(() => {
        // 写入 AI 评分记录
        db.prepare(`
          INSERT OR REPLACE INTO ai_scores(id, technician_id, month, score, dimensions, summary, review_count, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        `).run(nanoid(10), tech.id, month, score, JSON.stringify(dimensions), summary, reviews.length, now)

        // 更新技师主表
        db.prepare(`UPDATE technicians SET ai_score=?, ai_scored_at=?, updated_at=? WHERE id=?`)
          .run(score, now, now, tech.id)
      })()

      results.push({ id: tech.id, name: tech.name, score, dimensions, summary })
    }

    return { ok: true, month, results }
  })
}

function generateSummary(name, dims, count) {
  const parts = []
  if (dims.service >= 4.5) parts.push('服务质量优秀')
  else if (dims.service >= 4.0) parts.push('服务质量良好')
  else if (dims.service >= 3.0) parts.push('服务质量一般')
  else parts.push('服务质量待提升')

  if (dims.stability >= 4.0) parts.push('表现稳定')
  else if (dims.stability < 3.0) parts.push('状态波动较大')

  if (dims.popularity >= 4.0) parts.push('深受好评')
  if (dims.volume >= 4.0) parts.push('接单活跃')

  return `${name}本月${count}条评价，${parts.join('，')}。`
}
