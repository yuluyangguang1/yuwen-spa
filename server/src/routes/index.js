// API 路由汇总
//
// 按业务拆分文件，每个文件导出一个注册函数。
// 现阶段只起核心几个，后续每加一个业务模块就新增一个文件 + 在这里挂上。

import { registerHealthRoutes } from './health.js'
import { registerShopRoutes } from './shops.js'
import { registerServiceRoutes } from './services.js'
import { registerTechnicianRoutes } from './technicians.js'
import { registerRoomRoutes } from './rooms.js'
import { registerCustomerRoutes } from './customers.js'
import { registerTicketRoutes } from './tickets.js'

export async function registerRoutes(fastify) {
  await registerHealthRoutes(fastify)
  await registerShopRoutes(fastify)
  await registerServiceRoutes(fastify)
  await registerTechnicianRoutes(fastify)
  await registerRoomRoutes(fastify)
  await registerCustomerRoutes(fastify)
  await registerTicketRoutes(fastify)
}
