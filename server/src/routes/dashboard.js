// 客服实时看板 API
//
// GET /api/dashboard/live — 一次返回技师状态 + 房间状态 + 当前钟单
// 供客服/前台实时查看全场情况

import { ValidationError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import { requireRole, STAFF_ROLES } from '../auth/roles.js'

export async function registerDashboardRoutes(fastify) {
  const db = fastify.db

  // 看板含营收/顾客信息：admin/pos/cs 可见，tech 不可见
  fastify.get('/api/dashboard/live', { preHandler: requireRole(...STAFF_ROLES) }, async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new ValidationError('缺少 shop_id')
      const start = startOfDay(Date.now())

      // 技师总数
      const techsTotal = db.prepare(
        `SELECT COUNT(*) AS total FROM technicians WHERE active = 1 AND shop_id = ?`
      ).get(shop_id)

      // 技师列表 + 当前服务
      const techs = db.prepare(`
        SELECT t.id, t.number, t.name, t.level, t.status, t.ai_score,
          tk.id AS ticket_id, tk.status AS ticket_status,
          tk.started_at, tk.created_at AS ticket_created,
          s.name AS service_name, s.duration AS service_duration,
          r.number AS room_number, r.type AS room_type,
          c.name AS customer_name
        FROM technicians t
        LEFT JOIN tickets tk ON tk.technician_id = t.id
          AND tk.status IN ('active', 'pending')
          AND tk.created_at >= ?
        LEFT JOIN services s ON tk.service_id = s.id
        LEFT JOIN rooms r ON tk.room_id = r.id
        LEFT JOIN customers c ON tk.customer_id = c.id
        WHERE t.active = 1 AND t.shop_id = ?
        ORDER BY t.number
      `).all(start, shop_id)

      // 房间列表
      const rooms = db.prepare(`
        SELECT r.*,
          tk.id AS ticket_id, tk.status AS ticket_status,
          t.name AS tech_name, t.number AS tech_number,
          s.name AS service_name,
          c.name AS customer_name
        FROM rooms r
        LEFT JOIN tickets tk ON tk.room_id = r.id
          AND tk.status IN ('active', 'pending')
          AND tk.created_at >= ?
        LEFT JOIN technicians t ON tk.technician_id = t.id
        LEFT JOIN services s ON tk.service_id = s.id
        LEFT JOIN customers c ON tk.customer_id = c.id
        WHERE r.active = 1 AND r.shop_id = ?
        ORDER BY r.sort_order
      `).all(start, shop_id)

      // 今日统计（钟单 + 点单收入）— 空表时 SUM 返回 NULL，统一归 0 避免前端 KPI 空白
      const stats = db.prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END), 0) AS active,
          COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END), 0) AS paid,
          COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue
        FROM tickets WHERE created_at >= ? AND shop_id = ?
      `).get(start, shop_id)
      const productStats = db.prepare(`
        SELECT COUNT(*) AS product_orders,
          COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN total_cents ELSE 0 END), 0) AS product_revenue,
          SUM(CASE WHEN paid_at IS NULL AND status != 'canceled' THEN 1 ELSE 0 END) AS product_unpaid
        FROM product_orders WHERE created_at >= ? AND shop_id = ?
      `).get(start, shop_id)
      stats.product_orders = productStats.product_orders
      stats.product_revenue = productStats.product_revenue
      stats.product_unpaid = Number(productStats.product_unpaid || 0)
      stats.total_revenue = Number(stats.revenue) + productStats.product_revenue

      return { data: { techs, rooms, stats }, total: techsTotal.total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
