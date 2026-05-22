// AI Agent API 路由
//
// - 配置管理（设置 provider / API key / 模型）
// - AI 对话（老板自然语言问数据）
// - AI 月度评分（真 LLM 分析评价文本）
// - AI 经营日报

import { nanoid } from 'nanoid'
import {
  getAIConfig, saveAIConfig, getProviders, chatCompletion, ask
} from '../ai/provider.js'
import {
  aiScoreTechnician, aiBusinessReport, aiChat, isAIEnabled
} from '../ai/agent.js'

export async function registerAIRoutes(fastify) {
  const db = fastify.db

  // ── 配置管理 ─────────────────────────────────────────

  // 获取当前 AI 配置（隐藏 key 中间部分）
  fastify.get('/api/ai/config', async () => {
    const config = getAIConfig()
    return {
      ...config,
      apiKey: config.apiKey ? maskKey(config.apiKey) : '',
      providers: getProviders(),
    }
  })

  // 保存 AI 配置
  fastify.post('/api/ai/config', async (req, reply) => {
    const { provider, apiKey, model, baseUrl, enabled } = req.body || {}
    if (!provider) return reply.code(400).send({ error: 'provider required' })

    const current = getAIConfig()
    const newConfig = {
      provider,
      // 如果前端传的是 mask 过的 key（没改），保留原值
      apiKey: apiKey && !apiKey.includes('***') ? apiKey : current.apiKey,
      model: model || '',
      baseUrl: baseUrl || '',
      enabled: enabled !== false,
    }
    saveAIConfig(newConfig)
    return { ok: true, config: { ...newConfig, apiKey: maskKey(newConfig.apiKey) } }
  })

  // 测试 AI 连接
  fastify.post('/api/ai/test', async (req, reply) => {
    try {
      const result = await ask('请回复"连接成功"四个字。', '你是一个测试助手。')
      return { ok: true, response: result }
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message })
    }
  })

  // ── AI 对话（老板助手）────────────────────────────────

  fastify.post('/api/ai/chat', async (req, reply) => {
    if (!isAIEnabled()) {
      return reply.code(400).send({ error: 'AI 未启用，请先在设置中配置 API Key' })
    }
    const { message } = req.body || {}
    if (!message) return reply.code(400).send({ error: 'message required' })

    // 构建上下文：当日经营数据
    const today = startOfDay(Date.now())
    const tickets = db.prepare(`SELECT * FROM tickets WHERE created_at>=?`).all(today)
    const paid = tickets.filter(t => t.status === 'paid')
    const techs = db.prepare(`SELECT name, number, level, status, ai_score FROM technicians WHERE active=1`).all()

    const context = {
      today: {
        revenue: paid.reduce((s, t) => s + t.price_cents, 0),
        ticketCount: paid.length,
        activeCount: tickets.filter(t => t.status === 'active').length,
      },
      technicians: techs,
      time: new Date().toLocaleString('zh-CN'),
    }

    try {
      const response = await aiChat(message, context)
      return { ok: true, response }
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message })
    }
  })

  // ── AI 月度技师评分（真 LLM 版）──────────────────────

  fastify.post('/api/ai/score-technicians', async (req, reply) => {
    if (!isAIEnabled()) {
      return reply.code(400).send({ error: 'AI 未启用' })
    }

    const techs = db.prepare(`SELECT * FROM technicians WHERE active=1`).all()
    const month = new Date().toISOString().slice(0, 7)
    const monthStart = new Date(month + '-01').getTime()
    const now = Date.now()
    const results = []

    for (const tech of techs) {
      const reviews = db.prepare(`
        SELECT * FROM reviews WHERE technician_id=? AND created_at>=?
      `).all(tech.id, monthStart)

      if (reviews.length === 0) {
        results.push({ id: tech.id, name: tech.name, msg: '本月无评价，跳过' })
        continue
      }

      // 解析 tags
      const parsedReviews = reviews.map(r => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags) : [],
      }))

      try {
        const aiResult = await aiScoreTechnician(tech.name, parsedReviews)

        if (aiResult && aiResult.score) {
          db.transaction(() => {
            db.prepare(`
              INSERT OR REPLACE INTO ai_scores(id, technician_id, month, score, dimensions, summary, review_count, created_at)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              nanoid(10), tech.id, month, aiResult.score,
              JSON.stringify(aiResult.dimensions || {}),
              aiResult.summary || '',
              reviews.length, now
            )

            db.prepare(`UPDATE technicians SET ai_score=?, ai_scored_at=?, updated_at=? WHERE id=?`)
              .run(aiResult.score, now, now, tech.id)
          })()

          results.push({
            id: tech.id, name: tech.name,
            score: aiResult.score,
            summary: aiResult.summary,
            suggestions: aiResult.suggestions,
            keywords: aiResult.keywords,
            concerns: aiResult.concerns,
          })
        }
      } catch (e) {
        results.push({ id: tech.id, name: tech.name, error: e.message })
      }
    }

    return { ok: true, month, results }
  })

  // ── AI 经营日报 ──────────────────────────────────────

  fastify.get('/api/ai/daily-report', async (req, reply) => {
    if (!isAIEnabled()) {
      return reply.code(400).send({ error: 'AI 未启用' })
    }

    const today = startOfDay(Date.now())
    const yesterday = today - 86400000
    const todayTickets = db.prepare(`SELECT * FROM tickets WHERE created_at>=? AND status='paid'`).all(today)
    const yesterdayTickets = db.prepare(`SELECT * FROM tickets WHERE created_at>=? AND created_at<? AND status='paid'`).all(yesterday, today)

    const todayRevenue = todayTickets.reduce((s, t) => s + t.price_cents, 0)
    const yesterdayRevenue = yesterdayTickets.reduce((s, t) => s + t.price_cents, 0)
    const revenueChange = yesterdayRevenue > 0 ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0

    const techCount = db.prepare(`SELECT COUNT(*) AS c FROM technicians WHERE active=1`).get().c
    const newCustomers = db.prepare(`SELECT COUNT(*) AS c FROM customers WHERE created_at>=?`).get(today).c
    const topups = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM wallet_transactions WHERE type='topup' AND created_at>=?`).get(today)

    const data = {
      revenue: todayRevenue,
      ticketCount: todayTickets.length,
      avgTicket: todayTickets.length > 0 ? Math.round(todayRevenue / todayTickets.length) : 0,
      techCount,
      newCustomers,
      topupAmount: topups.total,
      comparison: { revenueChange },
    }

    try {
      const report = await aiBusinessReport(data)
      return { ok: true, data, report }
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message })
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function maskKey(key) {
  if (!key || key.length < 8) return key ? '***' : ''
  return key.slice(0, 4) + '***' + key.slice(-4)
}
