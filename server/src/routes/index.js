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

export async function registerRoutes(fastify) {
  // 1. 先注册 auth hook（拦截未登录请求）
  await registerAuthHook(fastify)

  // 2. 注册路由
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
