/**
 * 排钟轮转单元测试
 *
 * 运行：JWT_SECRET=test node --test test/rotation.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import {
  getRotationQueue,
  getNextTechnician,
  assignWithRotation,
  assignPointTicket,
  assignAddTicket,
  releaseTechnician,
  technicianCheckIn,
  technicianCheckOut,
  getRotationStats,
  getTechnicianStats,
} from '../src/rotation/rotation.js'

// 每个测试用独立内存数据库
function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE technicians (
      id TEXT PRIMARY KEY, shop_id TEXT, number TEXT, name TEXT, level TEXT,
      status TEXT DEFAULT 'idle', rotation_order INTEGER DEFAULT 0,
      rotation_active INTEGER DEFAULT 1, last_served_at INTEGER,
      active INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY, shop_id TEXT, number TEXT, type TEXT,
      capacity INTEGER DEFAULT 1, status TEXT DEFAULT 'idle', active INTEGER DEFAULT 1,
      created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY, shop_id TEXT, customer_id TEXT, technician_id TEXT,
      room_id TEXT, service_id TEXT, status TEXT DEFAULT 'pending',
      price_cents INTEGER DEFAULT 0, commission_cents INTEGER DEFAULT 0,
      started_at INTEGER, completed_at INTEGER, paid_at INTEGER,
      tick_type TEXT DEFAULT 'rotation', created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE rotation_log (
      id TEXT PRIMARY KEY, shop_id TEXT, ticket_id TEXT, technician_id TEXT,
      rotation_order_before INTEGER, rotation_order_after INTEGER,
      action TEXT, created_at INTEGER
    );
  `)
  db.prepare('INSERT INTO shops(id, name) VALUES(?, ?)').run('shop1', '测试店')
  return db
}

function addTech(db, number, name, level = '中级') {
  const id = nanoid(12)
  db.prepare(`
    INSERT INTO technicians(id, shop_id, number, name, level, status, rotation_order, rotation_active, created_at, updated_at)
    VALUES(?, 'shop1', ?, ?, ?, 'idle', ?, 1, ?, ?)
  `).run(id, number, name, level, parseInt(number), Date.now(), Date.now())
  return id
}

function addRoom(db, number, type = '大厅', capacity = 4) {
  const id = nanoid(12)
  db.prepare(`
    INSERT INTO rooms(id, shop_id, number, type, capacity, status, active, created_at, updated_at)
    VALUES(?, 'shop1', ?, ?, ?, 'idle', 1, ?, ?)
  `).run(id, number, type, capacity, Date.now(), Date.now())
  return id
}

function addTicket(db, priceCents = 6800) {
  const id = nanoid(12)
  db.prepare(`
    INSERT INTO tickets(id, shop_id, status, price_cents, created_at, updated_at)
    VALUES(?, 'shop1', 'pending', ?, ?, ?)
  `).run(id, priceCents, Date.now(), Date.now())
  return id
}

// ─── 基础轮转 ────────────────────────────────────
test('轮转队列按 rotation_order 排序', () => {
  const db = createTestDb()
  addTech(db, '03', '小李', '初级')
  addTech(db, '01', '张师傅', '高级')
  addTech(db, '02', '小王', '中级')

  const q = getRotationQueue(db, 'shop1')
  assert.equal(q.length, 3)
  assert.equal(q[0].name, '张师傅')
  assert.equal(q[1].name, '小王')
  assert.equal(q[2].name, '小李')
  db.close()
})

test('getNextTechnician 返回队首 idle 技师', () => {
  const db = createTestDb()
  addTech(db, '01', '张师傅')
  addTech(db, '02', '小王')
  db.prepare("UPDATE technicians SET status='working' WHERE number='01'").run()

  const next = getNextTechnician(db, 'shop1')
  assert.equal(next.name, '小王')
  db.close()
})

test('无 idle 技师时 getNextTechnician 返回 null', () => {
  const db = createTestDb()
  addTech(db, '01', '张师傅')
  db.prepare("UPDATE technicians SET status='working' WHERE number='01'").run()

  const next = getNextTechnician(db, 'shop1')
  assert.equal(next, null)
  db.close()
})

// ─── 派单轮转 ────────────────────────────────────
test('派单后技师排到队尾', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const t2 = addTech(db, '02', '小王')
  const t3 = addTech(db, '03', '小李')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db)

  // 第一次派单给张师傅（队首）
  const r1 = assignWithRotation(db, 'shop1', ticket, t1, room)
  assert.equal(r1.rotation_order_before, 1)
  assert.equal(r1.rotation_order_after, 4) // 排到队尾

  // 张师傅状态变为 working
  const tech1 = db.prepare('SELECT * FROM technicians WHERE id=?').get(t1)
  assert.equal(tech1.status, 'working')

  // 第二次派单应该给小王（新的队首）
  const ticket2 = addTicket(db)
  const r2 = assignWithRotation(db, 'shop1', ticket2, t2, room)
  assert.equal(r2.rotation_order_before, 2)
  assert.equal(r2.rotation_order_after, 5)

  db.close()
})

test('点钟派单后排回队尾', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const t2 = addTech(db, '02', '小王')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db)

  // 点钟派单给张师傅
  const r = assignPointTicket(db, 'shop1', ticket, t1, room)
  assert.equal(r.tick_type, 'point')
  assert.equal(r.rotation_order_after, 3) // 排到队尾

  // 张师傅状态为 working
  const tech = db.prepare('SELECT * FROM technicians WHERE id=?').get(t1)
  assert.equal(tech.status, 'working')

  db.close()
})

test('加钟派单给同一技师', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db)

  const r = assignAddTicket(db, 'shop1', ticket, t1, room)
  assert.equal(r.tick_type, 'add')

  const tech = db.prepare('SELECT * FROM technicians WHERE id=?').get(t1)
  assert.equal(tech.status, 'working')

  db.close()
})

test('派单时检查技师状态', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db)

  // 技师设为 working
  db.prepare("UPDATE technicians SET status='working' WHERE id=?").run(t1)

  assert.throws(() => {
    assignWithRotation(db, 'shop1', ticket, t1, room)
  }, /无法派单/)

  db.close()
})

test('派单时检查房间容量', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const t2 = addTech(db, '02', '小王')
  const room = addRoom(db, '01', 'VIP', 1) // 容量 1
  const ticket1 = addTicket(db)
  const ticket2 = addTicket(db)

  // 第一个派单成功
  assignWithRotation(db, 'shop1', ticket1, t1, room)

  // 第二个派单失败（房间已满）
  assert.throws(() => {
    assignWithRotation(db, 'shop1', ticket2, t2, room)
  }, /房间已满/)

  db.close()
})

// ─── 技师状态管理 ────────────────────────────────
test('完成服务后技师恢复 idle', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db)

  assignWithRotation(db, 'shop1', ticket, t1, room)
  releaseTechnician(db, 'shop1', t1)

  const tech = db.prepare('SELECT * FROM technicians WHERE id=?').get(t1)
  assert.equal(tech.status, 'idle')

  db.close()
})

test('技师上班加入轮转队列', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  db.prepare("UPDATE technicians SET status='off', rotation_active=0 WHERE id=?").run(t1)

  technicianCheckIn(db, 'shop1', t1)

  const tech = db.prepare('SELECT * FROM technicians WHERE id=?').get(t1)
  assert.equal(tech.status, 'idle')
  assert.equal(tech.rotation_active, 1)

  db.close()
})

test('技师下班退出轮转队列', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')

  technicianCheckOut(db, 'shop1', t1)

  const tech = db.prepare('SELECT * FROM technicians WHERE id=?').get(t1)
  assert.equal(tech.status, 'off')
  assert.equal(tech.rotation_active, 0)

  db.close()
})

// ─── 统计 ────────────────────────────────────────
test('轮转统计正确', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const t2 = addTech(db, '02', '小王')
  const t3 = addTech(db, '03', '小李')
  db.prepare("UPDATE technicians SET status='working' WHERE id=?").run(t1)
  db.prepare("UPDATE technicians SET status='break' WHERE id=?").run(t2)

  const stats = getRotationStats(db, 'shop1')
  assert.equal(stats.total, 3)
  assert.equal(stats.idle, 1)
  assert.equal(stats.working, 1)
  assert.equal(stats.break, 1)

  db.close()
})

test('技师服务统计正确', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db, 6800)

  assignWithRotation(db, 'shop1', ticket, t1, room)

  const stats = getTechnicianStats(db, 'shop1', 7)
  assert.equal(stats.length, 1)
  assert.equal(stats[0].name, '张师傅')
  assert.equal(stats[0].ticket_count, 1)
  assert.equal(stats[0].total_cents, 6800)

  db.close()
})

// ─── 轮转日志 ────────────────────────────────────
test('派单记录轮转日志', () => {
  const db = createTestDb()
  const t1 = addTech(db, '01', '张师傅')
  const room = addRoom(db, '01', '大厅', 4)
  const ticket = addTicket(db)

  assignWithRotation(db, 'shop1', ticket, t1, room)

  const logs = db.prepare('SELECT * FROM rotation_log WHERE ticket_id=?').all(ticket)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].action, 'assign:rotation')
  assert.equal(logs[0].rotation_order_before, 1)
  assert.equal(logs[0].rotation_order_after, 2)

  db.close()
})
