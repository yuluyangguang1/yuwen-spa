// 鉴权工具：JWT + 密码哈希
//
// 用 Node.js 内置 crypto，零外部依赖。
// JWT 用 HMAC-SHA256，密码用 scrypt。

import crypto from 'node:crypto'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in environment variables')
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000  // 7 天

// ── 密码策略 ──────────────────────────────────
export function validatePassword(password) {
  if (password.length < 8) return '密码长度至少为 8 位'
  if (!/[A-Za-z]/.test(password)) return '密码必须包含字母'
  if (!/[0-9]/.test(password)) return '密码必须包含数字'
  return null
}

// ── 密码哈希 ──────────────────────────────────
export function hashPassword(password) {
  const err = validatePassword(password)
  if (err) throw new Error(err)
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const test = crypto.scryptSync(password, salt, 64).toString('hex')
  return test === hash
}

// ── JWT（HMAC-SHA256，零依赖）──────────────────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function sign(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${sig}`
}

export function createToken(user) {
  const now = Date.now()
  return sign({
    sub: user.id,
    role: user.role,
    shop_id: user.shop_id,
    name: user.display_name || user.username,
    iat: now,
    exp: now + TOKEN_EXPIRY,
  })
}

export function verifyToken(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, sig] = parts
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url')

    if (sig !== expected) return null

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp < Date.now()) return null

    return payload
  } catch {
    return null
  }
}
