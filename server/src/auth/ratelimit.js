// 轻量 Rate Limiter（内存，单进程够用）
//
// 用于保护登录接口，防止暴力破解。
// 规则：同一 IP 5 分钟内最多 10 次登录尝试。

const attempts = new Map()  // ip -> { count, resetAt }

// 定期清理过期记录（每 5 分钟）
setInterval(() => {
  const now = Date.now()
  for (const [ip, data] of attempts) {
    if (now > data.resetAt) attempts.delete(ip)
  }
}, 5 * 60000)

export function checkRateLimit(ip, { maxAttempts = 10, windowMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now()
  const data = attempts.get(ip)

  if (!data || now > data.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: maxAttempts - 1 }
  }

  if (data.count >= maxAttempts) {
    const retryAfter = Math.ceil((data.resetAt - now) / 1000)
    return { ok: false, retryAfter }
  }

  data.count++
  return { ok: true, remaining: maxAttempts - data.count }
}
