// 审计日志查看（财务关键操作留痕的只读端点）
//
// GET /api/audit-logs?action=&target_type=&page=&pageSize=

import { parsePagination } from '../lib/pagination.js'
import { PermissionError } from '../lib/errors.js'
import { requireRole, ADMIN_ROLES } from '../auth/roles.js'

export async function registerAuditRoutes(fastify) {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) }

  fastify.get('/api/audit-logs', adminOnly, async (req, reply) => {
    try {
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new PermissionError()
      const { page, pageSize, offset } = parsePagination(req)
      const { action, target_type } = req.query

      const where = ['shop_id = ?']
      const args = [shop_id]
      if (action) { where.push('action = ?'); args.push(String(action)) }
      if (target_type) { where.push('target_type = ?'); args.push(String(target_type)) }
      const whereSql = ` AND ${where.join(' AND ')}`

      const total = Number(fastify.db.prepare(
        `SELECT COUNT(*) AS total FROM audit_logs WHERE 1=1${whereSql}`
      ).get(...args)?.total ?? 0)

      const rows = fastify.db.prepare(`
        SELECT * FROM audit_logs
        WHERE 1=1${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...args, pageSize, offset)

      return { data: rows, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) throw e
      throw e
    }
  })
}
