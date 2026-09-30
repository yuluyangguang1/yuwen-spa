// AI Agent API 路由
//
// - 配置管理（设置 provider / API key / 模型）
// - AI 对话（老板自然语言问数据）
// - AI 月度评分（真 LLM 分析评价文本）
// - AI 经营日报

import { nanoid } from 'nanoid'
import {
  getAIConfig, saveAIConfig, ask, isAIEnabled, checkAIEndpointStatus, chatCompletionStream
} from '../ai/provider.js'
import {
  aiScoreTechnician, aiBusinessReport, aiChat, aiScheduleSuggestion,
  aiForecastCommentary, aiAnomalyBrief, aiBusinessReportStream
} from '../ai/agent.js'
import { checkRateLimit } from '../auth/ratelimit.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'

export async function registerAIRoutes(fastify) {
  const db = fastify.db
  // 营收/对话类 AI 读取：admin/pos/cs（tech 不可见）；配置仅 admin
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }
  const adminOnly = { preHandler: requireRole('admin') }

  // ── 配置管理 ─────────────────────────────────────────
  // 获取当前 AI 配置 + 端点状态
  fastify.get('/api/ai/config', adminOnly, async (req, reply) => {
    try {
      if (!req.user) return reply.code(401).send({ error: '未登录' })
      const config = getAIConfig()
      const status = await checkAIEndpointStatus()
      const { apiKey, ...safe } = config
      return {
        ...safe,
        hasApiKey: !!(apiKey && apiKey.trim()),
        endpointStatus: status,
      }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.post('/api/ai/config', adminOnly, async (req, reply) => {
    try {
      const { baseUrl, apiKey, model, enabled, hermesUrl } = req.body || {}
      const current = getAIConfig()
      const newConfig = {
        baseUrl: (baseUrl !== undefined ? baseUrl : undefined)
          || hermesUrl
          || current.baseUrl,
        apiKey: apiKey !== undefined ? apiKey : current.apiKey,
        model: model !== undefined ? model : current.model,
        enabled: enabled !== undefined ? enabled : current.enabled,
      }
      saveAIConfig(newConfig)
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // 测试 AI 连接 —— 仅 admin，避免产生无关 LLM 费用
  fastify.post('/api/ai/test', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      const rl = checkRateLimit(`${req.ip}|ai-test`, { maxAttempts: 10, windowMs: 5 * 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `测试过于频繁，请 ${rl.retryAfter} 秒后重试` })
      const status = await checkAIEndpointStatus()
      if (!status.online) {
        return reply.code(500).send({
          ok: false,
          error: `AI 端点不可达 (${status.url || '未配置'})${status.error ? `: ${status.error}` : ''}`,
        })
      }
      const result = await ask('回复"连接成功"四个字', '你是一个测试助手，只回复用户要求的内容。')
      return { ok: true, response: result }
    } catch (e) {
      throw e
    }
  })

  // ── AI 对话（老板助手）────────────────────────────────

  // 获取对话历史（最近 N 条）
  // 兼容前端 { messages }，同时带 total/page/pageSize（messages 为当前窗口）
  fastify.get('/api/ai/chats', staffOnly, async (req, reply) => {
    try {
      const limit = Math.min(Number(req.query?.limit) || 50, 200)
      const total = Number(db.prepare(
        `SELECT COUNT(*) AS total FROM ai_chats WHERE shop_id = ?`
      ).get(req.user.shop_id)?.total ?? 0)
      const rows = db.prepare(`
        SELECT role, content, created_at FROM ai_chats
        WHERE shop_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(req.user.shop_id, limit)
      return {
        messages: rows.reverse(),
        total,
        page: 1,
        pageSize: rows.length || limit,
      }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // 清空对话历史
  fastify.delete('/api/ai/chats', async (req, reply) => {
    try {
      db.prepare(`DELETE FROM ai_chats WHERE shop_id = ?`).run(req.user.shop_id)
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.post('/api/ai/chat', staffOnly, async (req, reply) => {
    try {
      if (!isAIEnabled()) {
        return reply.code(400).send({ error: 'AI 未启用，请先在后台 AI 设置中开启' })
      }
      const rl = checkRateLimit(`${req.ip}|${req.user.sub}|ai-chat`, { maxAttempts: 20, windowMs: 5 * 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `AI 请求过于频繁，请 ${rl.retryAfter} 秒后重试` })
      const { message } = req.body || {}
      if (!message) return reply.code(400).send({ error: 'message required' })

      const now = Date.now()

      // 保存用户消息
      db.prepare(`INSERT INTO ai_chats(id, shop_id, role, content, created_at) VALUES(?,?,?,?,?)`)
        .run(nanoid(10), req.user.shop_id, 'user', message, now)

      // 构建上下文：当日经营数据
      const today = startOfDay(Date.now())
      const tickets = db.prepare(`SELECT * FROM tickets WHERE shop_id=? AND created_at>=?`).all(req.user.shop_id, today)
      const paid = tickets.filter(t => t.status === 'paid')
      const techs = db.prepare(`SELECT name, number, level, status, ai_score FROM technicians WHERE shop_id=? AND active=1`).all(req.user.shop_id)

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

        // 保存 AI 回复
        db.prepare(`INSERT INTO ai_chats(id, shop_id, role, content, created_at) VALUES(?,?,?,?,?)`)
          .run(nanoid(10), req.user.shop_id, 'assistant', response, Date.now())

        return { ok: true, response }
      } catch (e) {
        throw e
      }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── AI 月度技师评分（真 LLM 版）──────────────────────

  fastify.post('/api/ai/score-technicians', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      if (!isAIEnabled()) {
        return reply.code(400).send({ error: 'AI 未启用' })
      }
      const rl = checkRateLimit(`${req.ip}|ai-score-tech`, { maxAttempts: 5, windowMs: 5 * 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `请求过于频繁，请 ${rl.retryAfter} 秒后重试` })

      const techs = db.prepare(`SELECT * FROM technicians WHERE shop_id=? AND active=1`).all(req.user.shop_id)
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
          tags: parseJsonSafe(r.tags, []),
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
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── AI 经营日报 ──────────────────────────────────────

  fastify.get('/api/ai/daily-report', staffOnly, async (req, reply) => {
      try {
        if (!isAIEnabled()) {
          return reply.code(400).send({ error: 'AI 未启用' })
        }
        const rl = checkRateLimit(`${req.ip}|ai-daily-report`, { maxAttempts: 10, windowMs: 5 * 60 * 1000 })
        if (!rl.ok) return reply.code(429).send({ error: `请求过于频繁，请 ${rl.retryAfter} 秒后重试` })

        const today = startOfDay(Date.now())
        const yesterday = startOfDay(Date.now() - 86400000)
        const todayTickets = db.prepare(`SELECT * FROM tickets WHERE shop_id=? AND created_at>=? AND status='paid'`).all(req.user.shop_id, today)
        const yesterdayTickets = db.prepare(`SELECT * FROM tickets WHERE shop_id=? AND created_at>=? AND created_at<? AND status='paid'`).all(req.user.shop_id, yesterday, today)

        const todayRevenue = todayTickets.reduce((s, t) => s + t.price_cents, 0)
        const yesterdayRevenue = yesterdayTickets.reduce((s, t) => s + t.price_cents, 0)
        const revenueChange = yesterdayRevenue > 0 ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0

        const techCount = db.prepare(`SELECT COUNT(*) AS c FROM technicians WHERE active=1 AND shop_id=?`).get(req.user.shop_id).c
        const newCustomers = db.prepare(`SELECT COUNT(*) AS c FROM customers WHERE created_at>=? AND shop_id=?`).get(today, req.user.shop_id).c
        const topups = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM wallet_transactions WHERE type IN ('topup','topup_refund') AND created_at>=? AND shop_id=?`).get(today, req.user.shop_id)

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
          throw e
        }
      } catch (e) {
        req.log.error(e)
        throw e
      }
    })

  // ── AI 经营日报（SSE 流式）─────────────────────────────
  // GET /api/ai/daily-report/stream → text/event-stream
  fastify.get('/api/ai/daily-report/stream', staffOnly, async (req, reply) => {
    try {
      if (!isAIEnabled()) return reply.code(400).send({ error: 'AI 未启用' })
      const rl = checkRateLimit(`${req.ip}|ai-report-stream`, { maxAttempts: 10, windowMs: 5 * 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `请求过于频繁，请 ${rl.retryAfter} 秒后重试` })

      const today = startOfDay(Date.now())
      const yesterday = startOfDay(Date.now() - 86400000)
      const todayTickets = db.prepare(`SELECT * FROM tickets WHERE shop_id=? AND created_at>=? AND status='paid'`).all(req.user.shop_id, today)
      const yesterdayTickets = db.prepare(`SELECT * FROM tickets WHERE shop_id=? AND created_at>=? AND created_at<? AND status='paid'`).all(req.user.shop_id, yesterday, today)
      const todayRevenue = todayTickets.reduce((s, t) => s + t.price_cents, 0)
      const yesterdayRevenue = yesterdayTickets.reduce((s, t) => s + t.price_cents, 0)
      const revenueChange = yesterdayRevenue > 0 ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0
      const techCount = db.prepare(`SELECT COUNT(*) AS c FROM technicians WHERE active=1 AND shop_id=?`).get(req.user.shop_id).c
      const newCustomers = db.prepare(`SELECT COUNT(*) AS c FROM customers WHERE created_at>=? AND shop_id=?`).get(today, req.user.shop_id).c
      const topups = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM wallet_transactions WHERE type IN ('topup','topup_refund') AND created_at>=? AND shop_id=?`).get(today, req.user.shop_id)
      const data = {
        revenue: todayRevenue,
        ticketCount: todayTickets.length,
        avgTicket: todayTickets.length > 0 ? Math.round(todayRevenue / todayTickets.length) : 0,
        techCount,
        newCustomers,
        topupAmount: topups.total,
        comparison: { revenueChange },
      }

      reply.hijack()
      const raw = reply.raw
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const send = (obj) => {
        if (raw.writableEnded || raw.destroyed) return
        try { raw.write(`data: ${JSON.stringify(obj)}\n\n`) } catch { /* gone */ }
      }
      const abort = new AbortController()
      const onClientClose = () => abort.abort()
      req.raw.on('close', onClientClose)
      req.raw.on('error', () => { /* 客户端异常断开 */ })
      raw.on('error', () => { /* 防止写已销毁 socket 的 async error 变 uncaught */ })
      send({ meta: data })
      try {
        const report = await aiBusinessReportStream(data, async (delta) => {
          if (abort.signal.aborted) return
          send({ delta })
        }, { signal: abort.signal })
        if (!abort.signal.aborted) send({ done: true, response: report })
      } catch (e) {
        if (!abort.signal.aborted) send({ error: e.message })
      } finally {
        req.raw.off('close', onClientClose)
        try { raw.end() } catch { /* ignore */ }
      }
    } catch (e) {
      req.log.error(e)
      if (!reply.sent) throw e
    }
  })

  // ── AI 流式对话（SSE）────────────────────────────────
  // POST /api/ai/chat/stream  body: { message }
  // 响应: text/event-stream
  //   data: {"delta":"..."}  增量
  //   data: {"done":true,"response":"完整文本"}
  //   data: {"error":"..."}
  fastify.post('/api/ai/chat/stream', staffOnly, async (req, reply) => {
    try {
      if (!isAIEnabled()) {
        return reply.code(400).send({ error: 'AI 未启用，请先在后台 AI 设置中开启' })
      }
      const rl = checkRateLimit(`${req.ip}|${req.user.sub}|ai-chat-stream`, { maxAttempts: 20, windowMs: 5 * 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `AI 请求过于频繁，请 ${rl.retryAfter} 秒后重试` })
      const { message } = req.body || {}
      if (!message) return reply.code(400).send({ error: 'message required' })

      const now = Date.now()
      db.prepare(`INSERT INTO ai_chats(id, shop_id, role, content, created_at) VALUES(?,?,?,?,?)`)
        .run(nanoid(10), req.user.shop_id, 'user', message, now)

      const today = startOfDay(Date.now())
      const tickets = db.prepare(`SELECT * FROM tickets WHERE shop_id=? AND created_at>=?`).all(req.user.shop_id, today)
      const paid = tickets.filter(t => t.status === 'paid')
      const techs = db.prepare(`SELECT name, number, level, status, ai_score FROM technicians WHERE shop_id=? AND active=1`).all(req.user.shop_id)
      const context = {
        today: {
          revenue: paid.reduce((s, t) => s + t.price_cents, 0),
          ticketCount: paid.length,
          activeCount: tickets.filter(t => t.status === 'active').length,
        },
        technicians: techs,
        time: new Date().toLocaleString('zh-CN'),
      }

      reply.hijack()
      const raw = reply.raw
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const send = (obj) => {
        if (raw.writableEnded || raw.destroyed) return
        try { raw.write(`data: ${JSON.stringify(obj)}\n\n`) } catch { /* client gone */ }
      }

      const abort = new AbortController()
      const onClientClose = () => abort.abort()
      req.raw.on('close', onClientClose)
      req.raw.on('error', () => { /* 客户端异常断开 */ })
      raw.on('error', () => { /* 防止写已销毁 socket 的 async error 变 uncaught */ })

      let full = ''
      try {
        const contextPrompt = `\n\n当前门店数据上下文：\n${JSON.stringify(context, null, 2)}`
        full = await chatCompletionStream([
          { role: 'system', content: buildChatSystemPrompt(contextPrompt) },
          { role: 'user', content: message },
        ], {
          temperature: 0.7,
          signal: abort.signal,
          onDelta: async (delta) => {
            if (abort.signal.aborted) return
            send({ delta })
          },
        })
        if (!abort.signal.aborted) {
          db.prepare(`INSERT INTO ai_chats(id, shop_id, role, content, created_at) VALUES(?,?,?,?,?)`)
            .run(nanoid(10), req.user.shop_id, 'assistant', full, Date.now())
          send({ done: true, response: full })
        }
      } catch (e) {
        if (!abort.signal.aborted) send({ error: e.message })
      } finally {
        req.raw.off('close', onClientClose)
        try { raw.end() } catch { /* ignore */ }
      }
    } catch (e) {
      req.log.error(e)
      if (!reply.sent) throw e
    }
  })

  // ── 智能排钟建议 ───────────────────────────────────────
  // POST /api/ai/suggest-dispatch  body: { ticket_id? }
  // 本地评分（AI 关闭也可用）+ 可选 LLM 解读
  fastify.post('/api/ai/suggest-dispatch', staffOnly, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(401).send({ error: '未登录' })
      const rl = checkRateLimit(`${req.ip}|ai-dispatch`, { maxAttempts: 30, windowMs: 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `请求过于频繁，请 ${rl.retryAfter} 秒后重试` })

      const ticketId = req.body?.ticket_id
      let ticket = null
      if (ticketId) {
        ticket = db.prepare(`SELECT * FROM tickets WHERE id=? AND shop_id=?`).get(ticketId, shop_id)
        if (!ticket) return reply.code(404).send({ error: '钟单不存在' })
      }

      const idleTechs = db.prepare(
        `SELECT id, number, name, level, ai_score, avg_rating, review_count, is_star, specialties, status
         FROM technicians WHERE shop_id=? AND active=1 AND status='idle'`
      ).all(shop_id)

      if (idleTechs.length === 0) {
        return { ok: true, recommend: null, reason: '暂无空闲技师', ranked: [], source: 'local' }
      }

      // 近 7 日完成单量（均衡负载）
      const weekAgo = Date.now() - 7 * 86400000
      const loadRows = db.prepare(`
        SELECT technician_id, COUNT(*) AS n FROM tickets
        WHERE shop_id=? AND status IN ('paid','completed') AND created_at>=? AND technician_id IS NOT NULL
        GROUP BY technician_id
      `).all(shop_id, weekAgo)
      const loadMap = Object.fromEntries(loadRows.map(r => [r.technician_id, r.n]))

      // 今日服务过的项目（技能匹配加成）
      const today = startOfDay(Date.now())
      const svcRows = db.prepare(`
        SELECT technician_id, service_id, COUNT(*) AS n FROM tickets
        WHERE shop_id=? AND created_at>=? AND technician_id IS NOT NULL AND service_id IS NOT NULL
        GROUP BY technician_id, service_id
      `).all(shop_id, today)
      const svcKey = (tid, sid) => `${tid}|${sid}`

      const targetService = ticket?.service_id || null
      const hour = new Date().getHours()
      const timeSlot = hour >= 18 ? '高峰 18:00-22:00' : hour >= 12 ? '午后' : '日间'

      // 本地启发式打分
      const scored = idleTechs.map(t => {
        let score = 50
        score += (Number(t.ai_score) || 0) * 6          // 0-5 → +30
        score += (Number(t.avg_rating) || 0) * 4
        if (t.is_star) score += 5
        const load = loadMap[t.id] || 0
        score -= Math.min(load * 2, 20)                 // 负载惩罚
        if (targetService && svcRows.some(r => r.technician_id === t.id && r.service_id === targetService)) {
          score += 8 // 今日做过同项目
        }
        // 星级/高分技师高峰时段优先
        if (hour >= 18 && (Number(t.ai_score) || 0) >= 4) score += 6
        return {
          id: t.id,
          number: t.number,
          name: t.name,
          level: t.level,
          ai_score: t.ai_score,
          avg_rating: t.avg_rating,
          is_star: !!t.is_star,
          recent_7d: load,
          score: Math.round(score * 10) / 10,
        }
      }).sort((a, b) => b.score - a.score)

      const best = scored[0]
      let reason = `综合评分最高（AI分 ${best.ai_score || '-'} · 近7日 ${best.recent_7d} 单 · 总分 ${best.score}）`
      let source = 'local'
      let aiReason = null

      // 有 AI 时补充一句话解读（失败不影响本地推荐）
      if (isAIEnabled()) {
        try {
          const context = {
            idleTechs: scored.slice(0, 8),
            waitingCount: db.prepare(
              `SELECT COUNT(*) c FROM tickets WHERE shop_id=? AND status IN ('pending','active') AND (technician_id IS NULL OR status='pending')`
            ).get(shop_id).c,
            timeSlot,
            serviceName: ticket ? (db.prepare(`SELECT name FROM services WHERE id=?`).get(ticket.service_id)?.name || '') : '',
            customerPreference: '',
            recentLoad: Object.fromEntries(scored.map(s => [s.name, s.recent_7d])),
          }
          const text = await aiScheduleSuggestion(context)
          aiReason = text
          const m = /推荐[:：]\s*(.+?)(?:\n|$)/.exec(text)
          if (m) {
            const name = m[1].trim()
            const hit = scored.find(s => s.name === name || s.name.includes(name) || name.includes(s.name))
            if (hit) {
              reason = (text.match(/理由[:：]\s*(.+)/)?.[1] || reason).trim()
              // LLM 点名则置顶
              const idx = scored.findIndex(s => s.id === hit.id)
              if (idx > 0) { const [row] = scored.splice(idx, 1); scored.unshift(row) }
              source = 'ai'
            }
          }
        } catch { /* AI 失败回退 local */ }
      }

      const top = source === 'ai' ? scored[0] : best
      return {
        ok: true,
        recommend: top,
        ranked: scored.slice(0, 10),
        reason,
        source,
        ai_raw: aiReason,
        timeSlot,
      }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 营收预测 ───────────────────────────────────────────
  // GET /api/ai/forecast?days=30&horizon=7
  // 本地线性回归 + 移动平均；AI 启用时附加解读
  fastify.get('/api/ai/forecast', staffOnly, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(401).send({ error: '未登录' })
      const days = Math.min(Math.max(Number(req.query?.days) || 30, 7), 180)
      const horizon = Math.min(Math.max(Number(req.query?.horizon) || 7, 1), 14)

      const end = startOfDay(Date.now())
      const start = end - (days - 1) * 86400000

      // 按本地日聚合已结营收
      const rows = db.prepare(`
        SELECT DATE(created_at/1000,'unixepoch','localtime') AS d,
               COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END),0) AS revenue,
               SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_count
        FROM tickets
        WHERE shop_id=? AND created_at>=? AND created_at<?
        GROUP BY d ORDER BY d
      `).all(shop_id, start, end + 86400000)

      const byDate = Object.fromEntries(rows.map(r => [r.d, r]))
      const series = []
      for (let i = 0; i < days; i++) {
        const dt = new Date(start + i * 86400000)
        const key = localDate(dt)
        const r = byDate[key]
        series.push({ date: key, revenue: r?.revenue || 0, tickets: r?.paid_count || 0 })
      }

      const values = series.map(s => s.revenue)
      const n = values.length
      const avg = n ? values.reduce((a, b) => a + b, 0) / n : 0
      // 简单线性回归 y = a + b*x
      let b = 0
      if (n >= 2) {
        const meanX = (n - 1) / 2
        const meanY = avg
        let num = 0, den = 0
        for (let i = 0; i < n; i++) {
          num += (i - meanX) * (values[i] - meanY)
          den += (i - meanX) ** 2
        }
        b = den ? num / den : 0
      }
      const a = avg - b * ((n - 1) / 2)
      // 7 日移动平均作为平滑基线
      const window = Math.min(7, n)
      const ma = n ? values.slice(-window).reduce((x, y) => x + y, 0) / window : 0

      const daily = []
      let next7Total = 0
      for (let h = 1; h <= horizon; h++) {
        const x = n - 1 + h
        const lin = a + b * x
        // 混合：线性 60% + 移动平均 40%，并夹到非负
        const pred = Math.max(0, Math.round(lin * 0.6 + ma * 0.4))
        const d = new Date(end + h * 86400000)
        daily.push({ date: localDate(d), predicted: pred })
        if (h <= 7) next7Total += pred
      }

      const trend = Math.abs(b) < 1 ? '平稳' : b > 0 ? '上升' : '下降'
      const forecast = {
        method: n >= 7 ? 'linear+ma7' : 'mean',
        days,
        horizon,
        avgDaily: Math.round(avg),
        trend,
        slopePerDay: Math.round(b),
        next7Total,
        daily,
        history: series.slice(-14),
      }

      let commentary = null
      if (isAIEnabled()) {
        try { commentary = await aiForecastCommentary(forecast) } catch { /* optional */ }
      }
      return { ok: true, forecast, commentary }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  // ── 异常检测 ───────────────────────────────────────────
  // GET /api/ai/anomalies
  fastify.get('/api/ai/anomalies', staffOnly, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) return reply.code(401).send({ error: '未登录' })
      const anomalies = []
      const now = Date.now()
      const today = startOfDay(now)
      const yest = today - 86400000
      const weekAgo = today - 6 * 86400000
      const prevWeekStart = today - 13 * 86400000

      // 1) 营收日环比骤降
      const revOn = (from, to) => db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END),0) r,
               SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) c
        FROM tickets WHERE shop_id=? AND created_at>=? AND created_at<?
      `).get(shop_id, from, to)
      const todayRev = revOn(today, now)
      const yestRev = revOn(yest, today)
      if (yestRev.r > 0 && todayRev.r >= 0 && now - today > 4 * 3600000) {
        // 至少营业 4 小时后再比
        const dropPct = Math.round(((yestRev.r - todayRev.r) / yestRev.r) * 100)
        if (dropPct >= 40 && yestRev.r - todayRev.r > 10000) {
          anomalies.push({
            type: 'revenue_drop',
            severity: dropPct >= 60 ? 'high' : 'medium',
            title: '今日营收环比大幅下滑',
            detail: `较昨日同时段/全天已降 ${dropPct}%（昨日 ¥${(yestRev.r / 100).toFixed(0)} → 今日 ¥${(todayRev.r / 100).toFixed(0)}）`,
            metrics: { today: todayRev.r, yesterday: yestRev.r, dropPct },
          })
        }
      }

      // 2) 高峰时段（18-22）零成交
      if (now >= today + 22 * 3600000) {
        const peak = db.prepare(`
          SELECT COUNT(*) c FROM tickets
          WHERE shop_id=? AND status='paid' AND created_at>=? AND created_at<?
            AND CAST(strftime('%H', created_at/1000,'unixepoch','localtime') AS INT) BETWEEN 18 AND 21
        `).get(shop_id, today, today + 22 * 3600000)
        if (peak.c === 0) {
          anomalies.push({
            type: 'peak_zero',
            severity: 'high',
            title: '高峰时段零成交',
            detail: '18:00-22:00 无任何已结钟单，需检查客流与排钟',
            metrics: { peakPaid: 0 },
          })
        }
      }

      // 3) 技师流失风险：近 7 日单量较前 7 日下降 ≥60% 且前周 ≥4 单
      const loadByWeek = (from, to) => Object.fromEntries(db.prepare(`
        SELECT technician_id, COUNT(*) n FROM tickets
        WHERE shop_id=? AND status IN ('paid','completed') AND created_at>=? AND created_at<? AND technician_id IS NOT NULL
        GROUP BY technician_id
      `).all(shop_id, from, to).map(r => [r.technician_id, r.n]))
      const prevLoad = loadByWeek(prevWeekStart, weekAgo)
      const curLoad = loadByWeek(weekAgo, today + 86400000)
      const techs = db.prepare(`SELECT id, name, number FROM technicians WHERE shop_id=? AND active=1`).all(shop_id)
      for (const t of techs) {
        const p = prevLoad[t.id] || 0
        const c = curLoad[t.id] || 0
        if (p >= 4 && c === 0) {
          anomalies.push({
            type: 'tech_attrition',
            severity: 'high',
            title: `技师 ${t.number}号 ${t.name} 接单骤停`,
            detail: `前 7 日完成 ${p} 单，近 7 日 0 单，存在流失/闲置风险`,
            metrics: { technician_id: t.id, prev: p, cur: c },
          })
        } else if (p >= 4 && c / p <= 0.4) {
          anomalies.push({
            type: 'tech_attrition',
            severity: 'medium',
            title: `技师 ${t.number}号 ${t.name} 接单明显下滑`,
            detail: `前 7 日 ${p} 单 → 近 7 日 ${c} 单（降 ${Math.round((1 - c / p) * 100)}%）`,
            metrics: { technician_id: t.id, prev: p, cur: c },
          })
        }
      }

      // 4) 低分评价聚集（近 14 日均分 < 3 或差评 ≥2）
      const lowReviews = db.prepare(`
        SELECT technician_id, COUNT(*) n, AVG(rating) avg_r FROM reviews
        WHERE shop_id=? AND created_at>=? AND technician_id IS NOT NULL
        GROUP BY technician_id HAVING AVG(rating) < 3 OR COUNT(CASE WHEN rating<=2 THEN 1 END) >= 2
      `).all(shop_id, today - 14 * 86400000)
      for (const r of lowReviews) {
        const tech = techs.find(t => t.id === r.technician_id)
        anomalies.push({
          type: 'low_rating',
          severity: 'medium',
          title: `技师 ${tech?.number || ''}号 ${tech?.name || '未知'} 评价偏低`,
          detail: `近 14 日均分 ${Number(r.avg_r).toFixed(1)}，差评需跟进`,
          metrics: { technician_id: r.technician_id, avg_rating: r.avg_r, count: r.n },
        })
      }

      // 5) 库存偏低
      const lowStock = db.prepare(`
        SELECT id, name, stock FROM products
        WHERE shop_id=? AND active=1 AND stock IS NOT NULL AND stock<=3
        ORDER BY stock ASC LIMIT 10
      `).all(shop_id)
      for (const p of lowStock) {
        anomalies.push({
          type: 'low_stock',
          severity: p.stock <= 0 ? 'high' : 'medium',
          title: `商品「${p.name}」库存不足`,
          detail: `当前库存 ${p.stock}，请及时补货`,
          metrics: { product_id: p.id, stock: p.stock },
        })
      }

      // 6) 本周营收 vs 上周（完整周比较，仅当本周已过 3 天）
      if (now - today >= 3 * 86400000) {
        const curW = revOn(weekAgo, now).r
        const prevW = revOn(prevWeekStart, weekAgo).r
        if (prevW > 0) {
          const drop = Math.round(((prevW - curW) / prevW) * 100)
          if (drop >= 30 && prevW - curW > 50000) {
            anomalies.push({
              type: 'weekly_drop',
              severity: drop >= 50 ? 'high' : 'medium',
              title: '本周营收较上周明显下滑',
              detail: `近 7 日 ¥${(curW / 100).toFixed(0)} vs 前 7 日 ¥${(prevW / 100).toFixed(0)}（-${drop}%）`,
              metrics: { current: curW, previous: prevW, dropPct: drop },
            })
          }
        }
      }

      anomalies.sort((x, y) => (x.severity === 'high' ? 0 : 1) - (y.severity === 'high' ? 0 : 1))

      let brief = null
      if (isAIEnabled() && anomalies.length) {
        try { brief = await aiAnomalyBrief(anomalies) } catch { /* optional */ }
      }

      return { ok: true, anomalies, brief, checked_at: now }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function localDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildChatSystemPrompt(contextPrompt) {
  return `你是"足韵"足浴门店管理系统的内置 AI 助手。你的角色是帮助门店老板和管理者做经营决策。
- 技师是核心资产，服务质量直接影响回头率
- 排钟效率影响翻台率和营收
- 会员储值是现金流的关键
- 高峰时段（18:00-22:00）需要合理调度
- 顾客评价是改进服务的重要依据

你的回答风格：
- 简洁直接，用数据说话
- 给出可执行的建议，不说空话
- 金额用人民币，时间用24小时制
- 如果数据不足以得出结论，诚实说明${contextPrompt}`
}

function parseJsonSafe(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return fallback }
}
