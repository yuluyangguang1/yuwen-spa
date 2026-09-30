// 通知配置路由
//
// GET  /api/notify/config    获取通知配置（含各渠道状态）
// POST /api/notify/config    保存通知配置（支持多渠道）
// POST /api/notify/test      测试所有启用的 webhook
// GET  /api/notify/channels  获取各渠道状态列表
// GET  /api/notify/history   发送历史（admin，Phase 3）

import { getNotifyConfig, saveNotifyConfig, testWebhook, getChannelStatus } from '../notify/index.js'
import { parsePagination } from '../lib/pagination.js'

const WEBHOOK_HOST_SUFFIXES = [
  'qyapi.weixin.qq.com',
  'open.feishu.cn',
  'oapi.dingtalk.com',
  'hooks.slack.com',
  'discord.com',
  'discordapp.com',
]

function isAllowedWebhookUrl(raw) {
  if (!raw) return true
  try {
    const u = new URL(String(raw))
    if (u.protocol !== 'https:') return false
    return WEBHOOK_HOST_SUFFIXES.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
  } catch {
    return false
  }
}

export async function registerNotifyRoutes(fastify) {
  // 获取通知配置
  fastify.get('/api/notify/config', async (req, reply) => {
    try {
      if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      const shopId = req.user.shop_id
      const config = getNotifyConfig(shopId)
      return {
        channels: config.channels || {},
        channelStatus: getChannelStatus(shopId),
        endWarnMinutes: config.endWarnMinutes || [5],
      }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // 保存通知配置（多渠道）
  fastify.post('/api/notify/config', async (req, reply) => {
    try {
      if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      const shopId = req.user.shop_id
      const { channels } = req.body || {}
      const config = getNotifyConfig(shopId)
      if (channels) {
        // SSRF 防护：webhook URL 必须是已知平台域名
        for (const [key, ch] of Object.entries(channels)) {
          if (ch && ch.webhookUrl && !isAllowedWebhookUrl(ch.webhookUrl)) {
            return reply.code(400).send({ error: `${key} webhook_url 域名不受支持` })
          }
        }
        config.channels = { ...config.channels, ...channels }
      }
      // 兼容旧字段
      if (req.body.webhookUrl !== undefined) {
        if (req.body.webhookUrl && !isAllowedWebhookUrl(req.body.webhookUrl)) {
          return reply.code(400).send({ error: 'webhook_url 域名不受支持' })
        }
        config.channels.wechat = { ...config.channels.wechat, webhookUrl: req.body.webhookUrl, enabled: req.body.enabled !== false }
      }
      if (req.body.enabled !== undefined) {
        config.channels.wechat = { ...config.channels.wechat, enabled: !!req.body.enabled }
      }
      if (req.body.endWarnMinutes !== undefined) {
        const raw = Array.isArray(req.body.endWarnMinutes)
          ? req.body.endWarnMinutes
          : String(req.body.endWarnMinutes || '')
            .split(',')
            .map(s => Number(s.trim()))
        const minutes = [...new Set(raw)]
          .filter(n => Number.isFinite(n) && n > 0 && n <= 480)
          .sort((a, b) => b - a)
        config.endWarnMinutes = minutes.length ? minutes : [5]
      }
      saveNotifyConfig(config, shopId)
      return { ok: true, channels: config.channels, endWarnMinutes: config.endWarnMinutes }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // 测试所有启用的 webhook
  fastify.post('/api/notify/test', async (req, reply) => {
    try {
      if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      try {
        await testWebhook(req.user.shop_id)
        return { ok: true, message: '测试发送完成，请检查各平台消息' }
      } catch (e) {
        throw e
      }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // 测试完钟提醒（广播一发模拟事件，不改库）
  fastify.post('/api/notify/test-end', async (req, reply) => {
    try {
      if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      const shopId = req.user.shop_id
      const stage = Number(req.body?.stage)
      const useEnd = !Number.isFinite(stage) || stage <= 0
      const config = getNotifyConfig(shopId)
      const warn = Array.isArray(config.endWarnMinutes) && config.endWarnMinutes.length
        ? config.endWarnMinutes[0]
        : 5
      const minutes = useEnd ? 0 : (Number.isFinite(stage) && stage > 0 ? Math.floor(stage) : warn)
      const now = Date.now()
      const payload = {
        id: `test-${now}`,
        shop_id: shopId,
        technician_id: null,
        room_id: null,
        service_name: '测试服务',
        technician_name: '测试技师',
        technician_number: '01',
        room_number: '8',
        room_type: '足',
        service_duration: 60,
        started_at: now - (60 - (minutes || 0)) * 60000,
        end_at: now + (minutes || 0) * 60000,
        remain_sec: Math.max(0, minutes * 60),
        stage: minutes || undefined,
        test: true,
      }
      if (typeof fastify.runEndWatchOnce === 'function') {
        // 顺带让真实扫描跑一轮
        try { fastify.runEndWatchOnce() } catch (_) {}
      }
      fastify.broadcast({
        type: useEnd ? 'ticket:end' : 'ticket:ending',
        shop_id: shopId,
        data: payload,
      })
      return { ok: true, type: useEnd ? 'ticket:end' : 'ticket:ending', stage: minutes }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // 获取各渠道状态
  fastify.get('/api/notify/channels', async (req, reply) => {
    try {
      if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      return { channels: getChannelStatus(req.user.shop_id) }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // 通知发送历史（admin）
  fastify.get('/api/notify/history', async (req, reply) => {
    try {
      if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      const shopId = req.user.shop_id
      const { page, pageSize, offset } = parsePagination(req)
      const event = req.query.event
      const where = ['shop_id = ?']
      const args = [shopId]
      if (event) { where.push('event = ?'); args.push(String(event)) }
      const whereSql = ` AND ${where.join(' AND ')}`
      const total = Number(fastify.db.prepare(
        `SELECT COUNT(*) AS total FROM notify_history WHERE 1=1${whereSql}`
      ).get(...args)?.total ?? 0)
      const rows = fastify.db.prepare(`
        SELECT * FROM notify_history WHERE 1=1${whereSql}
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(...args, pageSize, offset)
      const data = rows.map(r => {
        let channels = []
        try { channels = JSON.parse(r.channels || '[]') } catch (_) {}
        return { ...r, channels }
      })
      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}
