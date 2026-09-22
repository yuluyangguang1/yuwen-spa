// 经营报表 API
//
// GET /api/reports/daily   — 日营收报表（分页）
// GET /api/reports/tech     — 技师绩效报表（分页）
// GET /api/reports/service  — 项目维度报表（分页）
// GET /api/reports/payment  — 支付方式报表（分页）
// GET /api/reports/summary  — 经营摘要（单对象）
// GET /api/reports/export   — 导出 CSV / Excel
//     ?type=daily|tech|service|payment&format=csv|xlsx

import { BusinessError, ValidationError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'

export async function registerReportRoutes(fastify) {
  const db = fastify.db

  // ── 日营收 ────────────────────────────────
  fastify.get('/api/reports/daily', async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { date, days = 30 } = req.query
      const shop_id = req.user?.shop_id
      const args = shop_id ? [shop_id] : []

      const dateSql = date
        ? "AND DATE(created_at / 1000, 'unixepoch', 'localtime') = DATE(? / 1000, 'unixepoch', 'localtime')"
        : "AND created_at >= ?"
      const dateArgs = date ? [...args, Number(date)] : [...args, Date.now() - Number(days) * 86400000]

      const sql = `
        SELECT DATE(created_at / 1000, 'unixepoch', 'localtime') AS report_date,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_tickets,
          COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue,
          COALESCE(AVG(CASE WHEN status='paid' THEN price_cents END), 0) AS avg_revenue,
          SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_count
        FROM tickets WHERE 1=1
          ${shop_id ? 'AND shop_id=?' : ''}
          ${dateSql}
        GROUP BY report_date
        ORDER BY report_date DESC
        LIMIT ? OFFSET ?
      `

      const totalSql = `
        SELECT COUNT(*) AS total FROM (
          SELECT 1 FROM tickets WHERE 1=1
            ${shop_id ? 'AND shop_id=?' : ''}
            ${dateSql}
          GROUP BY DATE(created_at / 1000, 'unixepoch', 'localtime')
        ) AS t
      `
      const countArgs = shop_id
        ? [...args, ...(date ? [Number(date)] : [Date.now() - Number(days) * 86400000])]
        : [...args, ...(date ? [Number(date)] : [Date.now() - Number(days) * 86400000])]

      const totalResult = db.prepare(totalSql).get(...countArgs)
      const total = Number(totalResult?.total ?? 0)

      const allArgs = [...dateArgs, pageSize, (page - 1) * pageSize]
      const data = db.prepare(sql).all(...allArgs)

      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 技师绩效 ──────────────────────────────
  fastify.get('/api/reports/tech', async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { technician_id, date_from, date_to } = req.query
      const shop_id = req.user?.shop_id

      const dateConditions = []
      if (date_from) dateConditions.push('AND tk.created_at >= ?')
      if (date_to) dateConditions.push('AND tk.created_at <= ?')
      const whereDate = dateConditions.join(' ')

      const whereShop = shop_id ? 'AND t.shop_id=?' : ''
      const shopArgs = shop_id ? [shop_id] : []
      const whereTech = technician_id ? 'AND t.id=?' : ''
      const techArgs = technician_id ? [technician_id] : []
      const dateArgs = [date_from ? Number(date_from) : null, date_to ? Number(date_to) : null].filter(Boolean)

      const sql = `
        SELECT t.id AS technician_id, t.name, t.number,
          COUNT(tk.id) AS ticket_count,
          COALESCE(SUM(tk.price_cents), 0) AS total_revenue,
          COALESCE(AVG(tk.price_cents), 0) AS avg_ticket,
          COALESCE(SUM(tk.commission_cents), 0) AS total_commission,
          COUNT(CASE WHEN tk.status='paid' THEN 1 END) AS paid_count
        FROM technicians t
        LEFT JOIN tickets tk ON tk.technician_id = t.id AND tk.status='paid'
          ${whereDate}
        WHERE t.active = 1 ${whereShop} ${whereTech}
        GROUP BY t.id
        ORDER BY total_revenue DESC
        LIMIT ? OFFSET ?
      `

      const totalSql = `
        SELECT COUNT(*) AS total FROM (
          SELECT t.id FROM technicians t
          LEFT JOIN tickets tk ON tk.technician_id = t.id AND tk.status='paid'
            ${whereDate}
          WHERE t.active = 1 ${whereShop} ${whereTech}
          GROUP BY t.id
        ) AS t
      `

      const countArgs = [...shopArgs, ...techArgs, ...dateArgs]
      const totalResult = db.prepare(totalSql).get(...countArgs)
      const total = Number(totalResult?.total ?? 0)

      const dataArgs = [...shopArgs, ...techArgs, ...dateArgs, pageSize, (page - 1) * pageSize]
      const data = db.prepare(sql).all(...dataArgs)

      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 经营摘要（单对象，不分页）───────────
  fastify.get('/api/reports/summary', async (req, reply) => {
    try {
      const { shop_id } = req.query
      const effShopId = req.user?.shop_id || shop_id
      const now = Date.now()
      const todayStart = new Date(now)
      todayStart.setHours(0, 0, 0, 0)
      const monthStart = new Date(now)
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)

      const whereShop = effShopId ? 'AND shop_id=?' : ''
      const shopArgs = effShopId ? [effShopId] : []

      const today = db.prepare(`
        SELECT COUNT(*) AS tickets,
          COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue
        FROM tickets WHERE created_at >= ? ${whereShop}
      `).get(todayStart.getTime(), ...shopArgs)

      const month = db.prepare(`
        SELECT COUNT(*) AS tickets,
          COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue,
          COUNT(CASE WHEN status='active' THEN 1 END) AS active_now
        FROM tickets WHERE created_at >= ? ${whereShop}
      `).get(monthStart.getTime(), ...shopArgs)

      const techCount = db.prepare(
        `SELECT COUNT(*) AS count FROM technicians WHERE active=1 ${whereShop}`
      ).get(...shopArgs)

      const roomCount = db.prepare(
        `SELECT COUNT(*) AS count FROM rooms WHERE active=1 ${whereShop}`
      ).get(...shopArgs)

      return { today, month, counts: { technicians: techCount.count, rooms: roomCount.count } }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 项目维度 ────────────────────────────
  fastify.get('/api/reports/service', async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { date_from, date_to } = req.query
      const shop_id = req.user?.shop_id

      const dateConditions = []
      if (date_from) dateConditions.push('AND tk.created_at >= ?')
      if (date_to) dateConditions.push('AND tk.created_at <= ?')
      const whereDate = dateConditions.join(' ')
      const whereShop = shop_id ? 'AND t.shop_id=?' : ''
      const shopArgs = shop_id ? [shop_id] : []
      const dateArgs = [date_from ? Number(date_from) : null, date_to ? Number(date_to) : null].filter(Boolean)

      const sql = `
        SELECT t.id AS service_id, t.name, t.category, t.duration,
          COUNT(tk.id) AS ticket_count,
          COUNT(CASE WHEN tk.status='paid' THEN 1 END) AS paid_count,
          COALESCE(SUM(CASE WHEN tk.status='paid' THEN tk.price_cents ELSE 0 END), 0) AS total_revenue,
          COALESCE(AVG(CASE WHEN tk.status='paid' THEN tk.price_cents END), 0) AS avg_ticket
        FROM services t
        LEFT JOIN tickets tk ON tk.service_id = t.id
          ${whereDate}
        WHERE t.active = 1 ${whereShop}
        GROUP BY t.id
        ORDER BY total_revenue DESC, ticket_count DESC
        LIMIT ? OFFSET ?
      `
      const totalSql = `
        SELECT COUNT(*) AS total FROM (
          SELECT t.id FROM services t
          LEFT JOIN tickets tk ON tk.service_id = t.id ${whereDate}
          WHERE t.active = 1 ${whereShop}
          GROUP BY t.id
        ) AS x
      `
      const countArgs = [...shopArgs, ...dateArgs]
      const totalResult = db.prepare(totalSql).get(...countArgs)
      const total = Number(totalResult?.total ?? 0)
      const data = db.prepare(sql).all(...shopArgs, ...dateArgs, pageSize, (page - 1) * pageSize)
      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 支付方式 ────────────────────────────
  fastify.get('/api/reports/payment', async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { date_from, date_to } = req.query
      const shop_id = req.user?.shop_id

      const conds = [`status='paid'`]
      const args = []
      if (shop_id) { conds.push('shop_id=?'); args.push(shop_id) }
      if (date_from) { conds.push('created_at >= ?'); args.push(Number(date_from)) }
      if (date_to) { conds.push('created_at <= ?'); args.push(Number(date_to)) }
      const where = conds.join(' AND ')

      const sql = `
        SELECT COALESCE(payment_method, 'unknown') AS payment_method,
          COUNT(*) AS paid_count,
          COALESCE(SUM(price_cents), 0) AS total_revenue,
          COALESCE(SUM(commission_cents), 0) AS total_commission
        FROM tickets
        WHERE ${where}
        GROUP BY COALESCE(payment_method, 'unknown')
        ORDER BY total_revenue DESC
        LIMIT ? OFFSET ?
      `
      const totalSql = `
        SELECT COUNT(*) AS total FROM (
          SELECT 1 FROM tickets WHERE ${where}
          GROUP BY COALESCE(payment_method, 'unknown')
        ) AS x
      `
      const totalResult = db.prepare(totalSql).get(...args)
      const total = Number(totalResult?.total ?? 0)
      const data = db.prepare(sql).all(...args, pageSize, (page - 1) * pageSize)
      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })

  // ── 导出 CSV / Excel（保持原样 + 新增 Excel）───
  fastify.get('/api/reports/export', async (req, reply) => {
    try {
      const { type = 'daily', format = 'csv', date_from } = req.query
      const rows = []
      const columns = []
      let filename = 'report'

      if (type === 'daily') {
        const shopId = req.user?.shop_id
        const data = db.prepare(`
          SELECT DATE(created_at / 1000, 'unixepoch', 'localtime') AS date,
            COUNT(*) AS tickets,
            SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END) AS revenue
          FROM tickets WHERE shop_id=? AND created_at >= ?
          GROUP BY date ORDER BY date DESC
        `).all(shopId, Number(date_from) || Date.now() - 30 * 86400000)
        rows.push(...data)
        columns.push(...['date', 'tickets', 'revenue'])
        filename = 'daily-report'
      } else if (type === 'tech') {
        const shopId = req.user?.shop_id
        const data = db.prepare(`
          SELECT t.name, COUNT(tk.id) AS tickets,
            SUM(tk.price_cents) AS revenue, SUM(tk.commission_cents) AS commission
          FROM technicians t LEFT JOIN tickets tk ON tk.technician_id=t.id AND tk.status='paid'
          WHERE t.active=1 AND t.shop_id=? GROUP BY t.id ORDER BY revenue DESC
        `).all(shopId)
        rows.push(...data)
        columns.push(...['name', 'tickets', 'revenue', 'commission'])
        filename = 'tech-report'
      } else if (type === 'service') {
        const shopId = req.user?.shop_id
        const data = db.prepare(`
          SELECT s.name, s.category, COUNT(tk.id) AS tickets,
            COALESCE(SUM(CASE WHEN tk.status='paid' THEN tk.price_cents ELSE 0 END), 0) AS revenue
          FROM services s
          LEFT JOIN tickets tk ON tk.service_id=s.id
            ${date_from ? 'AND tk.created_at >= ?' : ''}
          WHERE s.active=1 AND s.shop_id=? GROUP BY s.id ORDER BY revenue DESC
        `).all(...(date_from ? [Number(date_from), shopId] : [shopId]))
        rows.push(...data)
        columns.push(...['name', 'category', 'tickets', 'revenue'])
        filename = 'service-report'
      } else if (type === 'payment') {
        const shopId = req.user?.shop_id
        const data = db.prepare(`
          SELECT COALESCE(payment_method, 'unknown') AS payment_method,
            COUNT(*) AS paid_count, COALESCE(SUM(price_cents), 0) AS revenue
          FROM tickets
          WHERE shop_id=? AND status='paid'
            ${date_from ? 'AND created_at >= ?' : ''}
          GROUP BY COALESCE(payment_method, 'unknown') ORDER BY revenue DESC
        `).all(...(date_from ? [shopId, Number(date_from)] : [shopId]))
        rows.push(...data)
        columns.push(...['payment_method', 'paid_count', 'revenue'])
        filename = 'payment-report'
      }

      if (format === 'excel') {
        const exceljs = await import('exceljs')
        const { Workbook } = exceljs.default || exceljs
        const workbook = new Workbook()
        const worksheet = workbook.addWorksheet(filename)

        worksheet.columns = columns.map((c) => ({ header: c, key: c }))
        for (const row of rows) {
          worksheet.addRow(row)
        }

        // 设置列宽自适应
        columns.forEach((col) => {
          const maxLen = Math.max(
            col.length,
            ...rows.map((r) => String(r[col] ?? '').length)
          )
          worksheet.getColumn(col).width = Math.min(maxLen + 2, 40)
        })

        const buf = await workbook.xlsx.writeBuffer()
        return reply
          .code(200)
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
          .header('Content-Length', buf.length)
          .send(Buffer.from(buf))
      }

      // 默认 CSV（RFC4180 转义 + 抑制公式注入）
      const escapeCell = (v) => {
        let s = String(v ?? '')
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
        if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
        return s
      }
      const header = columns.map(escapeCell).join(',')
      const lines = [header]
      for (const row of rows) {
        const vals = columns.map((c) => escapeCell(row[c]))
        lines.push(vals.join(','))
      }
      const csv = lines.join('\n') + '\n'
      const buf = Buffer.from(csv, 'utf-8')

      return reply
        .code(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
        .header('Content-Length', buf.length)
        .send(buf)
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: e.message })
    }
  })
}
