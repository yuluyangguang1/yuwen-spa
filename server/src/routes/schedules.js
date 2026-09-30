// 技师周排班（attendance plan）
//
// 与 shifts（收银交接班钱箱对账）无关，表名/路由刻意避开。
// GET    /api/schedules?date_from&date_to&technician_id   列表（staff）
// POST   /api/schedules/batch     批量 upsert {items:[{id?, technician_id, date, start_min, end_min, shift_name?, status?, notes?}]}（admin）
// DELETE /api/schedules/:id                                      （admin）
// POST   /api/schedules/copy-week {from_start, to_start}         （admin）复制一周
// GET    /api/schedules/mine?date=YYYY-MM-DD                     （tech）我的当日班次
//
// 时间模型：date 字符串 + 当日 start_min/end_min（如 600=10:00），对齐排钟日历 10:00-23:00。

import { nanoid } from 'nanoid'
import { ValidationError, PermissionError, NotFoundError, ConflictError } from '../lib/errors.js'
import { requireRole, STAFF_ROLES, ADMIN_ROLES } from '../auth/roles.js'
import { parsePagination } from '../lib/pagination.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function localDateStr(ts = Date.now()) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDate(s) {
  if (!DATE_RE.test(String(s || ''))) throw new ValidationError('date 必须是 YYYY-MM-DD')
  return String(s)
}

function parseMin(n, field) {
  const v = Number(n)
  if (!Number.isInteger(v) || v < 0 || v > 24 * 60) throw new ValidationError(`${field} 必须是 0-1440 整数`)
  return v
}

function assertNoOverlap(db, shopId, techId, date, startMin, endMin, exceptId = null) {
  const rows = db.prepare(`
    SELECT id, start_min, end_min FROM technician_schedules
    WHERE shop_id=? AND technician_id=? AND date=? AND id!=?
  `).all(shopId, techId, date, exceptId || '')
  for (const r of rows) {
    if (startMin < r.end_min && r.start_min < endMin) {
      throw new ConflictError(`该时段与已有班次重叠（${fmtMin(r.start_min)}-${fmtMin(r.end_min)}）`)
    }
  }
}

