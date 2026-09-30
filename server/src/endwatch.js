// 完钟倒计时提醒
//
// 每 30s 扫描 active 钟单，跨过预警分钟/到点时各广播一次：
//   ticket:ending → { stage: 分钟数, remain_sec, ...ticket }
//   ticket:end    → 到点/超时
// 同单同档只发一次（内存 Map，进程重启后若仍在窗口内会再发一次，可接受）。
// 过夜单不提醒。可选把事件写入 notify_history（channels=[ws]）。

import { getNotifyConfig, recordNotifyHistory } from './notify/index.js'

const fired = new Map() // `${ticketId}:${stage}` → true
const TICK_MS = 30_000

function ticketPayload(row, now) {
  const durationMs = (row.service_duration || 0) * 60000
  const endAt = row.started_at + durationMs
  const remainMs = endAt - now
  return {
    id: row.id,
    shop_id: row.shop_id,
    technician_id: row.technician_id,
    room_id: row.room_id,
    service_name: row.service_name || '服务',
    technician_name: row.technician_name || null,
    technician_number: row.technician_number || null,
    room_number: row.room_number || null,
    room_type: row.room_type || null,
    service_duration: row.service_duration || 0,
    started_at: row.started_at,
    end_at: endAt,
    remain_sec: Math.max(0, Math.round(remainMs / 1000)),
  }
}

function announceText(p, stage) {
  const who = p.technician_number || p.technician_name
    ? `${p.technician_number ? p.technician_number + '号' : ''}${p.technician_name || '技师'}`
    : '技师'
  const room = p.room_number ? `${p.room_number}号房` : ''
  const place = [room, p.service_name].filter(Boolean).join('')
  if (stage === 0) return `${who}，${place || '服务'}到点了`
  return `${who}，${place || '服务'}还有${stage}分钟`
}

function fire(fastify, type, stage, p, shopId) {
  const key = `${p.id}:${stage}`
  if (fired.has(key)) return
  fired.set(key, true)
  const data = stage === 0 ? p : { ...p, stage }
  fastify.broadcast({ type, shop_id: shopId, data })
  const text = announceText(p, stage)
  recordNotifyHistory(
    type === 'ticket:end' ? 'ticket.end' : 'ticket.ending',
    text,
    [{ key: 'ws', ok: true }],
    shopId,
  )
  console.log(`[endwatch] ${type} stage=${stage} ${text}`)
}

export async function registerEndWatch(fastify) {
  const db = fastify.db

  const tick = () => {
    try {
      const now = Date.now()
      const rows = db.prepare(`
        SELECT t.id, t.shop_id, t.technician_id, t.room_id, t.started_at, t.overnight,
          s.duration AS service_duration, s.name AS service_name,
          tech.name AS technician_name, tech.number AS technician_number,
          r.number AS room_number, r.type AS room_type
        FROM tickets t
        LEFT JOIN services s ON t.service_id = s.id
        LEFT JOIN technicians tech ON t.technician_id = tech.id
        LEFT JOIN rooms r ON t.room_id = r.id
        WHERE t.status = 'active' AND t.started_at IS NOT NULL
      `).all()

      const activeIds = new Set()
      const cfgByShop = new Map()

      for (const row of rows) {
        if (row.overnight) continue // 过夜不按钟点提醒
        if (!row.service_duration || !row.started_at) continue

        activeIds.add(row.id)

        let warnMinutes = [5]
        if (!cfgByShop.has(row.shop_id)) {
          const cfg = getNotifyConfig(row.shop_id)
          const raw = Array.isArray(cfg.endWarnMinutes) && cfg.endWarnMinutes.length
            ? cfg.endWarnMinutes
            : [5]
          warnMinutes = raw
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0 && n <= 480)
            .sort((a, b) => b - a)
          if (!warnMinutes.length) warnMinutes = [5]
          cfgByShop.set(row.shop_id, warnMinutes)
        } else {
          warnMinutes = cfgByShop.get(row.shop_id)
        }

        const p = ticketPayload(row, now)
        const remainMs = p.end_at - now

        for (const m of warnMinutes) {
          if (remainMs <= m * 60000 && remainMs > 0) {
            fire(fastify, 'ticket:ending', m, p, row.shop_id)
          }
        }
        if (remainMs <= 0) {
          fire(fastify, 'ticket:end', 0, p, row.shop_id)
        }
      }

      // 清理已结束单的去重键
      for (const key of fired.keys()) {
        const id = key.slice(0, key.lastIndexOf(':'))
        if (!activeIds.has(id)) fired.delete(key)
      }
    } catch (e) {
      console.error('[endwatch] tick failed:', e.message)
    }
  }

  // 手动触发（测试/对齐）
  fastify.decorate('runEndWatchOnce', tick)

  setInterval(tick, TICK_MS)
  // 启动稍后跑一次，避免与路由注册竞态
  setTimeout(tick, 3000)

  console.log('[endwatch] 完钟倒计时提醒已启动（每 30s 扫描 active 钟单）')
}
