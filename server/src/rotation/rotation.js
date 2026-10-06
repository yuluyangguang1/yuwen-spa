// 排钟轮转核心逻辑
//
// 设计原则：
//   1. 公平轮转：按 rotation_order 排序，队首优先
//   2. 点钟优先制：点钟技师上完钟后排回队尾（行业主流做法）
//   3. 状态感知：idle 技师才参与轮转，working/break/off 跳过
//   4. 可配置：点钟是否计入轮转、是否启用轮转
//
// 数据模型：
//   technicians.rotation_order  — 轮转顺序（越小越优先）
//   technicians.rotation_active — 是否参与轮转（1=参与，0=不参与）
//   technicians.last_served_at  — 上次服务时间
//   tickets.tick_type           — 钟型：rotation/point/add/leave/skip/hang/retain
//   rotation_log                — 轮转日志

import { nanoid } from 'nanoid'

/**
 * 获取当前轮转队列（按 rotation_order 排序）
 * @param {Database} db
 * @param {string} shopId
 * @returns {Array} 技师列表
 */
export function getRotationQueue(db, shopId) {
  return db.prepare(`
    SELECT id, shop_id, number, name, level, status, rotation_order, rotation_active, last_served_at
    FROM technicians
    WHERE shop_id = ? AND rotation_active = 1
    ORDER BY rotation_order ASC
  `).all(shopId)
}

/**
 * 获取下一个可服务的技师（轮转队首）
 * @param {Database} db
 * @param {string} shopId
 * @returns {Object|null} 技师信息
 */
export function getNextTechnician(db, shopId) {
  const candidates = db.prepare(`
    SELECT id, shop_id, number, name, level, status, rotation_order, rotation_active, last_served_at
    FROM technicians
    WHERE shop_id = ? AND rotation_active = 1 AND status = 'idle'
    ORDER BY rotation_order ASC
  `).all(shopId)

  if (candidates.length === 0) return null
  return candidates[0]
}

/**
 * 派单给指定技师（轮转语义）
 * @param {Database} db
 * @param {string} shopId
 * @param {string} ticketId
 * @param {string} technicianId
 * @param {string} roomId
 * @param {string} tickType — 钟型：rotation/point/add/leave/skip/hang/retain
 * @returns {Object} 派单结果
 */
