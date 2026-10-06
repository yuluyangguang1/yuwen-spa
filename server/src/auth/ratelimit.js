// 轻量 Rate Limiter（内存，单进程够用）
//
// 设计要点：限流键必须区分「谁」，不能只用 IP。
//
// 原因：店内所有顾客和员工设备都通过同一个 WiFi 出口 IP 访问本机服务，
// 按 IP 限流会让所有人共享一个计数器 —— 一个人异常刷请求，全店一起被 429。
//
// 分层策略（见 clientKey）：
//   1. 已登录员工 → user:<id>     （每账号独立桶）
//   2. 顾客（持 guest_token）→ guest:<ticketId>（每单独立桶）
//   3. 匿名请求 → ip:<addr>       （兜底，如登录、健康检查）

const attempts = new Map()  // key -> { count, resetAt }

// 定期清理过期记录（每 5 分钟）；unref 避免阻止进程退出
const cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, data] of attempts) {
    if (now > data.resetAt) attempts.delete(key)
  }
}, 5 * 60000)
cleanupTimer.unref?.()

/**
 * 生成限流键：优先用身份标识，其次回落 IP。
 *
 * 关键：同一店内多人共享出口 IP，所以「能识别身份时绝不按 IP 限流」。
 *
 * @param {object} req  Fastify request（可能已带 req.user）
 * @param {string} ns   命名空间（不同用途的额度互相独立，如 'read'/'write'）
 */
export function clientKey(req, ns = 'default') {
  // 1. 已登录员工（hook 会填充 req.user）
  const uid = req?.user?.sub || req?.user?.id
  if (uid) return `${ns}|user:${uid}`

  // 2. 顾客：从 guest_token 提取 ticket_id（顾客端凭证，绑定单张钟单）
  const tid = req?.guestTicketId
  if (tid) return `${ns}|guest:${tid}`

  // 3. 匿名兜底
  return `${ns}|ip:${req?.ip || 'unknown'}`
}

export function checkRateLimit(key, { maxAttempts = 10, windowMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now()
  const data = attempts.get(key)

  if (!data || now > data.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: maxAttempts - 1 }
  }

  if (data.count >= maxAttempts) {
    const retryAfter = Math.ceil((data.resetAt - now) / 1000)
    return { ok: false, retryAfter }
  }

  data.count++
  return { ok: true, remaining: maxAttempts - data.count }
}

/** 供测试/诊断：当前活跃桶数量 */
export function rateLimitStats() {
  return { buckets: attempts.size }
}
