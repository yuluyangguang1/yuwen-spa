// 技师 CRUD + 状态切换（idle/working/break/off）

import { nanoid } from 'nanoid'
import { BusinessError, NotFoundError, ValidationError, PermissionError, ConflictError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

export async function registerTechnicianRoutes(fastify) {
  function requireAdmin(req) {
    if (req.user?.role !== 'admin') throw new PermissionError('仅管理员可操作')
  }

  // ── 列表（分页）─────────────────────────────────
  fastify.get('/api/technicians', async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError()
      const { page, pageSize, offset } = parsePagination(req)
      const active = req.query.active
      const cacheKey = `technicians:${shop_id}:${page}:${pageSize}:${active || 'all'}`
      const cached = fastify.cache.get(cacheKey)
      if (cached !== undefined) return cached
      const activeCond = active === '1' ? ' AND active=1' : active === '0' ? ' AND active=0' : ''
      const all = fastify.db.prepare(
        `SELECT * FROM technicians WHERE shop_id = ?${activeCond} ORDER BY number LIMIT ? OFFSET ?`
      ).all(shop_id, pageSize, offset)
      const total = fastify.db.prepare(
        `SELECT COUNT(*) AS total FROM technicians WHERE shop_id = ?${activeCond}`
      ).get(shop_id).total
      const result = { data: all, total, page, pageSize }
      fastify.cache.set(cacheKey, result, 60000)
      return result
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 创建 ──────────────────────────────────────
  fastify.post('/api/technicians', async (req, reply) => {
    try {
      requireAdmin(req)
      const shop_id = req.user.shop_id
      const { number, name, level, phone } = req.body || {}
      if (!number || !name) throw new ValidationError('missing fields')
      const id = nanoid(10)
      const now = Date.now()
      try {
        fastify.db.prepare(`
          INSERT INTO technicians(id, shop_id, number, name, level, phone, hired_at, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, shop_id, number, name, level || null, phone || null, now, now, now)
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw new ConflictError('工号已存在')
        throw e
      }
      const newTech = fastify.db.prepare(`SELECT * FROM technicians WHERE id=?`).get(id)
      fastify.cache.invalidate(`technicians:${shop_id}:`)
      return newTech
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 更新 ──────────────────────────────────────
  fastify.put('/api/technicians/:id', async (req, reply) => {
    try {
      requireAdmin(req)
      const existing = fastify.db.prepare(`SELECT shop_id FROM technicians WHERE id=?`).get(req.params.id)
      if (!existing) throw new NotFoundError('not found')
      if (existing.shop_id !== req.user.shop_id) throw new PermissionError('无权限操作该店铺的技师')
      const body = req.body || {}
      if (body.status !== undefined && !['idle', 'working', 'break', 'off'].includes(body.status)) {
        throw new ValidationError('status 必须是 idle/working/break/off')
      }
      if (body.active !== undefined && ![0, 1, true, false, '0', '1'].includes(body.active)) {
        throw new ValidationError('active 非法')
      }
      const fields = ['number', 'name', 'level', 'phone', 'status', 'active']
      const sets = []
      const args = []
      for (const f of fields) {
        if (req.body && req.body[f] !== undefined) {
          sets.push(`${f}=?`)
          args.push(req.body[f])
        }
      }
      // webhook_url 涉及 SSRF，需 URL 白名单
      if (req.body?.webhook_url !== undefined) {
        if (req.body.webhook_url && !isAllowedWebhookUrl(req.body.webhook_url)) {
          throw new ValidationError('webhook_url 必须是企业微信/飞书/钉钉/Slack/Discord 官方域名')
        }
        sets.push(`webhook_url=?`)
        args.push(req.body.webhook_url || null)
      }
      if (!sets.length) throw new ValidationError('no fields')
      sets.push(`updated_at=?`)
      args.push(Date.now(), req.params.id)
      const r = fastify.db.prepare(`UPDATE technicians SET ${sets.join(', ')} WHERE id=? AND shop_id=?`).run(...args, req.user.shop_id)
      if (r.changes === 0) throw new NotFoundError('not found')
      const tech = fastify.db.prepare(`SELECT * FROM technicians WHERE id=?`).get(req.params.id)
      fastify.broadcast({ type: 'technician:updated', shop_id: req.user.shop_id, data: tech })
      fastify.cache.invalidate(`technicians:${req.user.shop_id}:`)
      return tech
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 获取单个技师 ──────────────────────────
  fastify.get('/api/technicians/:id', async (req, reply) => {
    try {
      const tech = fastify.db.prepare(`SELECT * FROM technicians WHERE id=? AND shop_id=?`).get(req.params.id, req.user.shop_id)
      if (!tech) throw new NotFoundError('technician not found')
      return tech
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 当日业绩 ──────────────────────────────────
  fastify.get('/api/technicians/:id/today', async (req, reply) => {
    try {
      const start = startOfDay(Date.now())
      const stat = fastify.db.prepare(`
        SELECT COUNT(*) AS ticket_count,
          COALESCE(SUM(price_cents), 0) AS revenue_cents,
          COALESCE(SUM(commission_cents), 0) AS commission_cents
        FROM tickets WHERE technician_id=? AND shop_id=? AND created_at>=? AND status IN ('completed', 'paid')
      `).get(req.params.id, req.user.shop_id, start)
      return stat
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: e.message })
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const WEBHOOK_HOST_SUFFIXES = [
  'qyapi.weixin.qq.com',
  'open.feishu.cn',
  'oapi.dingtalk.com',
  'hooks.slack.com',
  'discord.com',
  'discordapp.com',
]

function isAllowedWebhookUrl(raw) {
  try {
    const u = new URL(String(raw))
    if (u.protocol !== 'https:') return false
    return WEBHOOK_HOST_SUFFIXES.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
  } catch {
    return false
  }
}
