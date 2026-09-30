// 支付回调处理
//
// 微信/支付宝异步通知。
// 安全要求：
//   1. 必须设置 PAYMENT_CALLBACK_SECRET，回调需带 X-Pay-Sign 头（本地部署的共享密钥验签）。
//      生产上正式接入时应替换为微信/支付宝官方 SDK 的 RSA 验签。
//   2. 回调金额必须与订单金额一致，否则拒绝，防止篡改价格。
//   3. 幂等：已支付订单直接返回成功。

import crypto from 'node:crypto'

const CALLBACK_SECRET = process.env.PAYMENT_CALLBACK_SECRET || ''

function verifyCallbackSecret(req) {
  if (!CALLBACK_SECRET) return false
  const sign = req.headers['x-pay-sign']
  if (!sign || typeof sign !== 'string') return false
  const expected = crypto.createHmac('sha256', CALLBACK_SECRET).update(String(req.bodyRaw || '')).digest('hex')
  const a = Buffer.from(sign)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function centsFromYuan(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function pickField(v) {
  if (Array.isArray(v)) return v[0]
  return v
}

export async function registerPaymentRoutes(fastify) {
  const db = fastify.db

  // ── 微信异步通知 ──────────────────────────
  fastify.post('/api/payment/wechat/notify', async (req, reply) => {
    try {
      if (!verifyCallbackSecret(req)) {
        return reply.code(401).type('application/xml')
          .send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[验签失败]]></return_msg></xml>')
      }

      const xml = req.body || {}
      const returnCode = pickField(xml.return_code)
      const resultCode = pickField(xml.result_code)
      const outTradeNo = pickField(xml.out_trade_no)
      const totalFee = pickField(xml.total_fee)  // 微信金额单位为分

      if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
        return reply.code(400).type('application/xml')
          .send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[支付失败]]></return_msg></xml>')
      }

      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(outTradeNo)
      if (!ticket) {
        return reply.code(404).type('application/xml')
          .send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单不存在]]></return_msg></xml>')
      }

      if (ticket.status === 'paid') {
        return reply.code(200).type('application/xml')
          .send('<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>')
      }
      // canceled 是终态，不允许被回调翻成 paid
      if (ticket.status === 'canceled') {
        return reply.code(400).type('application/xml')
          .send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单已取消]]></return_msg></xml>')
      }

      // 金额强校验：回调金额必须等于订单金额
      const payCents = Number(totalFee)
      if (!Number.isInteger(payCents) || payCents !== ticket.price_cents) {
        fastify.log.warn({ outTradeNo, payCents, expected: ticket.price_cents }, 'wechat callback amount mismatch')
        return reply.code(400).type('application/xml')
          .send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[金额不匹配]]></return_msg></xml>')
      }

      const now = Date.now()
      const updated = db.transaction(() => {
        // 事务内再验状态 + 条件更新，防并发双写
        const cur = db.prepare(`SELECT status FROM tickets WHERE id=?`).get(outTradeNo)
        if (!cur || cur.status === 'paid') return cur?.status === 'paid' ? 'already' : 'gone'
        if (cur.status === 'canceled' || cur.status === 'refunded') return 'canceled'
        const res = db.prepare(`UPDATE tickets SET status='paid', paid_at=?, payment_method='wechat', updated_at=? WHERE id=? AND status NOT IN ('paid','canceled','refunded')`)
          .run(now, now, outTradeNo)
        if (res.changes === 0) return 'already'
        db.prepare(`INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at) VALUES(?, ?, 'ticket.pay', 'ticket', ?, ?, ?)`)
          .run(crypto.randomBytes(6).toString('hex'), ticket.shop_id, outTradeNo,
            JSON.stringify({ payment_method: 'wechat', amount_cents: payCents, via: 'callback' }), now)
        if (ticket.room_id) db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
        if (ticket.technician_id) db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)
        return 'ok'
      })()

      if (updated === 'already') {
        return reply.code(200).type('application/xml')
          .send('<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>')
      }
      if (updated === 'canceled' || updated === 'gone') {
        return reply.code(400).type('application/xml')
          .send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单状态无效]]></return_msg></xml>')
      }

      fastify.broadcast({ type: 'ticket:paid', shop_id: ticket.shop_id, data: { id: outTradeNo, status: 'paid' } })

      reply.type('application/xml')
      return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>'
    } catch (e) {
      fastify.log.error(e, 'wechat payment callback error')
      reply.type('application/xml')
      return '<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[处理失败]]></return_msg></xml>'
    }
  })

  // ── 支付宝异步通知 ──────────────────────────
  fastify.post('/api/payment/alipay/notify', async (req, reply) => {
    try {
      if (!verifyCallbackSecret(req)) {
        return reply.code(401).send({ code: 'FAIL', message: '验签失败' })
      }

      const { out_trade_no, trade_status, total_amount } = req.body || {}

      if (trade_status !== 'TRADE_SUCCESS') {
        return reply.code(400).send({ code: 'FAIL', message: '支付状态异常' })
      }

      const ticket = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(out_trade_no)
      if (!ticket) {
        return reply.code(404).send({ code: 'FAIL', message: '订单不存在' })
      }

      if (ticket.status === 'paid') {
        return reply.code(200).send({ code: 'SUCCESS', message: 'OK' })
      }
      if (ticket.status === 'canceled') {
        return reply.code(400).send({ code: 'FAIL', message: '订单已取消' })
      }

      // 金额强校验：不接受客户端改价
      const payCents = centsFromYuan(total_amount)
      if (payCents == null || payCents !== ticket.price_cents) {
        fastify.log.warn({ out_trade_no, payCents, expected: ticket.price_cents }, 'alipay callback amount mismatch')
        return reply.code(400).send({ code: 'FAIL', message: '金额不匹配' })
      }

      const now = Date.now()
      const updated = db.transaction(() => {
        const cur = db.prepare(`SELECT status FROM tickets WHERE id=?`).get(out_trade_no)
        if (!cur || cur.status === 'paid') return cur?.status === 'paid' ? 'already' : 'gone'
        if (cur.status === 'canceled' || cur.status === 'refunded') return 'canceled'
        const res = db.prepare(`UPDATE tickets SET status='paid', paid_at=?, payment_method='alipay', updated_at=? WHERE id=? AND status NOT IN ('paid','canceled','refunded')`)
          .run(now, now, out_trade_no)
        if (res.changes === 0) return 'already'
        db.prepare(`INSERT INTO audit_logs(id, shop_id, action, target_type, target_id, payload, created_at) VALUES(?, ?, 'ticket.pay', 'ticket', ?, ?, ?)`)
          .run(crypto.randomBytes(6).toString('hex'), ticket.shop_id, out_trade_no,
            JSON.stringify({ payment_method: 'alipay', amount_cents: payCents, via: 'callback' }), now)
        if (ticket.room_id) db.prepare(`UPDATE rooms SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.room_id)
        if (ticket.technician_id) db.prepare(`UPDATE technicians SET status='idle', updated_at=? WHERE id=?`).run(now, ticket.technician_id)
        return 'ok'
      })()

      if (updated === 'already') return { code: 'SUCCESS', message: 'OK' }
      if (updated === 'canceled' || updated === 'gone') {
        return reply.code(400).send({ code: 'FAIL', message: '订单状态无效' })
      }

      fastify.broadcast({ type: 'ticket:paid', shop_id: ticket.shop_id, data: { id: out_trade_no, status: 'paid' } })

      return { code: 'SUCCESS', message: 'OK' }
    } catch (e) {
      fastify.log.error(e, 'alipay payment callback error')
      return reply.code(500).send({ code: 'FAIL', message: '处理失败' })
    }
  })
}
