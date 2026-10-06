/**
 * 冒烟测试 — 黑盒 HTTP，零依赖（node:test + node:assert）
 *
 * 覆盖核心业务闭环：
 *   启动 → 登录 → 认证端点 → 开钟 → 上钟 → 落钟 → 结账 → 回查
 *
 * 运行：
 *   cd server && npm test
 *   DB_DIR=/tmp/xxx npm test        # 指定隔离数据库目录
 *
 * 设计说明：
 *   - 用 DB_DIR 环境变量隔离数据库，不污染生产数据
 *   - 用随机端口，不与其他实例冲突
 *   - 服务作为子进程启动，测试结束自动清理
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(__dirname, '..')
const NODE = process.execPath

// ── 测试夹具 ────────────────────────────────────────────────
let child = null
let baseUrl = ''
let dbDir = ''
let token = ''
let createdTicketId = null

/** 轮询直到服务就绪或超时 */
async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return true
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`服务在 ${timeoutMs}ms 内未就绪`)
}

/** 发请求并返回 { status, body } */
async function req(pathname, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (auth && token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json, raw: text }
}

// ── 生命周期 ────────────────────────────────────────────────
before(async () => {
  dbDir = process.env.DB_DIR || mkdtempSync(path.join(tmpdir(), 'yuwen-smoke-'))
  const port = 18000 + Math.floor(Math.random() * 2000)

  child = spawn(NODE, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DB_DIR: dbDir,
      JWT_SECRET: process.env.JWT_SECRET || 'smoke-test-secret',
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // 收集日志便于调试
  let logBuf = ''
  child.stdout.on('data', (d) => { logBuf += d })
  child.stderr.on('data', (d) => { logBuf += d })
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[服务退出 code=${code}]\n${logBuf.slice(-2000)}`)
  })

  baseUrl = `http://127.0.0.1:${port}`
  await waitForServer(baseUrl)

  // 在 before 里登录，确保所有测试都能拿到 token
  const { status, body } = await req('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { username: 'admin', password: 'admin1234' },
  })
  assert.equal(status, 200, `登录失败: ${JSON.stringify(body)}`)
  token = body.token
})

after(() => {
  if (child) child.kill('SIGTERM')
  if (dbDir && !process.env.DB_DIR) {
    try { rmSync(dbDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

// ── 测试用例 ────────────────────────────────────────────────

test('服务健康检查', { concurrency: 1 }, async () => {
  const { status, body } = await req('/api/health', { auth: false })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
})

test('认证端点可访问', { concurrency: 1 }, async () => {
  const endpoints = [
    '/api/auth/me',
    '/api/dashboard/live',
    '/api/tickets/today',
    '/api/technicians',
    '/api/rooms',
    '/api/services',
    '/api/customers',
    '/api/products',
  ]
  for (const ep of endpoints) {
    const { status } = await req(ep)
    assert.equal(status, 200, `${ep} 返回 ${status}`)
  }
})

test('未授权请求被拒绝', { concurrency: 1 }, async () => {
  const { status } = await req('/api/auth/me', { auth: false })
  assert.equal(status, 401)
})

test('核心业务链路：开钟 → 上钟 → 落钟 → 结账', { concurrency: 1 }, async () => {
  // 取基础数据
  const { body: me } = await req('/api/auth/me')
  const shopId = me.user.shop_id
  assert.ok(shopId, '应有 shop_id')

  // 列表端点返回分页对象 { total, items }
  const { body: roomsRes } = await req('/api/rooms')
  const { body: techsRes } = await req('/api/technicians')
  const { body: svcsRes } = await req('/api/services')
  const rooms = roomsRes.items || roomsRes
  const techs = techsRes.items || techsRes
  const svcs = svcsRes.items || svcsRes
  assert.ok(rooms.length > 0, '应有房间')
  assert.ok(techs.length > 0, '应有技师')
  assert.ok(svcs.length > 0, '应有服务')

  const room = rooms[0]
  const tech = techs[0]
  const svc = svcs[0]

  // 开钟
  let res = await req('/api/tickets', {
    method: 'POST',
    body: { shop_id: shopId, room_id: room.id, technician_id: tech.id, service_id: svc.id },
  })
  assert.equal(res.status, 200, `开钟失败: ${JSON.stringify(res.body)}`)
  assert.ok(res.body.id, '应返回钟单 id')
  createdTicketId = res.body.id

  // 上钟
  res = await req(`/api/tickets/${createdTicketId}/start`, { method: 'POST' })
  assert.equal(res.status, 200, `上钟失败: ${JSON.stringify(res.body)}`)

  // 落钟
  res = await req(`/api/tickets/${createdTicketId}/complete`, { method: 'POST' })
  assert.equal(res.status, 200, `落钟失败: ${JSON.stringify(res.body)}`)

  // 结账
  res = await req(`/api/tickets/${createdTicketId}/pay`, {
    method: 'POST',
    body: { payment_method: 'cash' },
  })
  assert.equal(res.status, 200, `结账失败: ${JSON.stringify(res.body)}`)

  // 回查状态
  const { body: today } = await req('/api/tickets/today')
  const found = (today.tickets || today).find((t) => t.id === createdTicketId)
  assert.ok(found, '应能在今日钟单中找到')
  assert.equal(found.status, 'paid', `状态应为 paid，实际 ${found.status}`)
})

test('静态资源可访问', { concurrency: 1 }, async () => {
  for (const p of ['/', '/manifest.json', '/favicon.ico']) {
    const { status } = await req(p, { auth: false })
    assert.equal(status, 200, `${p} 返回 ${status}`)
  }
})
