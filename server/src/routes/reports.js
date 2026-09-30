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
import { requireRole, STAFF_ROLES } from '../auth/roles.js'

export async function registerReportRoutes(fastify) {
  const db = fastify.db
  // 报表含营收/提成：admin/pos/cs 可见，tech 不可见（本插件内所有路由）
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }

  // 解析日期区间参数：缺省返回 null；非法（NaN/非数字）抛 422，避免 NaN 绑定进 SQL
  const parseDateArg = (v, field) => {
    if (v == null || v === '') return null
    const n = Number(v)
    if (!Number.isFinite(n)) throw new ValidationError(`${field} 必须是毫秒时间戳`)
    return n
  }

  // ── 日营收 ────────────────────────────────
  // 支持三种时间窗：date（单日 ms 时间戳）、days（相对今天 N 天）、date_from/date_to（显式区间 ms）
  fastify.get('/api/reports/daily', staffOnly, async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { date, days = 30, date_from, date_to } = req.query
      const shop_id = req.user?.shop_id
      const args = shop_id ? [shop_id] : []
      const dateMs = parseDateArg(date, 'date')
      const fromMs = parseDateArg(date_from, 'date_from')
      const toMs = parseDateArg(date_to, 'date_to')
      const daysN = parseDateArg(days, 'days')

      const useRange = fromMs != null || toMs != null
      let dateSql
      let rangeArgs
      if (dateMs != null) {
        dateSql = "AND DATE(created_at / 1000, 'unixepoch', 'localtime') = DATE(? / 1000, 'unixepoch', 'localtime')"
        rangeArgs = [dateMs]
      } else if (useRange) {
        const parts = []
        const vals = []
        if (fromMs != null) { parts.push('AND created_at >= ?'); vals.push(fromMs) }
        if (toMs != null) { parts.push('AND created_at <= ?'); vals.push(toMs) }
        dateSql = parts.join(' ')
        rangeArgs = vals
      } else {
        dateSql = 'AND created_at >= ?'
        rangeArgs = [Date.now() - daysN * 86400000]
      }
      const dateArgs = [...args, ...rangeArgs]
      const countArgs = [...args, ...rangeArgs]

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

      const totalResult = db.prepare(totalSql).get(...countArgs)
      const total = Number(totalResult?.total ?? 0)

      const allArgs = [...dateArgs, pageSize, (page - 1) * pageSize]
      const data = db.prepare(sql).all(...allArgs)

      // 并入点单收入（按日聚合后 merge；时间窗与 tickets 一致）
      let prodRows
      if (dateMs != null) {
        prodRows = db.prepare(`
          SELECT DATE(paid_at / 1000, 'unixepoch', 'localtime') AS report_date,
            COUNT(*) AS product_orders,
            COALESCE(SUM(total_cents), 0) AS product_revenue
          FROM product_orders
          WHERE paid_at IS NOT NULL
            ${shop_id ? 'AND shop_id=?' : ''}
            AND DATE(paid_at / 1000, 'unixepoch', 'localtime') = DATE(? / 1000, 'unixepoch', 'localtime')
          GROUP BY report_date
        `).all(...(shop_id ? [shop_id, dateMs] : [dateMs]))
      } else if (useRange) {
        const parts = ['WHERE paid_at IS NOT NULL']
        const vals = []
        if (shop_id) { parts.push('AND shop_id=?'); vals.push(shop_id) }
        if (fromMs != null) { parts.push('AND paid_at >= ?'); vals.push(fromMs) }
        if (toMs != null) { parts.push('AND paid_at <= ?'); vals.push(toMs) }
        prodRows = db.prepare(`
          SELECT DATE(paid_at / 1000, 'unixepoch', 'localtime') AS report_date,
            COUNT(*) AS product_orders,
            COALESCE(SUM(total_cents), 0) AS product_revenue
          FROM product_orders
          ${parts.join(' ')}
          GROUP BY report_date
        `).all(...vals)
      } else {
        const since = Date.now() - daysN * 86400000
        prodRows = db.prepare(`
          SELECT DATE(paid_at / 1000, 'unixepoch', 'localtime') AS report_date,
            COUNT(*) AS product_orders,
            COALESCE(SUM(total_cents), 0) AS product_revenue
          FROM product_orders
          WHERE paid_at IS NOT NULL
            ${shop_id ? 'AND shop_id=?' : ''}
            AND paid_at >= ?
          GROUP BY report_date
        `).all(...(shop_id ? [shop_id, since] : [since]))
      }
      const prodByDate = new Map(prodRows.map(r => [r.report_date, r]))
      for (const row of data) {
        const p = prodByDate.get(row.report_date)
        row.product_orders = p ? p.product_orders : 0
        row.product_revenue = p ? p.product_revenue : 0
        row.total_revenue = Number(row.revenue) + row.product_revenue
      }

      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 技师绩效 ──────────────────────────────
  fastify.get('/api/reports/tech', staffOnly, async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { technician_id, date_from, date_to } = req.query
      const shop_id = req.user?.shop_id
      const fromMs = parseDateArg(date_from, 'date_from')
      const toMs = parseDateArg(date_to, 'date_to')

      const dateConditions = []
      if (fromMs != null) dateConditions.push('AND tk.created_at >= ?')
      if (toMs != null) dateConditions.push('AND tk.created_at <= ?')
      const whereDate = dateConditions.join(' ')

      const whereShop = shop_id ? 'AND t.shop_id=?' : ''
      const shopArgs = shop_id ? [shop_id] : []
      const whereTech = technician_id ? 'AND t.id=?' : ''
      const techArgs = technician_id ? [technician_id] : []
      // 占位符顺序 = JOIN 内日期 → WHERE 店铺 → 技师
      const dateArgs = [fromMs, toMs].filter((v) => v != null)

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

      const countArgs = [...dateArgs, ...shopArgs, ...techArgs]
      const totalResult = db.prepare(totalSql).get(...countArgs)
      const total = Number(totalResult?.total ?? 0)

      const dataArgs = [...dateArgs, ...shopArgs, ...techArgs, pageSize, (page - 1) * pageSize]
      const data = db.prepare(sql).all(...dataArgs)

      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 经营摘要（单对象，不分页）───────────
  fastify.get('/api/reports/summary', staffOnly, async (req, reply) => {
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

      // 点单收入并入摘要
      const productToday = db.prepare(`
        SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue
        FROM product_orders WHERE paid_at >= ? ${whereShop}
      `).get(todayStart.getTime(), ...shopArgs)
      const productMonth = db.prepare(`
        SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue
        FROM product_orders WHERE paid_at >= ? ${whereShop}
      `).get(monthStart.getTime(), ...shopArgs)
      today.product_orders = productToday.orders
      today.product_revenue = productToday.revenue
      today.total_revenue = Number(today.revenue) + productToday.revenue
      month.product_orders = productMonth.orders
      month.product_revenue = productMonth.revenue
      month.total_revenue = Number(month.revenue) + productMonth.revenue

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
      throw e
    }
  })

  // ── 项目维度 ────────────────────────────
  fastify.get('/api/reports/service', staffOnly, async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { date_from, date_to } = req.query
      const shop_id = req.user?.shop_id
      const fromMs = parseDateArg(date_from, 'date_from')
      const toMs = parseDateArg(date_to, 'date_to')

      const dateConditions = []
      if (fromMs != null) dateConditions.push('AND tk.created_at >= ?')
      if (toMs != null) dateConditions.push('AND tk.created_at <= ?')
      const whereDate = dateConditions.join(' ')
      const whereShop = shop_id ? 'AND t.shop_id=?' : ''
      const shopArgs = shop_id ? [shop_id] : []
      // 占位符顺序 = JOIN 内日期 → WHERE 店铺
      const dateArgs = [fromMs, toMs].filter((v) => v != null)

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
      const countArgs = [...dateArgs, ...shopArgs]
      const totalResult = db.prepare(totalSql).get(...countArgs)
      const total = Number(totalResult?.total ?? 0)
      const data = db.prepare(sql).all(...dateArgs, ...shopArgs, pageSize, (page - 1) * pageSize)
      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 支付方式 ────────────────────────────
  fastify.get('/api/reports/payment', staffOnly, async (req, reply) => {
    try {
      const { page, pageSize } = parsePagination(req)
      const { date_from, date_to } = req.query
      const shop_id = req.user?.shop_id

      const conds = [`status='paid'`]
      const args = []
      if (shop_id) { conds.push('shop_id=?'); args.push(shop_id) }
      if (date_from) { conds.push('created_at >= ?'); args.push(parseDateArg(date_from, 'date_from')) }
      if (date_to) { conds.push('created_at <= ?'); args.push(parseDateArg(date_to, 'date_to')) }
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

      // 点单收款并入支付方式报表（JS 侧 merge，支付方式种类少）
      const prodConds = [`paid_at IS NOT NULL`]
      const prodArgs = []
      if (shop_id) { prodConds.push('shop_id=?'); prodArgs.push(shop_id) }
      if (date_from) { prodConds.push('paid_at >= ?'); prodArgs.push(parseDateArg(date_from, 'date_from')) }
      if (date_to) { prodConds.push('paid_at <= ?'); prodArgs.push(parseDateArg(date_to, 'date_to')) }
      const prodRows = db.prepare(`
        SELECT COALESCE(payment_method, 'unknown') AS payment_method,
          COUNT(*) AS paid_count,
          COALESCE(SUM(total_cents), 0) AS total_revenue
        FROM product_orders
        WHERE ${prodConds.join(' AND ')}
        GROUP BY COALESCE(payment_method, 'unknown')
      `).all(...prodArgs)
      const byMethod = new Map(data.map(r => [r.payment_method, r]))
      for (const p of prodRows) {
        const existing = byMethod.get(p.payment_method)
        if (existing) {
          existing.paid_count += p.paid_count
          existing.total_revenue += p.total_revenue
        } else {
          data.push({ payment_method: p.payment_method, paid_count: p.paid_count, total_revenue: p.total_revenue, total_commission: 0 })
        }
      }
      data.sort((a, b) => b.total_revenue - a.total_revenue)

      return { data, total, page, pageSize }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 充值提成（按提成人汇总，含充值额）────────
  fastify.get('/api/reports/topup-commission', staffOnly, async (req, reply) => {
    try {
      const { date_from, date_to } = req.query
      const shop_id = req.user?.shop_id
      if (!shop_id) throw new ValidationError('无权限访问')

      // 含 topup_refund 负向流水：提成/充值额直接汇总即净额（退卡反冲）
      const conds = [`w.shop_id=?`, `w.type IN ('topup','topup_refund')`]
      const args = [shop_id]
      if (date_from) { conds.push('w.created_at >= ?'); args.push(parseDateArg(date_from, 'date_from')) }
      if (date_to) { conds.push('w.created_at <= ?'); args.push(parseDateArg(date_to, 'date_to')) }

      const rows = db.prepare(`
        SELECT w.commission_user_id AS user_id,
          u.display_name, u.username,
          COUNT(CASE WHEN w.type='topup' THEN 1 END) AS topup_count,
          COALESCE(SUM(w.amount_cents), 0) AS topup_amount_cents,
          COALESCE(SUM(w.commission_cents), 0) AS commission_cents
        FROM wallet_transactions w
        LEFT JOIN users u ON w.commission_user_id = u.id
        WHERE ${conds.join(' AND ')}
        GROUP BY w.commission_user_id
        ORDER BY commission_cents DESC, topup_amount_cents DESC
      `).all(...args)

      const summary = rows.reduce((s, r) => ({
        topup_count: s.topup_count + r.topup_count,
        topup_amount_cents: s.topup_amount_cents + r.topup_amount_cents,
        commission_cents: s.commission_cents + r.commission_cents,
      }), { topup_count: 0, topup_amount_cents: 0, commission_cents: 0 })

      return { data: rows, total: rows.length, page: 1, pageSize: rows.length, summary }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 导出 CSV / Excel（保持原样 + 新增 Excel）───
  fastify.get('/api/reports/export', staffOnly, async (req, reply) => {
    try {
      const { type = 'daily', format = 'csv', date_from, date_to } = req.query
      const exFrom = parseDateArg(date_from, 'date_from')
      const exTo = parseDateArg(date_to, 'date_to')
      const rows = []
      const columns = []
      let filename = 'report'

      if (type === 'daily') {
        const shopId = req.user?.shop_id
        const from = exFrom || Date.now() - 30 * 86400000
        const ticketData = db.prepare(`
          SELECT DATE(created_at / 1000, 'unixepoch', 'localtime') AS date,
            COUNT(*) AS tickets,
            SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END) AS revenue
          FROM tickets WHERE shop_id=? AND created_at >= ? ${exTo != null ? 'AND created_at <= ?' : ''}
          GROUP BY date ORDER BY date DESC
        `).all(...(exTo != null ? [shopId, from, exTo] : [shopId, from]))
        const prodData = db.prepare(`
          SELECT DATE(paid_at / 1000, 'unixepoch', 'localtime') AS date,
            COUNT(*) AS product_orders,
            COALESCE(SUM(total_cents), 0) AS product_revenue
          FROM product_orders WHERE shop_id=? AND paid_at IS NOT NULL AND paid_at >= ? ${exTo != null ? 'AND paid_at <= ?' : ''}
          GROUP BY date
        `).all(...(exTo != null ? [shopId, from, exTo] : [shopId, from]))
        const prodByDate = new Map(prodData.map(r => [r.date, r]))
        for (const row of ticketData) {
          const p = prodByDate.get(row.date)
          row.product_orders = p ? p.product_orders : 0
          row.product_revenue = p ? p.product_revenue : 0
          row.total_revenue = Number(row.revenue) + row.product_revenue
        }
        // 有点单但无钟单的日期补行
        for (const p of prodData) {
          if (!ticketData.find(t => t.date === p.date)) {
            ticketData.push({ date: p.date, tickets: 0, revenue: 0, product_orders: p.product_orders, product_revenue: p.product_revenue, total_revenue: p.product_revenue })
          }
        }
        ticketData.sort((a, b) => String(b.date).localeCompare(String(a.date)))
        rows.push(...ticketData)
        columns.push(...['date', 'tickets', 'revenue', 'product_orders', 'product_revenue', 'total_revenue'])
        filename = 'daily-report'
      } else if (type === 'tech') {
        const shopId = req.user?.shop_id
        const dateConds = `${exFrom != null ? 'AND tk.created_at >= ?' : ''} ${exTo != null ? 'AND tk.created_at <= ?' : ''}`
        const dateVals = [exFrom, exTo].filter((v) => v != null)
        const data = db.prepare(`
          SELECT t.name, COUNT(tk.id) AS tickets,
            SUM(tk.price_cents) AS revenue, SUM(tk.commission_cents) AS commission
          FROM technicians t LEFT JOIN tickets tk ON tk.technician_id=t.id AND tk.status='paid'
            ${dateConds}
          WHERE t.active=1 AND t.shop_id=? GROUP BY t.id ORDER BY revenue DESC
        `).all(...dateVals, shopId)
        rows.push(...data)
        columns.push(...['name', 'tickets', 'revenue', 'commission'])
        filename = 'tech-report'
      } else if (type === 'service') {
        const shopId = req.user?.shop_id
        const dateConds = `${exFrom != null ? 'AND tk.created_at >= ?' : ''} ${exTo != null ? 'AND tk.created_at <= ?' : ''}`
        const dateVals = [exFrom, exTo].filter((v) => v != null)
        const data = db.prepare(`
          SELECT s.name, s.category, COUNT(tk.id) AS tickets,
            COALESCE(SUM(CASE WHEN tk.status='paid' THEN tk.price_cents ELSE 0 END), 0) AS revenue
          FROM services s
          LEFT JOIN tickets tk ON tk.service_id=s.id
            ${dateConds}
          WHERE s.active=1 AND s.shop_id=? GROUP BY s.id ORDER BY revenue DESC
        `).all(...dateVals, shopId)
        rows.push(...data)
        columns.push(...['name', 'category', 'tickets', 'revenue'])
        filename = 'service-report'
      } else if (type === 'payment') {
        const shopId = req.user?.shop_id
        const from = exFrom || 0
        const toConds = exTo != null ? 'AND created_at <= ?' : ''
        const ticketRows = db.prepare(`
          SELECT COALESCE(payment_method, 'unknown') AS payment_method,
            COUNT(*) AS paid_count, COALESCE(SUM(price_cents), 0) AS revenue
          FROM tickets
          WHERE shop_id=? AND status='paid'
            ${date_from ? 'AND created_at >= ?' : ''}
            ${toConds}
          GROUP BY COALESCE(payment_method, 'unknown')
        `).all(...(date_from ? (exTo != null ? [shopId, from, exTo] : [shopId, from]) : (exTo != null ? [shopId, exTo] : [shopId])))
        const prodRows = db.prepare(`
          SELECT COALESCE(payment_method, 'unknown') AS payment_method,
            COUNT(*) AS paid_count, COALESCE(SUM(total_cents), 0) AS revenue
          FROM product_orders
          WHERE shop_id=? AND paid_at IS NOT NULL
            ${date_from ? 'AND paid_at >= ?' : ''}
            ${exTo != null ? 'AND paid_at <= ?' : ''}
          GROUP BY COALESCE(payment_method, 'unknown')
        `).all(...(date_from ? (exTo != null ? [shopId, from, exTo] : [shopId, from]) : (exTo != null ? [shopId, exTo] : [shopId])))
        const map = new Map()
        for (const r of [...ticketRows, ...prodRows]) {
          const cur = map.get(r.payment_method) || { payment_method: r.payment_method, paid_count: 0, revenue: 0 }
          cur.paid_count += r.paid_count
          cur.revenue += r.revenue
          map.set(r.payment_method, cur)
        }
        rows.push(...[...map.values()].sort((a, b) => b.revenue - a.revenue))
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
      throw e
    }
  })
}
