// 通知配置路由
//
// GET  /api/notify/config    获取通知配置（含各渠道状态）
// POST /api/notify/config    保存通知配置（支持多渠道）
// POST /api/notify/test      测试所有启用的 webhook
// GET  /api/notify/channels  获取各渠道状态列表

import { getNotifyConfig, saveNotifyConfig, testWebhook, getChannelStatus } from '../notify/index.js'

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
      saveNotifyConfig(config, shopId)
      return { ok: true, channels: config.channels }
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
        return reply.code(500).send({ ok: false, error: e.message })
      }
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
}
