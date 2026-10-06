/**
 * 限流分桶测试：验证不同身份/不同顾客互不挤占额度
 *
 * 背景：店内所有顾客和员工共用同一个 WiFi 出口 IP。
 * 若按 IP 限流，一个人刷请求会挤掉全店 —— 这是必须防住的。
 *
 * 运行：JWT_SECRET=test node --test test/ratelimit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-ratelimit'

const { clientKey, checkRateLimit } = await import('../src/auth/ratelimit.js')

// ─── clientKey：身份优先，IP 兜底 ────────────────────
test('已登录员工按 user 分桶，与 IP 无关', () => {
  const a = { user: { sub: 'user-a' }, ip: '192.168.1.10' }
  const b = { user: { sub: 'user-b' }, ip: '192.168.1.10' }   // 同 IP
  assert.notEqual(clientKey(a, 'read'), clientKey(b, 'read'))
})

test('顾客按 ticket_id 分桶，同一 IP 也不互相挤占', () => {
  const g1 = { guestTicketId: 'ticket-1', ip: '192.168.1.10' }
  const g2 = { guestTicketId: 'ticket-2', ip: '192.168.1.10' }  // 同 IP 同店
  assert.notEqual(clientKey(g1, 'read'), clientKey(g2, 'read'))
})

test('匿名请求回落 IP 桶', () => {
  assert.equal(clientKey({ ip: '1.2.3.4' }, 'read'), 'read|ip:1.2.3.4')
})

test('命名空间隔离：读写额度互不影响', () => {
  const req = { user: { sub: 'u1' }, ip: '1.2.3.4' }
  assert.notEqual(clientKey(req, 'global:read'), clientKey(req, 'global:write'))
})

test('员工身份优先于顾客身份', () => {
  const req = { user: { sub: 'u1' }, guestTicketId: 't1', ip: '1.2.3.4' }
  assert.match(clientKey(req, 'x'), /user:u1/)
})

// ─── 核心保证：一人刷爆不影响他人 ────────────────────
test('★ 一个顾客刷爆额度，不影响同店其他顾客', () => {
  const noisy = clientKey({ guestTicketId: 'noisy-ticket', ip: '192.168.1.10' }, 'g')
  const quiet = clientKey({ guestTicketId: 'quiet-ticket', ip: '192.168.1.10' }, 'g')

  // noisy 用光额度
  for (let i = 0; i < 10; i++) checkRateLimit(noisy, { maxAttempts: 10, windowMs: 60000 })
  const r1 = checkRateLimit(noisy, { maxAttempts: 10, windowMs: 60000 })
  assert.equal(r1.ok, false, 'noisy 应被限流')

  // quiet 完全不受影响
  const r2 = checkRateLimit(quiet, { maxAttempts: 10, windowMs: 60000 })
  assert.equal(r2.ok, true, 'quiet 不应受 noisy 影响')
})

test('★ 一个员工刷爆额度，不影响同店其他员工', () => {
  const a = clientKey({ user: { sub: 'emp-a' }, ip: '10.0.0.1' }, 'g')
  const b = clientKey({ user: { sub: 'emp-b' }, ip: '10.0.0.1' }, 'g')
  for (let i = 0; i < 5; i++) checkRateLimit(a, { maxAttempts: 5, windowMs: 60000 })
  assert.equal(checkRateLimit(a, { maxAttempts: 5, windowMs: 60000 }).ok, false)
  assert.equal(checkRateLimit(b, { maxAttempts: 5, windowMs: 60000 }).ok, true)
})

test('★ 顾客刷爆不影响员工（跨身份隔离）', () => {
  const guest = clientKey({ guestTicketId: 'g1', ip: '10.0.0.1' }, 'g')
  const staff = clientKey({ user: { sub: 'emp' }, ip: '10.0.0.1' }, 'g')
  for (let i = 0; i < 5; i++) checkRateLimit(guest, { maxAttempts: 5, windowMs: 60000 })
  assert.equal(checkRateLimit(guest, { maxAttempts: 5, windowMs: 60000 }).ok, false)
  assert.equal(checkRateLimit(staff, { maxAttempts: 5, windowMs: 60000 }).ok, true)
})

test('额度用尽后返回 retryAfter', () => {
  const k = 'test-retry|ip:9.9.9.9'
  for (let i = 0; i < 3; i++) checkRateLimit(k, { maxAttempts: 3, windowMs: 60000 })
  const r = checkRateLimit(k, { maxAttempts: 3, windowMs: 60000 })
  assert.equal(r.ok, false)
  assert.ok(r.retryAfter > 0 && r.retryAfter <= 60)
})

test('窗口过期后额度重置', async () => {
  const k = 'test-reset|ip:8.8.8.8'
  for (let i = 0; i < 2; i++) checkRateLimit(k, { maxAttempts: 2, windowMs: 50 })
  assert.equal(checkRateLimit(k, { maxAttempts: 2, windowMs: 50 }).ok, false)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(checkRateLimit(k, { maxAttempts: 2, windowMs: 50 }).ok, true)
})
