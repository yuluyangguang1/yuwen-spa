// 顾客端凭证：免登录场景下的订单访问授权
//
// 背景：顾客扫码进店时没有房间号、没有 JWT。下单后拿到 ticket_id，
// 但刷新页面 / 换标签页后需要能找回自己的单，且不能看到别人的单。
//
// 设计：HMAC-SHA256 签名的无状态 token（不落库）
//   载荷：ticket_id + shop_id + exp
//   校验：签名有效 + 未过期 + token 里的 ticket_id 与请求的一致（防 IDOR）
//
// 为什么不只用裸 ticket_id：
//   nanoid(12) 本身很难猜（约 4.7e21 空间），但 ID 会通过 URL 泄露
//   （截图、日志、Referer）。签名 token 能绑定 shop_id 与有效期，
//   泄露后危害可控且会自然过期。
//
// 有效期：24 小时（一次消费场景足够；跨天再扫码即可）

import crypto from 'node:crypto'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in environment variables')

const GUEST_TOKEN_TTL = 24 * 60 * 60 * 1000  // 24 小时

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

/**
 * 为钟单签发顾客访问凭证
 * @param {string} ticketId
 * @param {string} shopId
 * @param {number} [issuedAt] 签发时间，默认当前
 * @returns {string} token
 */
export function createGuestToken(ticketId, shopId, issuedAt = Date.now()) {
  const payload = b64url(JSON.stringify({
    t: ticketId,
    s: shopId,
    e: issuedAt + GUEST_TOKEN_TTL,
  }))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/**
 * 校验顾客凭证
 * @param {string} token
 * @param {string} expectTicketId 请求中的 ticket_id（防 IDOR：必须与 token 内一致）
 * @returns {{ticketId: string, shopId: string} | null} 校验通过返回载荷，否则 null
 */
export function verifyGuestToken(token, expectTicketId) {
  try {
    if (!token || typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 2) return null

    const [payload, sig] = parts
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url')

    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.e || data.e < Date.now()) return null          // 已过期
    if (expectTicketId && data.t !== expectTicketId) return null  // IDOR 防护

    return { ticketId: data.t, shopId: data.s }
  } catch {
    return null
  }
}

/**
 * 顾客端字段脱敏：移除内部字段，隐藏敏感信息
 * @param {object} row 原始行
 * @returns {object} 可安全返回给顾客的对象
 */
export function sanitizeGuestTicket(row) {
  if (!row) return row
  const {
    commission_cents,      // 技师提成，与顾客无关
    shop_id,               // 内部 ID
    customer_id,           // 内部 ID
    notes,                 // 可能含内部备注
    ...safe
  } = row
  // 顾客姓名脱敏（保留姓氏）
  if (safe.customer_name) {
    const n = String(safe.customer_name)
    safe.customer_name = n.length > 1 ? `${n[0]}**` : n
  }
  if (safe.customer_phone) {
    const p = String(safe.customer_phone)
    safe.customer_phone = p.length >= 7 ? `${p.slice(0, 3)}****${p.slice(-4)}` : '****'
  }
  return safe
}

export const GUEST_TOKEN_TTL_MS = GUEST_TOKEN_TTL
