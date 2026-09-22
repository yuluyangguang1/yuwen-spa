// 客服实时看板 API
//
// GET /api/dashboard/live — 一次返回技师状态 + 房间状态 + 当前钟单
// 供客服/前台实时查看全场情况

import { ValidationError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

export async function registerDashboardRoutes(fastify) {
  const db = fastify.db

  fastify.get('/api/dashboard/live', async (req, reply) => {
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

      // 今日统计
      const stats = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
          COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue
        FROM tickets WHERE created_at >= ? AND shop_id = ?
      `).get(start, shop_id)

      return { data: { techs, rooms, stats }, total: techsTotal.total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
