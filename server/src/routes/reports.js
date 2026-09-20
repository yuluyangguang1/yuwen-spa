// 经营报表 API
//
// GET /api/reports/daily   — 日营收报表
// GET /api/reports/monthly  — 月营收报表
// GET /api/reports/tech     — 技师绩效报表
// GET /api/reports/export   — 导出 CSV
// GET /api/reports/summary  — 经营摘要

export async function registerReportRoutes(fastify) {
  const db = fastify.db

  // ── 日营收 ────────────────────────────────────────
  fastify.get('/api/reports/daily', async (req) => {
    const { shop_id, date, days = 30 } = req.query
    const args = []
    if (shop_id) args.push(shop_id)

    const sql = `
      SELECT
        DATE(created_at / 1000, 'unixepoch') AS report_date,
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_tickets,
        COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue,
        COALESCE(AVG(CASE WHEN status='paid' THEN price_cents END), 0) AS avg_revenue,
        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_count
      FROM tickets
      WHERE 1=1
        ${shop_id ? 'AND shop_id=?' : ''}
        ${date ? 'AND DATE(created_at / 1000, ?) = report_date' : `AND created_at >= ?`}
      GROUP BY report_date
      ORDER BY report_date DESC
      LIMIT ?
    `
    const limitArgs = shop_id ? [...args, Number(days)] : [...args, Date.now() - Number(days) * 86400000, Number(days)]
    return db.prepare(sql).all(...limitArgs)
  })

  // ── 技师绩效 ──────────────────────────────────────
  fastify.get('/api/reports/tech', async (req) => {
    const { shop_id, technician_id, date_from, date_to, limit = 20 } = req.query
    const args = []
    if (shop_id) args.push(shop_id)
    if (technician_id) args.push(technician_id)
    if (date_from) args.push(Number(date_from))
    if (date_to) args.push(Number(date_to))

    const sql = `
      SELECT
        t.id AS technician_id, t.name, t.number,
        COUNT(tk.id) AS ticket_count,
        COALESCE(SUM(tk.price_cents), 0) AS total_revenue,
        COALESCE(AVG(tk.price_cents), 0) AS avg_ticket,
        COALESCE(SUM(tk.commission), 0) AS total_commission,
        COUNT(CASE WHEN tk.status='paid' THEN 1 END) AS paid_count
      FROM technicians t
      LEFT JOIN tickets tk ON tk.technician_id = t.id
        AND tk.status='paid'
        ${date_from ? 'AND tk.created_at >= ?' : ''}
        ${date_to ? 'AND tk.created_at <= ?' : ''}
      WHERE t.active = 1
        ${shop_id ? 'AND t.shop_id=?' : ''}
      GROUP BY t.id
      ORDER BY total_revenue DESC
      LIMIT ?
    `
    const limitArgs = shop_id ? [...args, Number(limit)] : [...args, Number(limit)]
    return db.prepare(sql).all(...limitArgs)
  })

  // ── 经营摘要 ──────────────────────────────────────
  fastify.get('/api/reports/summary', async (req) => {
    const { shop_id } = req.query
    const now = Date.now()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const monthStart = new Date(now)
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const args = []
    const whereShop = shop_id ? 'AND shop_id=?' : ''
    if (shop_id) args.push(shop_id)

    // 今日
    const today = db.prepare(`
      SELECT
        COUNT(*) AS tickets,
        COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue
      FROM tickets WHERE created_at >= ? ${whereShop}
    `).get(todayStart.getTime(), ...(shop_id ? [shop_id] : []))

    // 本月
    const month = db.prepare(`
      SELECT
        COUNT(*) AS tickets,
        COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue,
        COUNT(CASE WHEN status='active' THEN 1 END) AS active_now
      FROM tickets WHERE created_at >= ? ${whereShop}
    `).get(monthStart.getTime(), ...(shop_id ? [shop_id] : []))

    // 技师数
    const techCount = db.prepare(
      `SELECT COUNT(*) AS count FROM technicians WHERE active=1 ${whereShop}`
    ).get(...(shop_id ? [shop_id] : []))

    // 房间数
    const roomCount = db.prepare(
      `SELECT COUNT(*) AS count FROM rooms WHERE active=1 ${whereShop}`
    ).get(...(shop_id ? [shop_id] : []))

    return { today, month, counts: { technicians: techCount.count, rooms: roomCount.count } }
  })

  // ── 导出 CSV ──────────────────────────────────────
  fastify.get('/api/reports/export', async (req) => {
    const { type = 'daily', shop_id, date_from, date_to } = req.query
    const fastify = req.server
    const { serialize } = await import('csv-stringify/sync')

    let rows = []
    let columns = []
    let filename = 'report'

    if (type === 'daily') {
      const data = db.prepare(`
        SELECT DATE(created_at / 1000, 'unixepoch') AS date,
          COUNT(*) AS tickets,
          SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END) AS revenue
        FROM tickets WHERE created_at >= ?
        GROUP BY date ORDER BY date DESC
      `).all(Number(date_from) || Date.now() - 30 * 86400000)
      rows = data
      columns = ['date', 'tickets', 'revenue']
      filename = 'daily-report'
    } else if (type === 'tech') {
      const data = db.prepare(`
        SELECT t.name, COUNT(tk.id) AS tickets,
          SUM(tk.price_cents) AS revenue, SUM(tk.commission) AS commission
        FROM technicians t LEFT JOIN tickets tk ON tk.technician_id=t.id AND tk.status='paid'
        WHERE t.active=1 GROUP BY t.id ORDER BY revenue DESC
      `).all()
      rows = data
      columns = ['name', 'tickets', 'revenue', 'commission']
      filename = 'tech-report'
    }

    const csv = serialize(rows, { columns, header: true })
    const buf = Buffer.from(csv)

    fastify.reply
      .code(200)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
      .header('Content-Length', buf.length)
      .send(buf)
  })
}