function fmtMin(m) {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function toItem(row) {
  return { ...row, start_min: row.start_min, end_min: row.end_min }
}

export async function registerScheduleRoutes(fastify) {
  const db = fastify.db
  const staffOnly = { preHandler: requireRole(...STAFF_ROLES) }
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) }

  // ── 周/日列表 ─────────────────────────────────
  fastify.get('/api/schedules', staffOnly, async (req) => {
    const shop_id = req.user.shop_id
    const { page, pageSize, offset } = parsePagination(req)
    const where = ['s.shop_id=?']
    const args = [shop_id]
    if (req.query.date_from) { where.push('s.date>=?'); args.push(parseDate(req.query.date_from)) }
    if (req.query.date_to) { where.push('s.date<=?'); args.push(parseDate(req.query.date_to)) }
    if (req.query.date) { where.push('s.date=?'); args.push(parseDate(req.query.date)) }
    if (req.query.technician_id) { where.push('s.technician_id=?'); args.push(String(req.query.technician_id)) }
    const whereSql = ` AND ${where.join(' AND ')}`

    const total = Number(db.prepare(
      `SELECT COUNT(*) AS total FROM technician_schedules s WHERE 1=1${whereSql}`
    ).get(...args)?.total ?? 0)
    const rows = db.prepare(`
      SELECT s.*, t.name AS technician_name, t.number AS technician_number
      FROM technician_schedules s
      LEFT JOIN technicians t ON s.technician_id=t.id
      WHERE 1=1${whereSql}
      ORDER BY s.date, s.start_min, t.number
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset)
    return { data: rows.map(toItem), total, page, pageSize }
  })

  // ── 技师看自己某日班次 ─────────────────────────
  fastify.get('/api/schedules/mine', async (req, reply) => {
    try {
      const techId = req.user?.technician_id
      if (!techId) throw new PermissionError('当前账号未关联技师')
      const date = req.query.date ? parseDate(req.query.date) : localDateStr()
      const rows = db.prepare(`
        SELECT * FROM technician_schedules
        WHERE shop_id=? AND technician_id=? AND date=?
        ORDER BY start_min
      `).all(req.user.shop_id, techId, date)
      return { data: rows.map(toItem), date }
    } catch (e) {
      if (e.code && e.statusCode) throw e
      throw e
    }
  })

  // ── 批量 upsert（admin）─────────────────────────
  fastify.post('/api/schedules/batch', adminOnly, async (req) => {
    const shop_id = req.user.shop_id
    const items = req.body?.items
    if (!Array.isArray(items) || !items.length) throw new ValidationError('items 必须是非空数组')
    if (items.length > 200) throw new ValidationError('单次最多 200 条')

    const results = []
    db.transaction(() => {
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') throw new ValidationError('item 非法')
        if (raw.deleted && raw.id) {
          const r = db.prepare(`DELETE FROM technician_schedules WHERE id=? AND shop_id=?`)
            .run(String(raw.id), shop_id)
          results.push({ id: raw.id, deleted: r.changes > 0 })
          continue
        }
        const technician_id = String(raw.technician_id || '')
        const date = parseDate(raw.date)
        const start_min = parseMin(raw.start_min, 'start_min')
        const end_min = parseMin(raw.end_min, 'end_min')
        if (end_min <= start_min) throw new ValidationError('end_min 必须大于 start_min')
        const shift_name = raw.shift_name != null ? String(raw.shift_name).slice(0, 40) : null
        const status = raw.status === 'off' ? 'off' : 'scheduled'
        const notes = raw.notes != null ? String(raw.notes).slice(0, 200) : null

        const tech = db.prepare(`SELECT id FROM technicians WHERE id=? AND shop_id=?`)
          .get(technician_id, shop_id)
        if (!tech) throw new NotFoundError(`technician ${technician_id} not found`)

        let id = raw.id ? String(raw.id) : null
        if (id) {
          const existing = db.prepare(`SELECT id FROM technician_schedules WHERE id=? AND shop_id=?`)
            .get(id, shop_id)
          if (!existing) throw new NotFoundError('schedule not found')
          assertNoOverlap(db, shop_id, technician_id, date, start_min, end_min, id)
          db.prepare(`
            UPDATE technician_schedules
            SET technician_id=?, date=?, start_min=?, end_min=?, shift_name=?, status=?, notes=?, updated_at=?
            WHERE id=? AND shop_id=?
          `).run(technician_id, date, start_min, end_min, shift_name, status, notes, Date.now(), id, shop_id)
        } else {
          // 同键冲突 → 覆盖更新（同 technician+date+start_min）
          const same = db.prepare(`
            SELECT id FROM technician_schedules
            WHERE shop_id=? AND technician_id=? AND date=? AND start_min=?
          `).get(shop_id, technician_id, date, start_min)
          if (same) {
            id = same.id
            assertNoOverlap(db, shop_id, technician_id, date, start_min, end_min, id)
            db.prepare(`
              UPDATE technician_schedules
              SET end_min=?, shift_name=?, status=?, notes=?, updated_at=?
              WHERE id=?
            `).run(end_min, shift_name, status, notes, Date.now(), id)
          } else {
            assertNoOverlap(db, shop_id, technician_id, date, start_min, end_min, null)
            id = nanoid(12)
            const now = Date.now()
            db.prepare(`
              INSERT INTO technician_schedules(id, shop_id, technician_id, date, start_min, end_min, shift_name, status, notes, created_at, updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)
            `).run(id, shop_id, technician_id, date, start_min, end_min, shift_name, status, notes, now, now)
          }
        }
        results.push({ id, technician_id, date, start_min, end_min })
      }
    })()

    return { ok: true, items: results }
  })

  // ── 删除单条（admin）───────────────────────────
  fastify.delete('/api/schedules/:id', adminOnly, async (req) => {
    const r = db.prepare(`DELETE FROM technician_schedules WHERE id=? AND shop_id=?`)
      .run(String(req.params.id), req.user.shop_id)
    if (r.changes === 0) throw new NotFoundError('not found')
    return { ok: true, id: req.params.id }
  })

  // ── 复制一周（admin）──────────────────────────
  // body: { from_start: 'YYYY-MM-DD', to_start?: 'YYYY-MM-DD' }  两周均为周一或任意起始日，按 7 天偏移复制
  fastify.post('/api/schedules/copy-week', adminOnly, async (req) => {
    const shop_id = req.user.shop_id
    const from_start = parseDate(req.body?.from_start)
    const to_start = parseDate(req.body?.to_start || (() => {
      // 默认复制到下一周同 day-of-week
      const d = new Date(`${from_start}T00:00:00`)
      d.setDate(d.getDate() + 7)
      return localDateStr(d.getTime())
    })())

    const fromDate = new Date(`${from_start}T00:00:00`)
    const toDate = new Date(`${to_start}T00:00:00`)
    const dayMs = 24 * 3600 * 1000

    const src = db.prepare(`
      SELECT * FROM technician_schedules
      WHERE shop_id=? AND date>=? AND date<=?
    `).all(
      shop_id,
      from_start,
      localDateStr(fromDate.getTime() + 6 * dayMs),
    )
    if (!src.length) throw new ConflictError('源周没有排班可复制')

    let created = 0, skipped = 0
    db.transaction(() => {
      for (const row of src) {
        const srcDay = new Date(`${row.date}T00:00:00`)
        const offsetDays = Math.round((srcDay.getTime() - fromDate.getTime()) / dayMs)
        const destDay = new Date(toDate.getTime() + offsetDays * dayMs)
        const date = localDateStr(destDay.getTime())

        const same = db.prepare(`
          SELECT id FROM technician_schedules
          WHERE shop_id=? AND technician_id=? AND date=? AND start_min=?
        `).get(shop_id, row.technician_id, date, row.start_min)
        if (same) { skipped++; continue }

        // 重叠检测
        try {
          assertNoOverlap(db, shop_id, row.technician_id, date, row.start_min, row.end_min, null)
        } catch (_) {
          skipped++
          continue
        }

        const now = Date.now()
        db.prepare(`
          INSERT INTO technician_schedules(id, shop_id, technician_id, date, start_min, end_min, shift_name, status, notes, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
        `).run(nanoid(12), shop_id, row.technician_id, date, row.start_min, row.end_min,
               row.shift_name, row.status, row.notes, now, now)
        created++
      }
    })()

    return { ok: true, created, skipped, from_start, to_start }
  })
}
