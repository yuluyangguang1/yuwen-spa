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
import { hashPassword } from '../auth/utils.js'

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

  // 老库补种：食物用品商品 + 客服账号（幂等，已存在则跳过）
  seedExtras(db)

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
  avatar      TEXT,                -- 头像 URL（可选）
  bio         TEXT,                -- 个人简介
  specialties TEXT,                -- 擅长项目（JSON array）
  years       INTEGER,             -- 从业年限
  status      TEXT NOT NULL DEFAULT 'idle', -- idle/working/break/off
  ai_score    REAL NOT NULL DEFAULT 0,     -- AI 综合评分（0-5，每月更新）
  ai_scored_at INTEGER,            -- 上次 AI 评分时间
  review_count INTEGER NOT NULL DEFAULT 0, -- 累计评价数
  avg_rating  REAL NOT NULL DEFAULT 0,     -- 平均评分（1-5）
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
  fulfillment     TEXT NOT NULL DEFAULT 'onsite',  -- onsite=到店服务, self=扫码自助/自提
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

-- ─── 服务评价 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  ticket_id       TEXT REFERENCES tickets(id),
  technician_id   TEXT NOT NULL REFERENCES technicians(id),
  customer_id     TEXT REFERENCES customers(id),
  rating          INTEGER NOT NULL,    -- 1-5 星
  tags            TEXT,                -- JSON array: ["手法好","态度佳","力度适中"]
  comment         TEXT,                -- 文字评价
  anonymous       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_tech ON reviews(technician_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_shop ON reviews(shop_id, created_at);

-- ─── AI 月度评分记录 ──────────────────────────────
CREATE TABLE IF NOT EXISTS ai_scores (
  id              TEXT PRIMARY KEY,
  technician_id   TEXT NOT NULL REFERENCES technicians(id),
  month           TEXT NOT NULL,        -- "2026-05"
  score           REAL NOT NULL,        -- 0-5
  dimensions      TEXT,                 -- JSON: {service:4.2, attitude:4.5, skill:4.0, punctuality:4.8}
  summary         TEXT,                 -- AI 生成的一句话总结
  review_count    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  UNIQUE(technician_id, month)
);

-- ─── 用户（登录账号）─────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  shop_id       TEXT NOT NULL REFERENCES shops(id),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'pos',  -- admin / pos / tech / cs
  display_name  TEXT,
  technician_id TEXT REFERENCES technicians(id),  -- role=tech 时关联技师
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ─── AI 对话记录 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chats (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  role        TEXT NOT NULL,         -- user / assistant
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- ─── 食物用品（点单商品）───────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  name        TEXT NOT NULL,
  category    TEXT,                  -- 饮品 / 食品 / 用品
  price_cents INTEGER NOT NULL,
  stock       INTEGER,               -- NULL = 不限库存
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ─── 顾客点单订单 ─────────────────────────────────
-- 履约状态机：pending -> accepted -> delivered
--                      -> canceled
-- 收款独立维度：paid_at 非空 = 已收款
CREATE TABLE IF NOT EXISTS product_orders (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  room_id     TEXT REFERENCES rooms(id),
  ticket_id   TEXT REFERENCES tickets(id),
  status      TEXT NOT NULL DEFAULT 'pending', -- pending/accepted/delivered/canceled
  total_cents INTEGER NOT NULL,
  payment_method TEXT,                -- cash/wechat/alipay/balance/card
  paid_at     INTEGER,                -- 收款时间（NULL=未收）
  paid_by     TEXT,                   -- 收款操作人 users.id
  notes       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ─── 交接班 ──────────────────────────────────────
-- 班次期间实时汇总在查询时计算；关班时落快照。
CREATE TABLE IF NOT EXISTS shifts (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  user_id     TEXT REFERENCES users(id),
  username    TEXT,
  opened_at   INTEGER NOT NULL,
  closed_at   INTEGER,
  status      TEXT NOT NULL DEFAULT 'open', -- open/closed
  -- 关班快照（按支付方式：钟单+点单合并）
  cash_cents      INTEGER NOT NULL DEFAULT 0,
  wechat_cents    INTEGER NOT NULL DEFAULT 0,
  alipay_cents    INTEGER NOT NULL DEFAULT 0,
  balance_cents   INTEGER NOT NULL DEFAULT 0,
  card_cents      INTEGER NOT NULL DEFAULT 0,
  topup_cents     INTEGER NOT NULL DEFAULT 0, -- 班内充值流入
  revenue_cents   INTEGER NOT NULL DEFAULT 0, -- 钟单+点单营收
  ticket_count    INTEGER NOT NULL DEFAULT 0,
  product_count   INTEGER NOT NULL DEFAULT 0,
  actual_cash_cents INTEGER,           -- 实际钱箱现金（点钞录入）
  diff_cents      INTEGER,             -- 差额 = 实际 - 系统现金
  notes           TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS product_order_items (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES product_orders(id) ON DELETE CASCADE,
  product_id   TEXT REFERENCES products(id),
  product_name TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,
  qty          INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_product_orders_shop_status ON product_orders(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_product_orders_room ON product_orders(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_product_order_items_order ON product_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_shifts_shop_status ON shifts(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened ON shifts(opened_at);

CREATE INDEX IF NOT EXISTS idx_services_shop ON services(shop_id);
CREATE INDEX IF NOT EXISTS idx_rooms_shop ON rooms(shop_id);
CREATE INDEX IF NOT EXISTS idx_technicians_shop ON technicians(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_ai_chats_shop_created ON ai_chats(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_ticket ON reviews(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wallet_shop_type ON wallet_transactions(shop_id, type);
CREATE INDEX IF NOT EXISTS idx_ai_scores_tech ON ai_scores(technician_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- ─── 优惠券 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
  value           INTEGER NOT NULL,
  min_spend_cents INTEGER NOT NULL DEFAULT 0,
  max_uses        INTEGER,
  used_count      INTEGER NOT NULL DEFAULT 0,
  starts_at       INTEGER,
  ends_at         INTEGER,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(shop_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coupons_shop ON coupons(shop_id, active);

-- ─── 预约 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(id),
  customer_id     TEXT REFERENCES customers(id),
  technician_id   TEXT REFERENCES technicians(id),
  service_id      TEXT REFERENCES services(id),
  room_id         TEXT REFERENCES rooms(id),
  customer_name   TEXT,
  customer_phone  TEXT,
  notes           TEXT,
  scheduled_at    INTEGER NOT NULL,
  duration_min    INTEGER NOT NULL DEFAULT 60,
  status          TEXT NOT NULL DEFAULT 'pending',
  ticket_id       TEXT REFERENCES tickets(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_shop_status ON appointments(shop_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appt_scheduled ON appointments(scheduled_at);

-- ─── 通知历史 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS notify_history (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT,
  event       TEXT NOT NULL,
  content     TEXT,
  channels    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notify_hist_shop ON notify_history(shop_id, created_at);

-- ─── 库存出入库流水 ────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  type        TEXT NOT NULL,        -- in | out | adjust
  qty         INTEGER NOT NULL,     -- 对库存的有符号增减
  stock_after INTEGER,
  ref_type    TEXT,                 -- order | cancel | manual
  ref_id      TEXT,
  notes       TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_mov_shop ON stock_movements(shop_id, created_at);
`

// ── 迁移系统 ──────────────────────────────────────
// 每次 schema 演进新增一个迁移，不要修改老的。
const MIGRATIONS = [
  { version: 1, up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        shop_id       TEXT NOT NULL REFERENCES shops(id),
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'pos',
        display_name  TEXT,
        technician_id TEXT REFERENCES technicians(id),
        active        INTEGER NOT NULL DEFAULT 1,
        last_login_at INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )
    `)
  }},
  { version: 2, up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_chats (
        id          TEXT PRIMARY KEY,
        shop_id     TEXT NOT NULL REFERENCES shops(id),
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      )
    `)
  }},
  { version: 3, up: (db) => {
    db.exec(`ALTER TABLE technicians ADD COLUMN webhook_url TEXT`)
  }},
  { version: 4, up: (db) => {
    // 自提/自助下单：onsite=到店服务（默认），self=顾客扫码自助下单（自提）
    try {
      db.exec(`ALTER TABLE tickets ADD COLUMN fulfillment TEXT NOT NULL DEFAULT 'onsite'`)
    } catch (e) {
      if (!String(e.message).includes('duplicate column')) throw e
    }
  }},
  { version: 5, up: (db) => {
    try {
      db.exec(`ALTER TABLE technicians ADD COLUMN is_star INTEGER NOT NULL DEFAULT 0`)
    } catch (e) {
      if (!String(e.message).includes('duplicate column')) throw e
    }
  }},
  { version: 6, up: (db) => {
    // 过夜睡眠服务：顾客扫码下单时可勾选（附加固定服务费）
    try {
      db.exec(`ALTER TABLE tickets ADD COLUMN overnight INTEGER NOT NULL DEFAULT 0`)
    } catch (e) {
      if (!String(e.message).includes('duplicate column')) throw e
    }
  }},
  { version: 7, up: (db) => {
    // 点单收款：履约状态与收款解耦，paid_at 非空 = 已收款
    for (const col of [
      `ALTER TABLE product_orders ADD COLUMN payment_method TEXT`,
      `ALTER TABLE product_orders ADD COLUMN paid_at INTEGER`,
      `ALTER TABLE product_orders ADD COLUMN paid_by TEXT`,
    ]) {
      try { db.exec(col) } catch (e) {
        if (!String(e.message).includes('duplicate column')) throw e
      }
    }
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_product_orders_paid ON product_orders(shop_id, paid_at)`) } catch (_) {}
    // 交接班
    db.exec(`
      CREATE TABLE IF NOT EXISTS shifts (
        id          TEXT PRIMARY KEY,
        shop_id     TEXT NOT NULL REFERENCES shops(id),
        user_id     TEXT REFERENCES users(id),
        username    TEXT,
        opened_at   INTEGER NOT NULL,
        closed_at   INTEGER,
        status      TEXT NOT NULL DEFAULT 'open',
        cash_cents      INTEGER NOT NULL DEFAULT 0,
        wechat_cents    INTEGER NOT NULL DEFAULT 0,
        alipay_cents    INTEGER NOT NULL DEFAULT 0,
        balance_cents   INTEGER NOT NULL DEFAULT 0,
        card_cents      INTEGER NOT NULL DEFAULT 0,
        topup_cents     INTEGER NOT NULL DEFAULT 0,
        revenue_cents   INTEGER NOT NULL DEFAULT 0,
        ticket_count    INTEGER NOT NULL DEFAULT 0,
        product_count   INTEGER NOT NULL DEFAULT 0,
        actual_cash_cents INTEGER,
        diff_cents      INTEGER,
        notes           TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )
    `)
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_shifts_shop_status ON shifts(shop_id, status)`) } catch (_) {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_shifts_opened ON shifts(opened_at)`) } catch (_) {}
  }},
  { version: 8, up: (db) => {
    // 优惠券 / 预约 / 通知历史（Phase 3）
    db.exec(`
      CREATE TABLE IF NOT EXISTS coupons (
        id              TEXT PRIMARY KEY,
        shop_id         TEXT NOT NULL REFERENCES shops(id),
        code            TEXT NOT NULL,
        name            TEXT NOT NULL,
        type            TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
        value           INTEGER NOT NULL,               -- percent: 折扣百分比1-99; fixed: 立减分
        min_spend_cents INTEGER NOT NULL DEFAULT 0,
        max_uses        INTEGER,                        -- NULL = 不限
        used_count      INTEGER NOT NULL DEFAULT 0,
        starts_at       INTEGER,
        ends_at         INTEGER,
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE(shop_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_coupons_shop ON coupons(shop_id, active);

      CREATE TABLE IF NOT EXISTS appointments (
        id              TEXT PRIMARY KEY,
        shop_id         TEXT NOT NULL REFERENCES shops(id),
        customer_id     TEXT REFERENCES customers(id),
        technician_id   TEXT REFERENCES technicians(id),
        service_id      TEXT REFERENCES services(id),
        room_id         TEXT REFERENCES rooms(id),
        customer_name   TEXT,
        customer_phone  TEXT,
        notes           TEXT,
        scheduled_at    INTEGER NOT NULL,
        duration_min    INTEGER NOT NULL DEFAULT 60,
        status          TEXT NOT NULL DEFAULT 'pending', -- pending/confirmed/canceled/completed
        ticket_id       TEXT REFERENCES tickets(id),
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_appt_shop_status ON appointments(shop_id, status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_appt_scheduled ON appointments(scheduled_at);

      CREATE TABLE IF NOT EXISTS notify_history (
        id          TEXT PRIMARY KEY,
        shop_id     TEXT,
        event       TEXT NOT NULL,
        content     TEXT,
        channels    TEXT,   -- JSON array of {key, ok}
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notify_hist_shop ON notify_history(shop_id, created_at);
    `)
  }},
  { version: 9, up: (db) => {
    // 库存出入库流水（Phase 3）
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id          TEXT PRIMARY KEY,
        shop_id     TEXT NOT NULL REFERENCES shops(id),
        product_id  TEXT NOT NULL REFERENCES products(id),
        type        TEXT NOT NULL,        -- in | out | adjust
        qty         INTEGER NOT NULL,     -- 对库存的有符号增减
        stock_after INTEGER,
        ref_type    TEXT,                 -- order | cancel | manual
        ref_id      TEXT,
        notes       TEXT,
        created_by  TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_stock_mov_shop ON stock_movements(shop_id, created_at);
    `)
  }},
  { version: 10, up: (db) => {
    // 技师周排班（与 shifts 收银交接班无关）
    db.exec(`
      CREATE TABLE IF NOT EXISTS technician_schedules (
        id              TEXT PRIMARY KEY,
        shop_id         TEXT NOT NULL REFERENCES shops(id),
        technician_id   TEXT NOT NULL REFERENCES technicians(id),
        date            TEXT NOT NULL,              -- YYYY-MM-DD 本地日
        start_min       INTEGER NOT NULL,           -- 当日 0 点起分钟数
        end_min         INTEGER NOT NULL,
        shift_name      TEXT,
        status          TEXT NOT NULL DEFAULT 'scheduled', -- scheduled/off
        notes           TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE(shop_id, technician_id, date, start_min)
      );
      CREATE INDEX IF NOT EXISTS idx_tech_sched_week ON technician_schedules(shop_id, date);
      CREATE INDEX IF NOT EXISTS idx_tech_sched_tech ON technician_schedules(technician_id, date);
    `)
  }},
  { version: 11, up: (db) => {
    // 充卡提成 + 拉新归属
    for (const col of [
      `ALTER TABLE customers ADD COLUMN owner_user_id TEXT`,
      `ALTER TABLE customers ADD COLUMN owner_assigned_at INTEGER`,
      `ALTER TABLE customers ADD COLUMN owner_assigned_by TEXT`,
      `ALTER TABLE customers ADD COLUMN source TEXT`,
      `ALTER TABLE wallet_transactions ADD COLUMN commission_cents INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE wallet_transactions ADD COLUMN commission_user_id TEXT`,
    ]) {
      try { db.exec(col) } catch (e) {
        if (!String(e.message).includes('duplicate column')) throw e
      }
    }
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_wallet_shop_created ON wallet_transactions(shop_id, created_at)`) } catch (_) {}
    db.exec(`
      CREATE TABLE IF NOT EXISTS topup_commission_rules (
        id              TEXT PRIMARY KEY,
        shop_id         TEXT NOT NULL REFERENCES shops(id),
        name            TEXT,
        min_cents       INTEGER NOT NULL DEFAULT 0,
        max_cents       INTEGER,                       -- NULL = 无上限
        commission_type TEXT NOT NULL DEFAULT 'percent', -- percent: 万分比; fixed: 分
        commission_value INTEGER NOT NULL DEFAULT 0,
        active          INTEGER NOT NULL DEFAULT 1,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topup_comm_rules_shop ON topup_commission_rules(shop_id, active);
    `)
  }},
  { version: 12, up: (db) => {
    // 退款（反结账）+ 预约来源（批次3）
    db.exec(`
      CREATE TABLE IF NOT EXISTS refunds (
        id              TEXT PRIMARY KEY,
        shop_id         TEXT NOT NULL REFERENCES shops(id),
        type            TEXT NOT NULL,              -- ticket | topup
        ticket_id       TEXT REFERENCES tickets(id),
        wallet_txn_id   TEXT,                       -- type=topup 时指向原充值流水
        customer_id     TEXT REFERENCES customers(id),
        amount_cents    INTEGER NOT NULL,           -- 退款总额（分，正数）
        ticket_cents    INTEGER NOT NULL DEFAULT 0,
        order_cents     INTEGER NOT NULL DEFAULT 0,
        payment_method  TEXT,                       -- 原支付方式
        refund_method   TEXT,                       -- 实际退回方式（原路/现金/余额）
        reason          TEXT,
        commission_cents INTEGER NOT NULL DEFAULT 0, -- 冲销的提成（正数记录，报表侧冲减）
        created_by      TEXT,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_refunds_shop_created ON refunds(shop_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_ticket ON refunds(ticket_id) WHERE ticket_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_wallet ON refunds(wallet_txn_id) WHERE wallet_txn_id IS NOT NULL;
    `)
    for (const col of [
      `ALTER TABLE appointments ADD COLUMN created_by TEXT`,
      `ALTER TABLE appointments ADD COLUMN source TEXT`, // guest | staff
    ]) {
      try { db.exec(col) } catch (e) {
        if (!String(e.message).includes('duplicate column')) throw e
      }
    }
  }},
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
      INSERT INTO technicians(id, shop_id, number, name, level, bio, specialties, years, ai_score, avg_rating, review_count, hired_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const techs = [
      ['01', '张师傅', '高级', '从业8年，擅长足底穴位按摩，手法细腻有力。', '["足浴","足浴+按摩","深度足疗"]', 8, 4.8, 4.7, 23],
      ['02', '小王',   '中级', '年轻有活力，力度适中，善于沟通。', '["全身推拿","肩颈舒压"]', 3, 4.3, 4.2, 15],
      ['03', '小李',   '初级', '新人技师，认真负责，正在快速成长中。', '["足浴","采耳"]', 1, 3.9, 3.8, 8],
    ]
    techs.forEach(t => {
      insertTech.run(nanoid(10), shopId, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], now, now, now)
    })

    // 默认账号（老板登录后应改密码）
    const insertUser = db.prepare(`
      INSERT INTO users(id, shop_id, username, password_hash, role, display_name, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertUser.run(nanoid(10), shopId, 'admin', hashPassword('admin1234'), 'admin', '管理员', now, now)
    insertUser.run(nanoid(10), shopId, 'pos',    hashPassword('pos12345'),    'pos',    '收银台', now, now)
    insertUser.run(nanoid(10), shopId, 'cs',      hashPassword('cs123456'),     'cs',     '客服', now, now)

    // 食物用品示例（顾客扫码可点单）
    const insertProduct = db.prepare(`
      INSERT INTO products(id, shop_id, name, category, price_cents, stock, sort_order, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const products = [
      ['农夫山泉 550ml', '饮品', 300, null],
      ['可口可乐 330ml', '饮品', 400, null],
      ['红牛',         '饮品', 800, null],
      ['桶装泡面',       '食品', 800, null],
      ['卤蛋',         '食品', 300, null],
      ['一次性防滑袜',    '用品', 500, 50],
      ['抽纸包',        '用品', 200, null],
    ]
    products.forEach((p, i) => {
      insertProduct.run(nanoid(10), shopId, p[0], p[1], p[2], p[3], i, now, now)
    })

    db.prepare(`INSERT INTO meta(key, value) VALUES('seeded_at', ?)`).run(String(now))
  })()

  console.log('[db] 已 seed 默认数据（1 店、6 项目、10 房间、3 技师、3 账号、7 商品）')
}

// ── 老库补种（幂等）────────────────────────────────
// 已在运行的库不会走 seedIfEmpty，这里补齐新功能需要的基础数据。
function seedExtras(db) {
  const shop = db.prepare(`SELECT id FROM shops ORDER BY created_at LIMIT 1`).get()
  if (!shop) return
  const now = Date.now()

  db.transaction(() => {
    // 客服账号 cs / cs123456
    const cs = db.prepare(`SELECT id FROM users WHERE username='cs'`).get()
    if (!cs) {
      db.prepare(`
        INSERT INTO users(id, shop_id, username, password_hash, role, display_name, created_at, updated_at)
        VALUES(?, ?, ?, ?, 'cs', '客服', ?, ?)
      `).run(nanoid(10), shop.id, 'cs', hashPassword('cs123456'), now, now)
      console.log('[db] 已补种客服账号 cs / cs123456')
    }

    // 商品示例（表为空才种）
    const prodCount = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c
    if (prodCount === 0) {
      const insertProduct = db.prepare(`
        INSERT INTO products(id, shop_id, name, category, price_cents, stock, sort_order, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const products = [
        ['农夫山泉 550ml', '饮品', 300, null],
        ['可口可乐 330ml', '饮品', 400, null],
        ['红牛',         '饮品', 800, null],
        ['桶装泡面',       '食品', 800, null],
        ['卤蛋',         '食品', 300, null],
        ['一次性防滑袜',    '用品', 500, 50],
        ['抽纸包',        '用品', 200, null],
      ]
      products.forEach((p, i) => {
        insertProduct.run(nanoid(10), shop.id, p[0], p[1], p[2], p[3], i, now, now)
      })
      console.log('[db] 已补种 7 个示例商品')
    }
  })()
}
