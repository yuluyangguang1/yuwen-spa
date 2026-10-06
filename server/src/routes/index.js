// API 路由汇总
//
// 按业务拆分文件，每个文件导出一个注册函数。
// 现阶段只起核心几个，后续每加一个业务模块就新增一个文件 + 在这里挂上。

import { registerAuthHook } from '../auth/hook.js'
import { registerAuthRoutes } from './auth.js'
import { registerUserRoutes } from './users.js'
import { registerHealthRoutes } from './health.js'
import { registerShopRoutes } from './shops.js'
import { registerServiceRoutes } from './services.js'
import { registerProductRoutes } from './products.js'
import { registerTechnicianRoutes } from './technicians.js'
import { registerRoomRoutes } from './rooms.js'
import { registerCustomerRoutes } from './customers.js'
import { registerTicketRoutes } from './tickets.js'
import { registerReviewRoutes } from './reviews.js'
import { registerAIRoutes } from './ai.js'
import { registerNotifyRoutes } from './notify.js'
import { registerDashboardRoutes } from './dashboard.js'
import { registerReportRoutes } from './reports.js'
import { registerPaymentRoutes } from './payment.js'
import { registerGuestRoutes } from './guest.js'
import { registerShiftRoutes } from './shifts.js'
import { registerAuditRoutes } from './audit.js'
import { registerCouponRoutes } from './coupons.js'
import { registerAppointmentRoutes } from './appointments.js'
import { registerInventoryRoutes } from './inventory.js'
import { registerScheduleRoutes } from './schedules.js'
import { registerCommissionRuleRoutes } from './commission-rules.js'
import { registerBackupRoutes } from './backup.js'
import { checkRateLimit, clientKey } from '../auth/ratelimit.js'

// 安全方法：读接口轮询密集，额度放宽；写接口收紧防刷单
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * 全局限流（兜底；敏感端点另有更严限制）
 *
 * 必须在 registerAuthHook 之后注册 —— 依赖 req.user / req.guestTicketId 做分桶。
 */
function registerGlobalRateLimit(fastify) {
  fastify.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    if (req.url.startsWith('/api/health') || req.url.startsWith('/api/realtime')) return

    const isWrite = !SAFE_METHODS.has(req.method)
    const rl = checkRateLimit(clientKey(req, isWrite ? 'global:write' : 'global:read'), {
      maxAttempts: isWrite ? 120 : 1200,
      windowMs: 60 * 1000,
    })
    if (!rl.ok) {
      reply.header('Retry-After', String(rl.retryAfter))
      return reply.code(429).send({
        error: `请求过于频繁，请 ${rl.retryAfter} 秒后重试`,
        code: 'RATE_LIMITED',
      })
    }
  })
}

export async function registerRoutes(fastify) {
  // 1. 先注册 auth hook（拦截未登录请求，并填充 req.user / req.guestTicketId）
  await registerAuthHook(fastify)

  // 2. 全局限流 —— 必须在 auth hook 之后注册
  //    限流按「身份」分桶（员工 user:<id> / 顾客 guest:<ticketId> / 匿名 ip:<addr>），
  //    身份由 auth hook 解析。若在 auth 之前注册，req.user 恒为空，
  //    店内所有设备会共用同一个 IP 桶 —— 一个人刷请求就会挤掉全店。
  registerGlobalRateLimit(fastify)

  // 3. 注册路由
  await registerAuthRoutes(fastify)
  await registerUserRoutes(fastify)
  await registerHealthRoutes(fastify)
  await registerShopRoutes(fastify)
  await registerServiceRoutes(fastify)
  await registerProductRoutes(fastify)
  await registerTechnicianRoutes(fastify)
  await registerRoomRoutes(fastify)
  await registerCustomerRoutes(fastify)
  await registerTicketRoutes(fastify)
  await registerReviewRoutes(fastify)
  await registerAIRoutes(fastify)
  await registerNotifyRoutes(fastify)
  await registerDashboardRoutes(fastify)
  await registerReportRoutes(fastify)
  await registerPaymentRoutes(fastify)
  await registerGuestRoutes(fastify)
  await registerShiftRoutes(fastify)
  await registerAuditRoutes(fastify)
  await registerCouponRoutes(fastify)
  await registerAppointmentRoutes(fastify)
  await registerInventoryRoutes(fastify)
  await registerScheduleRoutes(fastify)
  await registerCommissionRuleRoutes(fastify)
  await registerBackupRoutes(fastify)
}
