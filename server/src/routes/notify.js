// 通知配置路由
//
// GET  /api/notify/config   获取通知配置
// POST /api/notify/config   保存通知配置
// POST /api/notify/test     测试 webhook

import { getNotifyConfig, saveNotifyConfig, testWebhook } from '../notify/index.js'

export async function registerNotifyRoutes(fastify) {

  fastify.get('/api/notify/config', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    const config = getNotifyConfig()
    return {
      webhookUrl: config.webhookUrl,
      enabled: config.enabled,
    }
  })

  fastify.post('/api/notify/config', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    const { webhookUrl, enabled } = req.body || {}
    const config = getNotifyConfig()
    if (webhookUrl !== undefined) config.webhookUrl = webhookUrl
    if (enabled !== undefined) config.enabled = enabled
    saveNotifyConfig(config)
    return { ok: true }
  })

  fastify.post('/api/notify/test', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
    try {
      const ok = await testWebhook()
      return ok
        ? { ok: true, message: '发送成功，请检查企业微信群' }
        : { ok: false, error: '发送失败，请检查 webhook 地址' }
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message })
    }
  })
}
