// 数据库初始化
//
// 选 SQLite 的理由：
//   - 单文件，零运维（PostgreSQL 单店根本用不上）
//   - WAL 模式下并发读写够单店日常用量
//   - 备份就是拷贝文件
//   - 老板换电脑只要拷过去就行
//
// schema 用代码定义而不是单独 .sql 文件，方便在一个进程里做版本迁移。
// 未来 schema 演进时新增 migrate 函数即可。

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { nanoid } from 'nanoid'

export function initDatabase(dbDir) {
  fs.mkdirSync(dbDir, { recursive: true })
  fs.mkdirSync(path.join(dbDir, 'backups'), { recursive: true })

  const dbPath = path.join(dbDir, 'yuwen.db')
  const db = new Database(dbPath)

  // WAL 模式：写不阻塞读，断电不烂库（只丢最后一笔未 commit 的事务）
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')   // 比 FULL 快很多，断电最多丢最后一笔
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  // 跑 schema（IF NOT EXISTS 多次执行无害）
  db.exec(SCHEMA)

  // 跑迁移（按版本号顺序，每个迁移只跑一次）
  runMigrations(db)

  // 第一次跑：seed 默认数据（项目库、技师示例等），方便老板上手
  seedIfEmpty(db)

  return db
}

const SCHEMA = `
-- ─── 元信息 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─── 门店（多店预留，单店时只有 1 行）──────────────
CREATE TABLE IF NOT EXISTS shops (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ─── 服务项目（足底/中式推拿/采耳 等）──────────────
CREATE TABLE IF NOT EXISTS services (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  name        TEXT NOT NULL,
  category    TEXT,                -- 足疗 / 推拿 / 采耳 / 其他
  duration    INTEGER NOT NULL,    -- 分钟
  price_cents INTEGER NOT NULL,    -- 金额永远用整数（分），不要用 float
  commission_type    TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
  commission_value   INTEGER NOT NULL DEFAULT 0,      -- percent: 百分点 *100; fixed: 分
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ─── 技师 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS technicians (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  number      TEXT NOT NULL,       -- 工号（如 "01"，常用于显示）
  name        TEXT NOT NULL,
  level       TEXT,                -- 初级/中级/高级/技师长
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'idle', -- idle/working/break/off
  hired_at    INTEGER,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(shop_id, number)
);

-- ─── 房间/床位 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  number      TEXT NOT NULL,       -- 房号 / 床号
  type        TEXT,                -- 大厅/包间/VIP
  capacity    INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'idle',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(shop_id, number)
);

-- ─── 顾客（会员）─────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  name            TEXT,
  phone           TEXT,
  gender          TEXT,
  birthday        TEXT,
  member_no       TEXT,             -- 会员卡号
  balance_cents   INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  visit_count     INTEGER NOT NULL DEFAULT 0,
  last_visit_at   INTEGER,
  notes           TEXT,             -- 备注：忌口、偏好等
  tags            TEXT,             -- JSON array
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(shop_id, phone)
);

-- ─── 钟单（核心实体：一次服务）───────────────────
-- 状态机：pending -> active -> completed -> paid
--                              -> canceled
CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  customer_id     TEXT REFERENCES customers(id),
  technician_id   TEXT REFERENCES technicians(id),
  room_id         TEXT REFERENCES rooms(id),
  service_id      TEXT NOT NULL REFERENCES services(id),
  status          TEXT NOT NULL DEFAULT 'pending', -- pending/active/completed/paid/canceled
  price_cents     INTEGER NOT NULL,    -- 落单价（可能因促销和定价不同）
  commission_cents INTEGER NOT NULL DEFAULT 0,  -- 该单技师提成
  started_at      INTEGER,
  completed_at    INTEGER,
  paid_at         INTEGER,
  payment_method  TEXT,                -- cash/wechat/alipay/balance/card
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_shop_status ON tickets(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_tech ON tickets(technician_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);

-- ─── 钱包流水（储值卡充值/消费/退款）──────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  customer_id     TEXT NOT NULL REFERENCES customers(id),
  type            TEXT NOT NULL,    -- topup/consume/refund/adjust
  amount_cents    INTEGER NOT NULL, -- 充值正数，消费负数
  balance_after   INTEGER NOT NULL,
  ticket_id       TEXT REFERENCES tickets(id),
  notes           TEXT,
  created_by      TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_customer ON wallet_transactions(customer_id, created_at);

-- ─── 审计日志（财务关键操作留痕）─────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT,
  actor       TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  payload     TEXT,             -- JSON
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_shop_created ON audit_logs(shop_id, created_at);
`

// ── 迁移系统 ──────────────────────────────────────
// 每次 schema 演进新增一个迁移，不要修改老的。
const MIGRATIONS = [
  // { version: 1, up: (db) => { db.exec('ALTER TABLE ...') } },
]

function runMigrations(db) {
  const current = Number(db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get()?.value || 0)
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      console.log(`[db] 应用迁移 v${m.version}`)
      db.transaction(() => {
        m.up(db)
        db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)`).run(String(m.version))
      })()
    }
  }
}

// ── 默认数据 seed ─────────────────────────────────
// 第一次跑数据库时填入合理默认，让老板开箱就能用。
function seedIfEmpty(db) {
  const shopCount = db.prepare(`SELECT COUNT(*) AS c FROM shops`).get().c
  if (shopCount > 0) return

  const now = Date.now()

  db.transaction(() => {
    const shopId = nanoid(12)
    db.prepare(`INSERT INTO shops(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`)
      .run(shopId, '我的足浴店', now, now)

    // 常用项目（默认价格仅供参考，老板自己改）
    const services = [
      ['足浴',     '足疗', 60,  9800,  20], // 98 元，提成 20%
      ['足浴+按摩', '足疗', 90,  16800, 20],
      ['全身推拿', '推拿', 60,  18800, 25],
      ['采耳',     '采耳', 30,  6800,  30],
      ['肩颈舒压', '推拿', 30,  6800,  25],
      ['深度足疗', '足疗', 120, 26800, 22],
    ]
    const insertSvc = db.prepare(`
      INSERT INTO services(id, shop_id, name, category, duration, price_cents,
        commission_type, commission_value, sort_order, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, 'percent', ?, ?, ?, ?)
    `)
    services.forEach((s, i) => {
      insertSvc.run(nanoid(10), shopId, s[0], s[1], s[2], s[3], s[4] * 100, i, now, now)
    })

    // 房间（10 个示例床位）
    const insertRoom = db.prepare(`
      INSERT INTO rooms(id, shop_id, number, type, sort_order, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 1; i <= 10; i++) {
      const type = i <= 6 ? '大厅' : (i <= 9 ? '包间' : 'VIP')
      insertRoom.run(nanoid(10), shopId, String(i).padStart(2, '0'), type, i, now, now)
    }

    // 技师示例（老板自己加）
    const insertTech = db.prepare(`
      INSERT INTO technicians(id, shop_id, number, name, level, hired_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const techs = [
      ['01', '示范师傅', '高级'],
      ['02', '小王',     '中级'],
      ['03', '小李',     '初级'],
    ]
    techs.forEach(t => {
      insertTech.run(nanoid(10), shopId, t[0], t[1], t[2], now, now, now)
    })

    db.prepare(`INSERT INTO meta(key, value) VALUES('seeded_at', ?)`).run(String(now))
  })()

  console.log('[db] 已 seed 默认数据（1 店、6 项目、10 房间、3 技师示范）')
}
