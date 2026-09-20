// 通知配置路由
//
// GET  /api/notify/config    获取通知配置（含各渠道状态）
// POST /api/notify/config    保存通知配置（支持多渠道）
// POST /api/notify/test      测试所有启用的 webhook
// GET  /api/notify/channels  获取各渠道状态列表

import { getNotifyConfig, saveNotifyConfig, testWebhook, getChannelStatus } from '../notify/index.js'

export async function registerNotifyRoutes(fastify) {
  // 获取通知配置
  fastify.get('/api/notify/config', async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    const config = getNotifyConfig()
    return {
      channels: config.channels || {},
      channelStatus: getChannelStatus(),
    }
  })

  // 保存通知配置（多渠道）
  fastify.post('/api/notify/config', async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    const { channels } = req.body || {}
    const config = getNotifyConfig()
    if (channels) {
      config.channels = { ...config.channels, ...channels }
    }
    // 兼容旧字段
    if (req.body.webhookUrl !== undefined) {
      config.channels.wechat = { ...config.channels.wechat, webhookUrl: req.body.webhookUrl, enabled: true }
    }
    if (req.body.enabled !== undefined) {
      config.channels.wechat = { ...config.channels.wechat, enabled: req.body.enabled }
    }
    saveNotifyConfig(config)
    return { ok: true, channels: config.channels }
  })

  // 测试所有启用的 webhook
  fastify.post('/api/notify/test', async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    try {
      const results = await testWebhook()
      return { ok: true, message: '测试发送完成，请检查各平台消息' }
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message })
    }
  })

  // 获取各渠道状态
  fastify.get('/api/notify/channels', async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    return { channels: getChannelStatus() }
  })
}
