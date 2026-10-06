/**
 * 顾客端凭证工具测试
 * 运行：JWT_SECRET=test npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-guest-token'
const { createGuestToken, verifyGuestToken, sanitizeGuestTicket } = await import('../src/auth/guest-token.js')

test('签发并校验成功', () => {
  const tk = createGuestToken('ticket123', 'shopABC')
  const r = verifyGuestToken(tk, 'ticket123')
  assert.ok(r, '应校验通过')
  assert.equal(r.ticketId, 'ticket123')
  assert.equal(r.shopId, 'shopABC')
})

test('IDOR 防护：ticket_id 不匹配则拒绝', () => {
  const tk = createGuestToken('ticket123', 'shopABC')
  assert.equal(verifyGuestToken(tk, 'otherTicket'), null, '不匹配必须拒绝')
})

test('篡改载荷则签名失效', () => {
  const tk = createGuestToken('ticket123', 'shopABC')
  const [payload, sig] = tk.split('.')
  const forged = Buffer.from(JSON.stringify({
    t: 'attackerTicket', s: 'shopABC', e: Date.now() + 86400000,
  })).toString('base64url')
  assert.equal(verifyGuestToken(`${forged}.${sig}`, 'attackerTicket'), null, '篡改必须拒绝')
})

test('过期 token 被拒绝', () => {
  // 签发时间设为 25 小时前 → 已过期
  const tk = createGuestToken('ticket123', 'shopABC', Date.now() - 25 * 3600 * 1000)
  assert.equal(verifyGuestToken(tk, 'ticket123'), null, '过期必须拒绝')
})

test('签名不匹配则拒绝', () => {
  const tk = createGuestToken('ticket123', 'shopABC')
  const [payload] = tk.split('.')
  assert.equal(verifyGuestToken(`${payload}.wrongsignature`, 'ticket123'), null)
})

test('空值/畸形输入不抛异常', () => {
  for (const bad of [null, undefined, '', 'nodot', 'a.b.c', 123, {}]) {
    assert.equal(verifyGuestToken(bad, 'x'), null, `输入 ${JSON.stringify(bad)} 应返回 null`)
  }
})

test('脱敏移除内部字段', () => {
  const out = sanitizeGuestTicket({
    id: 't1', service_name: '足浴', price_cents: 9800,
    commission_cents: 1960, shop_id: 's1', customer_id: 'c1',
    notes: '内部备注', customer_name: '张三丰', customer_phone: '13812345678',
  })
  assert.equal(out.commission_cents, undefined, '提成不应返回')
  assert.equal(out.shop_id, undefined, 'shop_id 不应返回')
  assert.equal(out.notes, undefined, '备注不应返回')
  assert.equal(out.customer_name, '张**', '姓名应脱敏')
  assert.equal(out.customer_phone, '138****5678', '手机号应脱敏')
  assert.equal(out.service_name, '足浴', '业务字段应保留')
  assert.equal(out.price_cents, 9800, '价格应保留')
})
