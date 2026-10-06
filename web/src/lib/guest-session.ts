// 顾客端会话持久化
//
// 场景：顾客进店扫码下单时还没有房间号，拿到 ticket_id + guest_token 后
// 存到 localStorage。刷新页面 / 关掉浏览器再打开时能找回自己的单。
//
// 有效期：与后端 token 一致（24 小时）。本地存 expiresAt 做提前判断，
// 避免用过期 token 反复请求（后端会 403）。

const KEY = 'yuwen_guest_session'
const TTL_MS = 24 * 60 * 60 * 1000  // 与后端 GUEST_TOKEN_TTL 保持一致

export interface GuestSession {
  ticketId: string
  token: string
  savedAt: number
  expiresAt: number
}

/** 保存会话（下单成功后调用） */
export function saveGuestSession(ticketId: string, token: string): GuestSession {
  const now = Date.now()
  const s: GuestSession = { ticketId, token, savedAt: now, expiresAt: now + TTL_MS }
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch { /* 无痕模式可能失败，静默 */ }
  return s
}

/** 读取会话；已过期或损坏返回 null 并自动清理 */
export function loadGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as GuestSession
    if (!s?.ticketId || !s?.token) { clearGuestSession(); return null }
    if (s.expiresAt && s.expiresAt < Date.now()) { clearGuestSession(); return null }
    return s
  } catch {
    clearGuestSession()
    return null
  }
}

/** 清除会话（顾客主动离开 / token 失效时） */
export function clearGuestSession(): void {
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
}

/**
 * 从 URL 读取会话（客服把链接发给顾客，或顾客从聊天记录点开）
 * 支持 ?t=<token>&tid=<ticketId>
 */
export function sessionFromUrl(): GuestSession | null {
  try {
    const p = new URLSearchParams(window.location.search)
    const token = p.get('t')
    const ticketId = p.get('tid')
    if (token && ticketId) return saveGuestSession(ticketId, token)
  } catch { /* 忽略 */ }
  return null
}

/** 生成带凭证的分享链接（顾客可转发给同伴查看进度） */
export function buildSessionUrl(ticketId: string, token: string): string {
  const u = new URL(window.location.origin + '/guest')
  u.searchParams.set('tid', ticketId)
  u.searchParams.set('t', token)
  return u.toString()
}
