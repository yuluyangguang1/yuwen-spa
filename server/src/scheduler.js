// 定时任务模块
//
// 周期性业务报表生成与快照。
// 通过 registerScheduler(fastify) 注册，启动 setInterval 定时任务，
// 并暴露 POST /api/scheduler/run 手动触发入口。

import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRateLimit } from './auth/ratelimit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SNAPSHOT_DIR = path.join(ROOT, 'db', 'reports', 'snapshots')

// 本地时区日期 YYYY-MM-DD
function localDateStr(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── 确保快照目录存在 ──────────────────────────
mkdirSync(SNAPSHOT_DIR, { recursive: true })

/**
 * 生成业务报表快照（每小时执行一次）
 * 查询当日汇总数据并保存为 JSON 快照文件
 */
function generateSnapshot(db) {
  const now = Date.now()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const ts = todayStart.getTime()

  const data = db.prepare(`
    SELECT DATE(created_at / 1000, 'unixepoch', 'localtime') AS report_date,
      COUNT(*) AS total_tickets,
      SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_tickets,
      COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue,
      COALESCE(AVG(CASE WHEN status='paid' THEN price_cents END), 0) AS avg_revenue,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_count
    FROM tickets WHERE created_at >= ?
    GROUP BY report_date ORDER BY report_date DESC
  `).all(ts)

  const summary = db.prepare(`
    SELECT (SELECT COUNT(*) FROM customers WHERE created_at >= ?) AS customers,
      COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END), 0) AS total_paid
    FROM tickets WHERE created_at >= ?
  `).all(ts, ts)

  const snapshot = {
    generated_at: now,
    date: localDateStr(ts),
    tickets: data,
    summary: summary[0] || { customers: 0, total_paid: 0 }
  }

  const filename = `snapshot-${Date.now()}.json`
  const filepath = path.join(SNAPSHOT_DIR, filename)
  writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf-8')
  console.log(`[scheduler] 快照已保存: ${filename}`)
  pruneSnapshots()
}

// 快照滚动保留：最多 168 个（7 天 × 24 小时）
function pruneSnapshots() {
  try {
    const files = readdirSync(SNAPSHOT_DIR)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse()
    for (let i = 168; i < files.length; i++) {
      try { unlinkSync(path.join(SNAPSHOT_DIR, files[i])) } catch (_) {}
    }
  } catch (_) {}
}

/**
 * 生成每日总结（每天午夜执行一次）
 */
function generateDailySummary(db) {
  const now = Date.now()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const ts = todayStart.getTime()

  const dateStr = localDateStr(ts)
  const yesterday = new Date(ts - 86400000)
  const yesterdayStr = localDateStr(yesterday.getTime())

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status='paid' THEN price_cents ELSE 0 END), 0) AS revenue
    FROM tickets WHERE DATE(created_at / 1000, 'unixepoch', 'localtime') = ?
  `).get(yesterdayStr)

  const tickets = db.prepare(`
    SELECT COUNT(*) AS count FROM tickets
    WHERE DATE(created_at / 1000, 'unixepoch', 'localtime') = ?
  `).get(yesterdayStr)

  const techs = db.prepare(`
    SELECT t.name, COUNT(tk.id) AS tickets,
      COALESCE(SUM(tk.price_cents), 0) AS revenue
    FROM technicians t LEFT JOIN tickets tk ON tk.technician_id=t.id
      AND DATE(tk.created_at / 1000, 'unixepoch', 'localtime') = ?
    WHERE t.active=1 GROUP BY t.id ORDER BY revenue DESC
  `).all(yesterdayStr)
  void dateStr

  console.log(`[scheduler] 每日总结 [${yesterdayStr}]`)
  console.log(`  总票单: ${tickets.count}, 总营收: ${revenue.revenue} 分`)
  console.log(`  技师排名: ${techs.map(t => `${t.name}(${t.tickets}单/${t.revenue}分)`).join(', ')}`)
}

// 历史表保留期：防止 notify/审计/AI 对话无限膨胀拖慢备份
function pruneHistoryTables(db) {
  try {
    const now = Date.now()
    const ninety = now - 90 * 86400000
    const thirty = now - 30 * 86400000
    db.prepare(`DELETE FROM notify_history WHERE created_at < ?`).run(ninety)
    db.prepare(`DELETE FROM ai_chats WHERE created_at < ?`).run(thirty)
    try {
      db.prepare(`DELETE FROM audit_logs WHERE created_at < ?`).run(now - 180 * 86400000)
    } catch { /* 表可能不存在 */ }
  } catch (e) {
    console.error('[scheduler] prune history failed:', e.message)
  }
}

/**
 * 注册定时任务调度器
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerScheduler(fastify) {
  const db = fastify.db

  // 启动即清理一次过期历史
  pruneHistoryTables(db)

  // ── 手动触发端点 ──────────────────────────
  fastify.post('/api/scheduler/run', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员' })
      const rl = checkRateLimit(`${req.ip}|scheduler`, { maxAttempts: 5, windowMs: 60 * 1000 })
      if (!rl.ok) return reply.code(429).send({ error: `触发过于频繁，请 ${rl.retryAfter} 秒后重试` })
      const { type = 'all' } = req.body || {}

      if (type === 'all' || type === 'snapshot') {
        generateSnapshot(db)
      }
      if (type === 'all' || type === 'summary') {
        generateDailySummary(db)
      }
      if (type === 'all' || type === 'prune') {
        pruneHistoryTables(db)
      }

      return { success: true, triggered: type, time: Date.now() }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  // ── 每天午夜执行一次每日总结 ──────────────
  // 每次触发后重新对齐到下一个 0 点，避免 setInterval 漂移
  function scheduleDailySummary() {
    const now = Date.now()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    const msUntilMidnight = midnight.getTime() - now
    const t = setTimeout(() => {
      console.log('[scheduler] 执行每日总结任务')
      try {
        generateDailySummary(db)
        pruneHistoryTables(db)
      } catch (e) {
        console.error('[scheduler] 每日总结任务失败:', e.message)
      }
      scheduleDailySummary()
    }, msUntilMidnight)
    t.unref?.()
  }
  scheduleDailySummary()

  const hourly = setInterval(() => {
    console.log('[scheduler] 执行每小时快照任务')
    try {
      generateSnapshot(db)
    } catch (e) {
      console.error('[scheduler] 快照任务失败:', e.message)
    }
  }, 60 * 60 * 1000)
  hourly.unref?.()

  // 启动时记录
  console.log('[scheduler] 定时任务调度器已启动')
  console.log('[scheduler]   每小时: 生成业务报表快照 → db/reports/snapshots/')
  console.log('[scheduler]   每天0点: 生成每日总结 + 清理历史')
  console.log('[scheduler]   POST /api/scheduler/run  手动触发')
}