export function assignWithRotation(db, shopId, ticketId, technicianId, roomId, tickType = 'rotation') {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId)
  if (!ticket) throw new Error('ticket not found')

  const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND shop_id = ?').get(technicianId, shopId)
  if (!tech) throw new Error('technician not found')

  // 检查技师是否可用
  if (tech.status !== 'idle') {
    throw new Error(`技师 ${tech.name} 当前状态为 ${tech.status}，无法派单`)
  }

  // 检查房间容量
  if (roomId) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND shop_id = ?').get(roomId, shopId)
    if (!room) throw new Error('room not found')
    const cap = Math.max(1, room.capacity || 1)
    const current = db.prepare(
      `SELECT COUNT(*) AS c FROM tickets WHERE room_id = ? AND status IN ('pending','active') AND id != ?`
    ).get(roomId, ticketId).c
    if (current >= cap) throw new Error(`房间已满（${current}/${cap}）`)
  }

  const now = Date.now()
  const maxOrder = db.prepare(
    `SELECT COALESCE(MAX(rotation_order), 0) AS m FROM technicians WHERE shop_id = ? AND rotation_active = 1`
  ).get(shopId).m
  const newOrder = maxOrder + 1

  db.transaction(() => {
    // 更新钟单
    db.prepare(`
      UPDATE tickets SET technician_id = ?, room_id = ?, tick_type = ?, updated_at = ? WHERE id = ?
    `).run(technicianId, roomId, tickType, now, ticketId)

    // 更新技师状态和轮转顺序
    db.prepare(`
      UPDATE technicians SET status = 'working', rotation_order = ?, last_served_at = ?, updated_at = ? WHERE id = ?
    `).run(newOrder, now, now, technicianId)

    // 记录轮转日志
    db.prepare(`
      INSERT INTO rotation_log(id, shop_id, ticket_id, technician_id, rotation_order_before, rotation_order_after, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(12), shopId, ticketId, technicianId, tech.rotation_order, newOrder, `assign:${tickType}`, now)
  })()

  return {
    ticket_id: ticketId,
    technician_id: technicianId,
    room_id: roomId,
    tick_type: tickType,
    rotation_order_before: tech.rotation_order,
    rotation_order_after: newOrder,
  }
}

/**
 * 点钟派单（顾客指定技师）
 * 点钟技师上完钟后排回队尾（行业主流做法）
 * @param {Database} db
 * @param {string} shopId
 * @param {string} ticketId
 * @param {string} technicianId
 * @param {string} roomId
 * @returns {Object} 派单结果
 */
export function assignPointTicket(db, shopId, ticketId, technicianId, roomId) {
  return assignWithRotation(db, shopId, ticketId, technicianId, roomId, 'point')
}

/**
 * 加钟派单（同一技师继续服务）
 * @param {Database} db
 * @param {string} shopId
 * @param {string} ticketId
 * @param {string} technicianId
 * @param {string} roomId
 * @returns {Object} 派单结果
 */
export function assignAddTicket(db, shopId, ticketId, technicianId, roomId) {
  return assignWithRotation(db, shopId, ticketId, technicianId, roomId, 'add')
}

/**
 * 完成服务后恢复技师状态
 * @param {Database} db
 * @param {string} shopId
 * @param {string} technicianId
 */
export function releaseTechnician(db, shopId, technicianId) {
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND shop_id = ?').get(technicianId, shopId)
  if (!tech) return

  const now = Date.now()
  db.prepare(`
    UPDATE technicians SET status = 'idle', updated_at = ? WHERE id = ?
  `).run(now, technicianId)

  // 记录日志
  db.prepare(`
    INSERT INTO rotation_log(id, shop_id, ticket_id, technician_id, rotation_order_before, rotation_order_after, action, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, 'release', ?)
  `).run(nanoid(12), shopId, technicianId, tech.rotation_order, tech.rotation_order, now)
}

/**
 * 技师上班（加入轮转队列）
 * @param {Database} db
 * @param {string} shopId
 * @param {string} technicianId
 */
export function technicianCheckIn(db, shopId, technicianId) {
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND shop_id = ?').get(technicianId, shopId)
  if (!tech) throw new Error('technician not found')

  const now = Date.now()
  const maxOrder = db.prepare(
    `SELECT COALESCE(MAX(rotation_order), 0) AS m FROM technicians WHERE shop_id = ? AND rotation_active = 1`
  ).get(shopId).m

  db.transaction(() => {
    db.prepare(`
      UPDATE technicians SET status = 'idle', rotation_active = 1, rotation_order = ?, updated_at = ? WHERE id = ?
    `).run(maxOrder + 1, now, technicianId)

    db.prepare(`
      INSERT INTO rotation_log(id, shop_id, ticket_id, technician_id, rotation_order_before, rotation_order_after, action, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, 'checkin', ?)
    `).run(nanoid(12), shopId, technicianId, tech.rotation_order, maxOrder + 1, now)
  })()
}

/**
 * 技师下班（退出轮转队列）
 * @param {Database} db
 * @param {string} shopId
 * @param {string} technicianId
 */
export function technicianCheckOut(db, shopId, technicianId) {
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND shop_id = ?').get(technicianId, shopId)
  if (!tech) throw new Error('technician not found')

  const now = Date.now()
  db.transaction(() => {
    db.prepare(`
      UPDATE technicians SET status = 'off', rotation_active = 0, updated_at = ? WHERE id = ?
    `).run(now, technicianId)

    db.prepare(`
      INSERT INTO rotation_log(id, shop_id, ticket_id, technician_id, rotation_order_before, rotation_order_after, action, created_at)
      VALUES (?, ?, NULL, ?, ?, NULL, 'checkout', ?)
    `).run(nanoid(12), shopId, technicianId, tech.rotation_order, now)
  })()
}

/**
 * 获取轮转统计
 * @param {Database} db
 * @param {string} shopId
 * @returns {Object} 统计信息
 */
export function getRotationStats(db, shopId) {
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM technicians WHERE shop_id = ? AND rotation_active = 1`
  ).get(shopId).c

  const idle = db.prepare(
    `SELECT COUNT(*) AS c FROM technicians WHERE shop_id = ? AND rotation_active = 1 AND status = 'idle'`
  ).get(shopId).c

  const working = db.prepare(
    `SELECT COUNT(*) AS c FROM technicians WHERE shop_id = ? AND rotation_active = 1 AND status = 'working'`
  ).get(shopId).c

  const breakCount = db.prepare(
    `SELECT COUNT(*) AS c FROM technicians WHERE shop_id = ? AND rotation_active = 1 AND status = 'break'`
  ).get(shopId).c

  const off = db.prepare(
    `SELECT COUNT(*) AS c FROM technicians WHERE shop_id = ? AND rotation_active = 1 AND status = 'off'`
  ).get(shopId).c

  return { total, idle, working, break: breakCount, off }
}

/**
 * 获取技师服务次数统计
 * @param {Database} db
 * @param {string} shopId
 * @param {number} days — 最近 N 天
 * @returns {Array} 技师统计
 */
export function getTechnicianStats(db, shopId, days = 7) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  return db.prepare(`
    SELECT
      t.id,
      t.number,
      t.name,
      t.level,
      t.status,
      t.rotation_order,
      t.last_served_at,
      COUNT(tk.id) AS ticket_count,
      COALESCE(SUM(tk.price_cents), 0) AS total_cents
    FROM technicians t
    LEFT JOIN tickets tk ON tk.technician_id = t.id AND tk.created_at >= ?
    WHERE t.shop_id = ? AND t.rotation_active = 1
    GROUP BY t.id
    ORDER BY t.rotation_order ASC
  `).all(since, shopId)
}
