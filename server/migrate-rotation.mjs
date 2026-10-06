// 排钟轮转：数据库迁移脚本
// 运行：node migrate-rotation.mjs
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'

const db = new Database('db/yuwen.db')

// 1. 创建 rotation_log 表
db.exec(`
  CREATE TABLE IF NOT EXISTS rotation_log (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    ticket_id TEXT,
    technician_id TEXT,
    rotation_order_before INTEGER,
    rotation_order_after INTEGER,
    action TEXT,
    created_at INTEGER
  )
`)
console.log('✅ rotation_log 表已创建')

// 2. 验证所有字段
const techCols = db.prepare('PRAGMA table_info(technicians)').all().map(c => c.name)
const ticketCols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name)
console.log('\n=== 字段验证 ===')
console.log('technicians.rotation_order:', techCols.includes('rotation_order') ? '✅' : '❌')
console.log('technicians.rotation_active:', techCols.includes('rotation_active') ? '✅' : '❌')
console.log('technicians.last_served_at:', techCols.includes('last_served_at') ? '✅' : '❌')
console.log('tickets.tick_type:', ticketCols.includes('tick_type') ? '✅' : '❌')

// 3. 显示当前轮转队列
console.log('\n=== 当前轮转队列 ===')
const q = db.prepare('SELECT number, name, rotation_order, status, level FROM technicians ORDER BY rotation_order').all()
q.forEach(t => {
  console.log(`  ${t.rotation_order}. ${t.number}号 ${t.name} (${t.status}) ${t.level || ''}`)
})

db.close()
console.log('\n✅ 迁移完成')
