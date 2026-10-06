// Auth Hook：保护 /api/* 路由
//
// 白名单路由（不需要登录）：
//   /api/health, /api/system, /api/auth/login
//   /api/reviews/* （顾客评价是公开的）
//   /api/guest/*   （顾客端 QR 入口）
//
// 其余 /api/* 都需要 Bearer token

import { extractToken } from '../routes/auth.js'
import { AuthError, PermissionError } from '../lib/errors.js'
import { verifyGuestToken } from './guest-token.js'

const PUBLIC_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/realtime',   // WebSocket 升级在 bus.js 内自校验 JWT（HTTP 层放行）
  // 支付网关服务器回调（验签在路由内完成）
  '/api/payment/wechat/notify',
  '/api/payment/alipay/notify',
]

function isPublic(path) {
  if (PUBLIC_PATHS.includes(path)) return true
  if (path.startsWith('/api/guest')) return true      // 顾客端入口
  // 技师主页：顾客扫码查看（路由内对未登录做脱敏）
  if (/^\/api\/technicians\/[^/]+\/profile$/.test(path)) return true
  // 评价：仅 GET 公开（扫码查看）；POST 提交必须登录
  if (path.startsWith('/api/reviews') ) return false
  return false
}

export async function registerAuthHook(fastify) {
  fastify.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    const path = req.url.split('?')[0]

    // 公开路径：不要求登录，但仍尽力识别「顾客身份」以便限流分桶。
    // 顾客端请求带 ?t=<guest_token>，解出 ticket_id 后挂到 req，
    // 这样限流按「单」计额度，而不是让全店顾客共用一个 IP 桶。
    if (isPublic(path) || (path.startsWith('/api/reviews') && req.method === 'GET')) {
      try {
        const t = req.query?.t
        if (t && typeof t === 'string') {
          // onRequest 阶段 req.params 尚未解析，从 URL 路径取 ticket_id
          const m = path.match(/^\/api\/guest\/tickets\/([^/]+)$/)
          const claim = verifyGuestToken(t, m ? m[1] : undefined)
          if (claim) req.guestTicketId = claim.ticketId
        }
      } catch { /* 识别失败不阻断公开访问，限流会回落 IP 桶 */ }
      return
    }

    try {
      const payload = extractToken(req)
      if (!payload) throw new AuthError('请先登录')

      // 回查用户：token 有效但账号被禁用/删除/改角色时立即失效
      const user = fastify.db.prepare(
        `SELECT id, role, shop_id, technician_id, active FROM users WHERE id=?`
      ).get(payload.sub)
      if (!user || user.active !== 1) throw new AuthError('账号已禁用或不存在')

      req.user = {
        ...payload,
        role: user.role,          // 以数据库为准，旧 admin token 降权后失效
        shop_id: user.shop_id,
        technician_id: user.technician_id,
      }
      if (!req.user.shop_id) {
        throw new AuthError('令牌无效：缺少 shop_id')
      }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      req.log.error(e)
      throw new AuthError('令牌无效')
    }
  })
}
