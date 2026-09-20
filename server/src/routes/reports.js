// 经营报表 API
//
// GET /api/reports/daily   — 日营收报表
// GET /api/reports/tech     — 技师绩效报表
// GET /api/reports/summary  — 经营摘要
// GET /api/reports/export   — 导出 CSV

export async function registerReportRoutes(fastify) {
  const db = fastify.db

  // ── 日营收 ────────────────────────────────
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
      FROM tickets WHERE 1=1
        ${shop_id ? 'AND shop_id=?' : ''}
        ${date ? "AND DATE(created_at / 1000, ?) = report_date" : 'AND created_at >= ?'}
      GROUP BY report_date
      ORDER BY report_date DESC
      LIMIT ?
    `
    const limitArgs = shop_id
      ? [...args, Number(days)]
      : [...args, Date.now() - Number(days) * 86400000, Number(days)]
    return db.prepare(sql).all(...limitArgs)
  })

  // ── 技师绩效 ──────────────────────────────
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

  // ── 经营摘要 ──────────────────────────────
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

    const today = db.prepare(`
      SELECT COUNT(*) AS tickets,
        COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue
      FROM tickets WHERE created_at >= ? ${whereShop}
    `).get(todayStart.getTime(), ...(shop_id ? [shop_id] : []))

    const month = db.prepare(`
      SELECT COUNT(*) AS tickets,
        COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue,
        COUNT(CASE WHEN status='active' THEN 1 END) AS active_now
      FROM tickets WHERE created_at >= ? ${whereShop}
    `).get(monthStart.getTime(), ...(shop_id ? [shop_id] : []))

    const techCount = db.prepare(
      `SELECT COUNT(*) AS count FROM technicians WHERE active=1 ${whereShop}`
    ).get(...(shop_id ? [shop_id] : []))

    const roomCount = db.prepare(
      `SELECT COUNT(*) AS count FROM rooms WHERE active=1 ${whereShop}`
    ).get(...(shop_id ? [shop_id] : []))

    return { today, month, counts: { technicians: techCount.count, rooms: roomCount.count } }
  })

  // ── 导出 CSV ──────────────────────────────
  fastify.get('/api/reports/export', async (req) => {
    const { type = 'daily', date_from } = req.query

    const rows = []
    const columns = []
    let filename = 'report'

    if (type === 'daily') {
      const data = db.prepare(`
        SELECT DATE(created_at / 1000, 'unixepoch') AS date,
          COUNT(*) AS tickets,
          SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END) AS revenue
        FROM tickets WHERE created_at >= ?
        GROUP BY date ORDER BY date DESC
      `).all(Number(date_from) || Date.now() - 30 * 86400000)
      rows.push(...data)
      columns.push(...['date', 'tickets', 'revenue'])
      filename = 'daily-report'
    } else if (type === 'tech') {
      const data = db.prepare(`
        SELECT t.name, COUNT(tk.id) AS tickets,
          SUM(tk.price_cents) AS revenue, SUM(tk.commission) AS commission
        FROM technicians t LEFT JOIN tickets tk ON tk.technician_id=t.id AND tk.status='paid'
        WHERE t.active=1 GROUP BY t.id ORDER BY revenue DESC
      `).all()
      rows.push(...data)
      columns.push(...['name', 'tickets', 'revenue', 'commission'])
      filename = 'tech-report'
    }

    // 简单 CSV 生成（无外部依赖）
    const header = columns.join(',')
    const lines = [header]
    for (const row of rows) {
      const vals = columns.map((c) => String(row[c] ?? ''))
      lines.push(vals.join(','))
    }
    const csv = lines.join('\n') + '\n'
    const buf = Buffer.from(csv, 'utf-8')

    return fastify.reply
      .code(200)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
      .header('Content-Length', buf.length)
      .send(buf)
  })
}
