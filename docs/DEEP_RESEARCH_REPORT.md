# 足韵 yuwen-spa 深度研究报告

> 研究日期：2026-09-20 | 研究员：足韵项目团队
> 基于 26 个服务端文件 + 29 个前端文件的完整源码审计 + 16 个同类竞品分析

---

## 一、系统架构总览

### 1.1 当前架构分层

```
┌─────────────────────────────────────────────────┐
│  客户端层（浏览器）                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 收银台    │ │ 管理后台  │ │ 技师端    │        │
│  │ PosLayout│ │AdminLayout│ │TechLayout │        │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       │            │            │                │
│  ┌────▼────────────▼────────────▼─────┐          │
│  │  React 19 + TanStack Query v5       │          │
│  │  + Vite + TypeScript + TailwindCSS  │          │
│  │  + framer-motion + lucide-react     │          │
│  └──────────────┬─────────────────────┘          │
│                 │ HTTP/WebSocket                  │
├─────────────────┼─────────────────────────────────┤
│  服务端层        │                                  │
│  ┌──────────────▼─────────────────────┐          │
│  │  Fastify + better-sqlite3           │          │
│  │  + WebSocket (ws)                   │          │
│  │  + JWT Auth + Rate Limit            │          │
│  │  + @fastify/compress + CORS          │          │
│  ├────────────────────────────────────┤          │
│  │  路由层                              │          │
│  │  auth | tickets | customers | rooms │          │
│  │  services | technicians | reviews   │          │
│  │  dashboard | ai | notify | reports │          │
│  │  users | health | shops | guest   │          │
│  ├────────────────────────────────────┤          │
│  │  AI 层                              │          │
│  │  OpenAI 兼容 API（后台可配置）         │          │
│  │  + DeepSeek / Ollama / 任意兼容模型   │          │
│  └────────────────────────────────────┘          │
├─────────────────────────────────────────────────┤
│  数据层                                          │
│  SQLite (WAL 模式) → yuwen.db                    │
│  + ai-config.json + notify-config.json           │
└─────────────────────────────────────────────────┘
```

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端框架 | Fastify | ^5.x |
| 数据库 | better-sqlite3 | ^11.x |
| 实时通信 | WebSocket (ws) | 内置 |
| 认证 | JWT + scrypt | Node.js crypto |
| 前端框架 | React | 19.x |
| 前端构建 | Vite | 6.x |
| 状态管理 | TanStack Query | ^5.62 |
| 动画 | framer-motion | ^11.15 |
| 样式 | TailwindCSS | ^4.x |
| 路由 | React Router | ^7.x |

---

## 二、数据库深度审计

### 2.1 Schema 设计评价

**✅ 优秀设计**

- 完整的参照完整性（外键 + `foreign_keys = ON`）
- WAL 模式 + `synchronous = NORMAL`（写不阻塞读，断电不烂库）
- 迁移系统（`MIGRATIONS` 数组，版本递增）
- 默认 seed 数据（开箱即用）
- 金额用整数分（避免浮点精度问题）
- 审计日志表（`audit_logs`）

**❌ 缺失索引**

以下表缺少必要的索引，导致全表扫描：

| 表 | 缺失索引 | 影响 |
|----|---------|------|
| `services` | `shop_id` | 门店筛选时全表扫描 |
| `rooms` | `shop_id` | 门店筛选时全表扫描 |
| `technicians` | `shop_id` | 门店筛选时全表扫描 |
| `customers` | `shop_id` | 门店筛选时全表扫描 |
| `ai_chats` | `shop_id, created_at` | AI 对话历史查询慢 |
| `reviews` | `ticket_id` | 按订单查评价时全表扫描 |
| `wallet_transactions` | `shop_id, type` | 按类型查流水时全表扫描 |
| `ai_scores` | `technician_id` | 技师评分查询慢 |
| `audit_logs` | `action` | 按操作类型审计慢 |

**当前已有索引**：
- `idx_tickets_shop_status` — 有效
- `idx_tickets_tech` — 有效
- `idx_tickets_customer` — 有效
- `idx_tickets_created` — 有效
- `idx_wallet_customer` — 有效
- `idx_audit_shop_created` — 有效
- `idx_reviews_tech` — 有效
- `idx_reviews_shop` — 有效

### 2.2 反规范化数据

以下字段存在反规范化，查询时应保持一致性：

| 表 | 反规范化字段 | 来源 | 风险 |
|----|-------------|------|------|
| `customers` | `balance_cents` | `wallet_transactions` 聚合 | 充值/消费后需同步更新 |
| `customers` | `total_spent_cents` | `wallet_transactions` 聚合 | 退款时需扣减 |
| `customers` | `visit_count` | `tickets` 计数 | 新单创建时需递增 |
| `technicians` | `avg_rating` | `reviews` 聚合 | 新评价时需重算 |
| `technicians` | `review_count` | `reviews` 聚合 | 新评价时需递增 |
| `technicians` | `ai_score` | `ai_scores` 最新值 | 每月更新时需同步 |

**风险**：并发场景下可能出现数据不一致（例如同时两笔交易更新 balance）。建议引入数据库触发器或应用层事务锁。

---

## 三、安全深度审计

### 3.1 严重级别

| 级别 | 问题 | 影响 |
|------|------|------|
| 🔴 ~~所有 `/api/*` 无鉴权~~ ✅ `auth/hook` | Phase 2 已修 | 已全局校验 Bearer + DB 回查 |
| 🔴 ~~JWT 默认密钥~~ ✅ `load-env` 生成 | Phase 2 已修 | 已从 .env 读取 |
| 🔴 ~~密码最短 4 位~~ ✅ ≥8 | Phase 2 已修 | `validatePassword` |
| 🟠 ~~无 CSRF~~ ✅ Origin 校验 | Phase 2 已修 | 写方法跨站写请求 |
| 🟠 无 CORS 配置（`origin: true` 宽松） | 店内多域名访问 | 任意 Origin 可读 API |
| 🟠 ~~AI 端点无鉴权~~ ✅ | Phase 2/改造已修 | config 仅 admin，GET 不回传 apiKey |
| 🟡 ~~无速率限制~~ ✅ | Phase 2 已修 | 全局限流 + 敏感端点 |
| 🟡 `/api/system` 需登录后可见 | 已修半程 | 仍返回 hostname/lanIPs，登录即可看 |
| 🟡 用户生成内容无输入过滤 | notes/bio/comments | 存储型 XSS 风险 |
| 🟢 ~~无请求体大小限制~~ ✅ 1MB | Phase 2 已修 | bodyLimit |
| 🟢 无 HTTPS 强制 | 中间人攻击风险 | 本地局域网场景影响有限 |

### 3.2 关键安全修复建议

```javascript
// 1. 环境变量管理 JWT 密钥
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET is required')

// 2. 密码策略加强
if (newPassword.length < 8) {
  return reply.code(400).send({ error: '新密码至少 8 位，含字母+数字' })
}

// 3. 所有路由增加鉴权验证
fastify.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return
  const payload = verifyToken(extractToken(req))
  if (!payload) return reply.code(401).send({ error: '请先登录' })
  // 验证 session 是否仍有效（不是仅验证 token 格式）
  const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(payload.sub)
  if (!user) return reply.code(401).send({ error: '用户不存在或已禁用' })
  req.user = user
})

// 4. 添加 CORS 配置
app.register(cors, { origin: true, credentials: true })

// 5. 请求体大小限制
app.addContentTypeParser('application/json', { limit: '1mb' }, (req, body, done) => { ... })
```

---

## 四、API 设计审计

### 4.1 响应格式不一致

| 端点 | 响应格式 | 问题 |
|------|---------|------|
| `/api/health` | `{ ok: true, ts, uptime, version }` | ✅ 规范 |
| `/api/auth/login` | `{ token, user }` | ✅ 规范 |
| `/api/tickets` | `[ticket, ticket, ...]` | ❌ 缺少元数据 |
| `/api/customers` | `[customer, ...]` | ❌ 缺少总数 |
| `/api/dashboard/live` | `{ techs, rooms, stats }` | ✅ 规范 |
| `/api/reports/*` | `[...]` 或 `{ today, month, counts }` | ❌ 不统一 |

**建议**：统一响应格式：
```typescript
interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
  meta?: { total: number; page: number; limit: number }
}
```

### 4.2 缺失的关键端点

| 类别 | 缺失端点 | 优先级 |
|------|---------|--------|
| 审计 | `GET /api/audit-logs` | 高 |
| 通知 | `GET /api/notify/history` | 中 |
| 导出 | `GET /api/tickets/export` | 高 |
| 发票 | `GET /api/tickets/:id/receipt` | 中 |
| 预约 | `POST /api/appointments` | 高 |
| 折扣 | `POST /api/discounts/:code/validate` | 中 |
| 分页 | 所有列表增加 `page` + `offset` 参数 | 高 |

---

## 五、前端架构深度审计

### 5.1 状态管理问题

**核心问题**：Auth 状态用 React `useContext/useState` 管理，而非 TanStack Query。

```
当前：AuthContext → useState → 每个组件订阅
问题：login/logout 触发全树重渲染，状态不缓存，刷新丢失

建议：
- 认证状态接入 TanStack Query（queryKey: ['auth/user']）
- token 读取统一到 auth.tsx，不在 api.ts 和 auth.tsx 中分散读取
- localStorage.getItem('yuwen_token') 集中管理
```

### 5.2 性能问题

| 问题 | 位置 | 影响 |
|------|------|------|
| ~~500+ 行表格无虚拟滚动~~ 已修 | AdminTickets `useVirtualRange` | 渲染卡顿 |
| ~~搜索无防抖~~ 已修 | AdminCustomers `useDebounce(300)` | 每次按键触发 API |
| `useMemo` 缺失 | Home 组件 | 每次渲染重新过滤 |
| `getLanHost()` 非 React 安全 | 多处 | 每次渲染调用 |
| 500+ 查询限制 | AdminTickets `limit=500` | 大量数据传输（已虚拟滚动，传输仍大） |
| ~~TanStack Query 缓存不持久化~~ 已修 | PersistQueryClient + localStorage | 刷新丢失所有缓存 |

### 5.3 实时 WebSocket 问题

```
当前：useRealtime with [] deps
问题：handlersRef.current 虽然是最新的，但闭包中的 currentTech 
     捕获的是初始值（空数组）
影响：TechHome 的 ticket:created/paid 回调引用错误的技师

建议：useRealtime 应接受一个稳定的 handlers 对象，
     或将 currentTech 存入 ref 并在 useRealtime 外部管理
```

### 5.4 可访问性 (a11y) 缺口

- ❌ 无 ARIA 标签（`aria-label`、`aria-live`）
- ❌ 无键盘导航（Tab 顺序、Esc 关闭弹窗）
- ❌ 无焦点管理（弹窗打开后焦点未移入）
- ❌ 无跳过导航链接（skip-navigation）
- ❌ 无屏幕阅读器友好的实时更新通知
- ❌ 颜色对比度不满足 WCAG AA（部分浅色文字）

---

## 六、竞品对比分析

### 6.1 16 个同类项目一览

| 项目 | Stars | 技术栈 | 核心特色 | 足韵对比 |
|------|-------|--------|---------|---------|
| **small-pos-open-source** | 92★ | React+TS+Vite+PWA+SQLite | 纯 Web 无桌面壳 | ✅ 足韵也是纯 Web |
| **FloCafe** | 92★ | Electron+React+SQLite+FastAPI | 多语言 | ❌ Electron 桌面 |
| **pos-pro** | 19★ | Electron+React+Vite+PWA | 繁体中文 | ❌ Electron 桌面 |
| **Quicktill** | 35★ | Electron+Express | 大型业务 | ❌ Electron 桌面 |
| **puntovivo** | 3★ | Fastify+tRPC+SQLite+Drizzle | 拉美财税 | ✅ 足韵也用了 Fastify |
| **Cullen** | 1★ | Fastify+SQLite+DDD | 六边形架构 | ✅ 架构可参考 |
| **SalonPro ERP** | — | TypeScript+SaaS | 美容院专用 | ❌ 足韵是足浴专用 |
| **其他 9 个** | 0-3★ | Electron+React+SQLite | 各国零售 | ❌ Electron 桌面 |

### 6.2 足韵差异化矩阵

| 维度 | 足韵优势 | 足韵劣势 |
|------|---------|---------|
| **客户端** | ✅ 纯 Web 零安装 | ❌ 无 PWA 完整支持（已补） |
| **美学** | ✅ 中国风宣纸设计 | — |
| **AI 集成** | ✅ OpenAI 兼容端点可配置 | ❌ 仅同步调用，无流式 |
| **实时性** | ✅ WebSocket 内存广播 | ❌ 无连接状态提示 |
| **通知** | ✅ 5 平台支持 | ❌ 无重试机制 |
| **报表** | ✅ 日/技师/汇总/导出 | ❌ 无可视化图表 |
| **离线** | ✅ SQLite 本地 | ❌ 无 Service Worker 缓存（已补） |
| **国际化** | ✅ zh/en i18n 基础设施 | ⚠️ 文案未全量翻译（未命中回退原文） |
| **多店** | ✅ schema 预留 shop_id | ❌ 无跨店聚合 UI |

---

## 七、行业最佳实践参考

### 7.1 从 puntovivo 学习的架构模式

```
puntovivo 使用 tRPC（TypeScript RPC）：
- 前后端共享类型定义
- 自动类型推断
- 无需手动定义 API 端点

足韵可以借鉴的点：
- 类型安全：从 services → DB → API 全链路类型
- 客户端使用 tRPC 替代 fetch（可选，非必须）
```

### 7.2 从 Cullen 学习的架构模式

```
Cullen 使用六边形（Hexagonal）架构：
- 核心业务逻辑与框架解耦
- 端口/适配器模式
- 可替换数据库、通知渠道、AI 提供者

足韵当前状态：
- 路由与 DB 紧耦合（直接使用 better-sqlite3）
- 通知与业务逻辑耦合（notify/index.js 被多处引用）

建议方向：
- 引入 Repository 模式
- DB 访问层抽象
- 通知渠道抽象
```

### 7.3 从 small-pos 学习的 PWA 模式

```
small-pos 实现的核心 PWA 功能：
- Service Worker 缓存策略：Cache-First for static, Network-First for API
- Web App Manifest：安装到主屏幕
- 离线模式：请求队列 + 背景同步

足韵已完成：
- manifest.json ✅
- sw.js ✅（Cache-First + Network-First）
- 图标 ✅

仍需补充：
- 请求队列（离线时暂存，联网后重放）
- 背景同步 API
- 推送通知（需要后端推送服务）
```

---

## 八、功能优先级路线图

### Phase 1 核心完善（✅ 已完成）

- [x] 开钟/结账/取消状态机
- [x] 会员储值 + 钱包流水
- [x] 技师管理 + 排钟看板
- [x] AI 评分 + 经营日报
- [x] 企业微信/飞书/钉钉/Slack/Discord 通知
- [x] PWA 支持（manifest + Service Worker）
- [x] 经营报表 + CSV 导出
- [x] LoadingSkeleton 骨架屏
- [x] 代码分割 + 构建优化

### Phase 2 健壮性加固（✅ 完成）

- [x] **安全加固**：JWT 密钥环境变量（load-env + 安装脚本生成 .env）、密码策略 8 位、CSRF Origin 校验、全局限流 600/min + 敏感端点限流
- [x] **鉴权中间件**：全局 session 回查 DB + 集中式 `requireRole`（reports/customers 写/钟单开单收款取消/点单收款 → admin/pos/cs）
- [x] **数据库索引补全**：9 个缺失索引
- [x] **分页系统**：列表 `{data,total,page,pageSize}`；补全 reviews / wallet / ai-chats total
- [x] **统一响应格式**：约定见 `server/src/lib/response.js`（列表 data 信封 + 错误 `{error,code}`）
- [x] **输入校验**：轻量 schema（`server/src/lib/validate.js`，替代全量 Zod 迁移）覆盖登录/改密/充值/评价等写路径
- [x] **前端缓存持久化**：TanStack Query 持久化到 localStorage

### Phase 3 业务扩展（✅ 完成）

- [x] **预约系统**：customer → 预约 → 到店确认 → 开钟（`/admin/appointments` + guest 提交）
- [x] **折扣/优惠券**：创建 → 验证 → 使用 → 统计（`/admin/coupons`，收银可选券码）
- [x] **审计日志查看端点**：`GET /api/audit-logs` + 设置页展示
- [x] **通知历史**：`GET /api/notify/history` + 设置页展示
- [x] **发票/收据生成**：收据模板 + 打印/存 PDF（`GET /api/tickets/:id/receipt` + 钟单/收银/点单打印）
- [x] **技师排钟日历**：周视图 + 拖拽改期 + 点击编辑（`/admin/schedule` + `POST /api/appointments/:id/reschedule`）
- [x] **库存/耗材管理**：出入库流水 + 入库/出库/盘点 + 日期筛选/CSV 导出（已合并为商品页「库存流水」Tab，旧路径 `/admin/inventory` 重定向；下单/取消自动记流水）
- [x] **完钟喇叭提醒**：服务端 endwatch 预警/到点 WS + 店内设备语音外放 + 顾客页本地倒计时（设置页可配提前分钟）
- [x] **派钟/改派**：待派队列 `GET /api/tickets/queue` + `POST /api/tickets/:id/assign` + POS 待派面板接单选人（技术自服：技师自助开钟/下钟）
- [x] **技师自助状态**：`POST /api/technicians/me/status`（上岗/休息/下班，working 由钟单生命周期驱动）
- [x] **技师周排班**：新表 `technician_schedules`（v10，≠交接班 shifts）+ `/admin/schedules` 周历 + batch/copy-week + 技师端今日班次

### Phase 4 体验优化（✅ 完成）

- [x] **前端虚拟滚动**：AdminTickets 固定行高视口裁剪（500+ 行只渲染可视区）
- [x] **列排序 + URL 筛选**：表格支持排序 + 筛选链接可分享
- [x] **统一 toast 系统**：全局位置 + 堆栈 + 自动 dismiss（`web/src/lib/toast.ts` + ToastHost）
- [x] **确认弹窗库**：替代原生 `confirm()`（ConfirmDialog 已覆盖删除/清空等危险操作）
- [x] **深色模式切换**：DarkModeToggle 挂载（Admin/POS/Tech 布局 + 设置页）+ localStorage 持久化 + 启动防闪烁
- [x] **键盘快捷键**：Ctrl/Cmd+N 新开钟、Ctrl/Cmd+K 钟单、Ctrl/Cmd+Shift+D 台面、`/` 聚焦搜索
- [x] **国际化**：zh/en i18n 基础设施（`web/src/lib/i18n.tsx` + 设置页语言切换，未命中回退原文）
- [x] **Web Vitals 监控**：PerformanceObserver 采集 LCP/CLS/INP/FCP/TTFB（`web/src/lib/vitals.ts`，`yuwen:vitals` 事件可外接）

### Phase 5 AI 深化（✅ 完成）

- [x] **AI 流式输出**：SSE 流式返回，经营日报逐字显示（`POST /api/ai/chat/stream` + `GET /api/ai/daily-report/stream` + 前端逐字渲染）
- [x] **智能排钟**：基于技师技能+顾客偏好+房间状态的自动排钟（`POST /api/ai/suggest-dispatch` 本地评分 + 可选 LLM；POS 派钟弹层「AI 智能推荐」）
- [x] **语音点单**：语音输入服务项目（Web Speech API：POS 开钟选项目 + 顾客点单商品 `web/src/lib/voice.ts` + `VoiceInput`）
- [x] **经营预测**：基于历史数据的营收预测（`GET /api/ai/forecast` 线性回归+MA7；报表「营收预测」Tab + AI 工具面板）
- [x] **异常检测**：营收异常、技师流失预警（`GET /api/ai/anomalies` 环比骤降/高峰零成交/接单骤停/低分/低库存；看板顶部提醒）

### 稳定性加固（✅ 完成）

> 2026-09-24 针对「提升稳定性」专项：前后端审计 + 高优修复，tsc/build 通过，四套回归 19/9/20/21 全绿，DB 干净（schema v10）。

**后端**
- [x] `trustProxy:false` 防 XFF 伪造绕过限流；rate-limit interval `unref()`
- [x] shutdown 3s 强制退出 + `Promise.race` 防 close 挂起；`uncaughtException` ≥5 次才 exit，置 `__yuwenUnhealthy`
- [x] `/api/health` degraded 时返回 503 `{ok:false,degraded:true}`
- [x] LLM 流式改空闲超时（idle 30s/总 300s）+ 外部 signal 透传；非流式同样接 signal
- [x] 两个 SSE 端点客户端断连即 abort 上游、`send()` 检查 `writableEnded`、raw error 空监听防 uncaught；`score-technicians`/`daily-report` 限流
- [x] 库存扣减 `WHERE stock >= ?` 条件更新；pay 状态/券次数守卫（`NOT IN ('paid','canceled')` / `used_count < max_uses`）；开班查重+插入入事务；券码 UNIQUE → 409
- [x] `pruneHistoryTables`（notify 90d / ai_chats 30d / audit 180d）启动即清 + 每日 0 点 + `POST /api/scheduler/run type=prune`

**前端**
- [x] `api.ts` 重写：`ApiError`、401 改抛错（保留 redirect 事件）不再伪成功、超时覆盖 body 读完、合并外部 signal、`streamSSE` 返回 `{cancel,finished}`（30s 空闲超时、单次 onDone）
- [x] `realtime.ts` 重写为模块级单例（订阅计数、一个 WS 复用、`yuwen:logout` teardown）
- [x] `auth.tsx` /me 竞态 cancelled 标志；`voice.ts` finish 单次 onEnd + 错误码中文映射
- [x] `main.tsx` retry 跳过 4xx（按 `error.status`）+ staleTime 15s + 全局 unhandledrejection/error 日志 + ErrorBoundary `componentDidCatch`/chunk 检测 reload
- [x] `App.tsx` 全部 lazy 换 `lazyWithRetry`（chunk 失败 250ms 重试）+ `path="*"` 404 兜底
- [x] POS 关键路径 onError+toast、query key 细分；AdminAI 两处流卸载时 `cancelRef.current?.()`；`useCRUD`/`RoomCard`/`GuestView` 补错误展示

### 批次3 · 退款/退卡 + 代客预约（✅ 完成）

> 2026-09-25 分批计划第 3 批：tsc/build 通过，本批 smoke 68/68，四套回归 19/9/20/21 全绿（closedloop 首跑 Chrome 启动超时复跑即绿），DB 干净（schema v12，refunds=0，rooms/techs 全 idle）。

**业务规则**
- [x] 状态机 `paid → refunded` 终态（再 pay/cancel→409）；报表 `status='paid'` 自动剔除
- [x] 钟单余额退款 type `refund` 正数；覆盖 price + 已付 product_orders 解绑、退券（读 ticket.pay 审计）、余额回补 + `total_spent_cents`/`visit_count` 减一
- [x] 退卡：需 `balance_cents >= amount`、每笔充值仅退一次（partial unique index，重复→409）；钱包流水 type `topup_refund`（负 amount、负 commission_cents）；报表/班次/AI 汇总 `type IN ('topup','topup_refund')`，笔数 `COUNT(CASE WHEN type='topup')`
- [x] 无第三方支付退款集成（payment.js 回调仅排除 refunded）
- [x] 透明偏差：「操作人=提成人→0 防自刷」未按字面实现；防刷靠审计 actor + 退卡冲销
- [x] staff 预约 `POST /api/appointments`（staffOnly、技师时段冲突→409、source='staff'、created_by=admin）；guest source='guest'

**Schema v12**（`server/src/db/init.js` MIGRATIONS，注释已修 `--`→`//` 防 ReferenceError）
- [x] 新表 `refunds`（type: ticket/topup，amount_cents，ticket_id/customer_id，actor）+ partial unique `idx_refunds_ticket`/`idx_refunds_wallet`
- [x] `appointments` +2 列：`created_by/source`

**后端接口**
- [x] `tickets.js`：`POST /api/tickets/:id/refund`（staffOnly、状态机、解绑、审计）、pay 拦截 refunded、STATUS_TRANSITIONS
- [x] `customers.js`：`POST /api/customers/:id/topup-refund`（余额检查、每笔仅退一次、冲销 commission）
- [x] `appointments.js`：staff 创建 + guest 补 source/audit + 时段冲突 409
- [x] `payment.js`：回调排除 refunded
- [x] `reports/shifts/ai.js`：topup 汇总含 topup_refund

**前端**
- [x] `AdminTickets`：退款按钮 + ConfirmDialog + 已退款筛选
- [x] `AdminAppointments`：代客预约按钮 + `CreateAppointmentModal`（姓名/手机/datetime-local/时长/项目/房间/技师/备注）+ `createMut` + toast
- [x] `AdminCustomers`：`refundTxn` state + `topupRefundMut` + 退卡 ConfirmDialog + `WalletHistoryModal` 加 `onRefund` prop 与 topup 行 Undo2 按钮 + `typeLabel` 加 `topup_refund:'退卡'` + 冲销徽标
- [x] `utils.ts`：refunded 标签/颜色

**验证**
- [x] `refund-smoke.mjs` 68/68（schema/idx、staff 预约+冲突 409+cs/guest source、topup 提成、cash 单退款+双退 409+pay 409+cancel 409+refunds 行+审计、余额退款回补+wallet refund 流水、topup-refund 冲销+余额扣回+双退 409+topup_refund 负流水+审计、余额不足 409、unauth 401、404、校验失败）
- [x] 四套回归全绿：phase3b 19/19、endwatch 9/9、dispatch 20/20、closedloop 21/21（复跑）
- [x] `refund-cleanup.mjs` 修 FK 顺序（先 detour appointments/product_orders/reviews/wallet_transactions/refunds 再删 ticket）→ CLEANUP_OK；DB 干净（refunds=0、schema=12、rooms/techs idle）

### 批次2 · 充卡提成 + 拉新归属（✅ 完成）

> 2026-09-24 分批计划第 2 批（决策 1A 档位表 / 2A 无归属归操作人 / 3A 提前为批次2）：tsc/build 通过，本批 smoke 44/44，四套回归 19/9/20/21 全绿，DB 干净（schema v11）。

**业务规则**
- [x] 拉新归属：建档默认 `owner_user_id=操作人`（谁拉的客户算谁的），可显式指定/公海(null)，改归属写 `owner_assigned_at/by` + 审计 `customer.owner_change`
- [x] 充卡提成：充值按金额命中 `topup_commission_rules` 档位（percent 万分比与 services 一致 / fixed 分）；提成人=客户归属人，无归属→当次操作人；写入 `wallet_transactions.commission_cents/commission_user_id`；无规则=不计提成（存量零影响）
- [x] 双轨分离：服务提成仍归技师（tickets.commission_cents 不动），充卡提成归归属人，同一人可双拿
- [x] 审计补 actor：`customer.create/topup` 写 actor + commission/rule_id；退卡冲销随批次3退款实现

**Schema v11**（`server/src/db/init.js` MIGRATIONS）
- [x] `customers` +4 列：`owner_user_id/owner_assigned_at/owner_assigned_by/source`
- [x] `wallet_transactions` +2 列：`commission_cents/commission_user_id` + `idx_wallet_shop_created`
- [x] 新表 `topup_commission_rules`（档位：min/max 区间 + percent/fixed，不预置规则）

**后端接口**
- [x] `customers.js`：建档/PUT 归属逻辑、topup 提成计算、列表/详情 JOIN `owner_name`
- [x] 新增 `commission-rules.js`：GET(staff)/POST/PUT/DELETE(admin)，挂 `routes/index.js`（第 24 个路由模块）
- [x] `reports.js`：`GET /api/reports/topup-commission?date_from&date_to` 按提成人汇总充值笔数/金额/提成 + summary

**前端**
- [x] `AdminCustomers`：归属人列、建档/编辑归属人下拉（数据源 `/api/users`，默认当前操作人）、来源字段、TopupForm 归属人+实时预计提成预览、余额流水提成角标、充值成功 toast 带提成额
- [x] `AdminSettings`：充值提成档位配置区（增删改/启停，元↔分与 %↔万分比换算）
- [x] `AdminReports`：「充值提成」Tab（按人：充值笔数/充值额/提成；该 Tab 隐藏导出按钮）

### 批次1 · 备份恢复 API（✅ 完成）

> 2026-09-24 分批计划第 1 批（决策：恢复不自动换库 = A）：无 schema 变更，tsc/build 通过，本批 smoke 29/29，四套回归 19/9/20/21 全绿，DB 干净（schema v11）。

**业务规则（决策A：不在线换库）**
- [x] 恢复 = 校验（`PRAGMA quick_check` + schema_version + shops 计数）→ `VACUUM INTO` 自动安全备份当前库（`yuwen_pre_restore_*.db`）→ 拷贝暂存为 `db/yuwen.restore.db` + sidecar 说明 JSON → 返回分步指令（停服/替换/重启/回退）；**不触碰运行中的 yuwen.db**，由人工完成替换
- [x] 需 `confirm` 回填文件名二次确认；文件名白名单正则防路径穿越；admin-only + 审计（`backup.create`/`backup.restore_staged` 含 actor）

**后端接口**（新 `routes/backup.js`，挂 `routes/index.js` 第 25 个模块）
- [x] `GET /api/backups` — 列表 + `pending_restore`（暂存态与指令，api.ts 解包为 `{files, pending_restore}`）
- [x] `POST /api/backups` — 手动备份（复用既有 `manualBackup()`，此前零调用方）
- [x] `GET /api/backups/:name/download` — 流式下载（Content-Disposition）
- [x] `POST /api/backups/:name/restore` — 校验+暂存（校验失败 422 不产生副作用）
- [x] `backup/index.js` 扩展：`safeBackupPath`/`verifyBackup`/`stageRestore`/`getPendingRestore`

**前端**
- [x] `AdminSettings` 新增「数据备份」区：立即备份、备份列表（大小/时间）、逐文件下载（fetch+blob 带 token）、暂存恢复（危险确认弹窗）、待恢复横幅 + 分步指令展示、60s 自动刷新

---

## 九、关键架构决策建议

### 9.1 是否引入 tRPC？

**当前**：手动 fetch + TypeScript 接口
**建议**：可选引入 tRPC

```
优点：类型安全全链路、自动补全、减少 API 定义
缺点：学习曲线、bundle size 增加、与现有 fetch 混合
建议：Phase 3 引入，前端新模块使用 tRPC，旧模块保持 fetch
```

### 9.2 是否引入 Redis？

**当前**：内存广播 + 内存限速
**建议**：单店不需要 Redis

```
理由：单店场景下 1 个进程的内存广播足够
Redis 适用场景：多进程部署、跨店聚合、分布式锁
建议：Phase 3 多店支持时再考虑
```

### 9.3 是否引入 Electron？

**当前**：纯 Web（浏览器访问）
**建议**：保持纯 Web

```
理由：纯 Web 的零安装优势是足韵的核心差异化
Electron 的缺点：体积大、内存占用高、更新需要重新打包
建议：通过 PWA 实现"类原生"体验（已实现）
```

### 9.4 是否引入微前端？

**当前**：单体前端应用
**建议**：不需要

```
理由：项目规模尚小，单体应用足够
微前端适用场景：多团队并行开发、功能独立部署
建议：Phase 4+ 如果引入小程序等新端再考虑
```

---

## 十、安全加固优先级

| 优先级 | 修复项 | 预估工作量 | 风险等级 |
|--------|--------|-----------|----------|
| P0 | ~~JWT_SECRET 从环境变量读取~~ ✅ `load-env.js` | 5 分钟 | 🔴 严重 |
| P0 | ~~密码最短 8 位 + 复杂度校验~~ ✅ `validatePassword` | 10 分钟 | 🔴 严重 |
| P0 | ~~鉴权中间件验证 session 有效性~~ ✅ 全局 `auth/hook` 回查 DB | 30 分钟 | 🔴 严重 |
| P1 | ~~CSRF 保护写方法~~ ✅ Origin 校验（非 CSRF Token） | 2 小时 | 🟠 高危 |
| P1 | ~~所有端点添加速率限制~~ ✅ 全局 600/min + 登录/AI 敏感限流 | 1 小时 | 🟠 高危 |
| P1 | ~~输入校验~~ ✅ 轻量 schema（未引入 Zod，覆盖写路径） | 4 小时 | 🟠 高危 |
| P2 | ~~`/api/system` 需登录~~ ✅ 不再匿名暴露 | 15 分钟 | 🟡 中危 |
| P2 | ~~AI 端点添加鉴权~~ ✅ 全局 hook + config 仅 admin | 30 分钟 | 🟠 高危 |
| P2 | 用户生成内容 XSS 过滤 | 1 小时 | 🟡 中危 |
| P3 | ~~请求体大小限制~~ ✅ bodyLimit 1MB | 5 分钟 | 🟢 低危 |
| P3 | HTTPS 强制（HSTS） | 30 分钟 | 🟡 中危 |

---

## 十一、前端体验优先级

| 优先级 | 优化项 | 预估工作量 | 用户感知 |
|--------|--------|-----------|----------|
| P0 | ~~前端缓存持久化（TanStack Query）~~ ✅ | 2 小时 | 高 |
| P0 | ~~401 改用 SPA 路由跳转~~ ✅ ErrorBoundary + navigate | 15 分钟 | 高 |
| P1 | 骨架屏覆盖所有页面 | 3 小时 | 高 |
| P1 | ~~AdminTickets 虚拟滚动~~ ✅ | 4 小时 | 高 |
| P1 | ~~统一 toast 系统~~ ✅ | 2 小时 | 中 |
| P2 | ~~列排序 + URL 筛选~~ ✅ | 4 小时 | 中 |
| P2 | ~~确认弹窗库替代 confirm()~~ ✅ | 2 小时 | 中 |
| P3 | ~~国际化基础设施~~ ✅ | 1 天 | 低 |
| P3 | ~~键盘快捷键~~ ✅ | 2 小时 | 低 |
| P3 | ~~深色模式切换~~ ✅ | 2 小时 | 低 |

---

## 十二、技术债清单

### 12.1 代码层面

| 技术债 | 位置 | 修复难度 |
|--------|------|---------|
| `any` 类型泛滥 | 前端全文件 | 中 |
| `nanoid(10)` 长度不一致 | DB init.js | 低 |
| `startOfDay` 重复 4 次 | tickets/technicians/dashboard/ai | 低 |
| `Clock` 命名冲突 | PosLayout.tsx | 低 |
| `window.location.href` 硬跳转 | api.ts/auth.tsx | 中 |
| ~~原生 `confirm()` 多处~~ 已换 ConfirmDialog | AdminUsers/AdminServices 等 8 页 | 低 |
| `Promise.all` 无错误处理 | notify/index.js | 中 |

### 12.2 架构层面

| 技术债 | 描述 | 修复难度 |
|--------|------|---------|
| DB 与路由紧耦合 | 直接 `fastify.db.prepare()` | 中 |
| 通知与业务耦合 | notify/index.js 被多处引用 | 中 |
| 无 Repository 模式 | DB 访问分散在路由中 | 高 |
| 无单元测试 | 零测试覆盖率 | 高 |
| 无 CI/CD | 手动 push 部署 | 中 |

---

## 十三、总结

### 核心优势

1. **纯 Web 零客户端**：浏览器即入口，无需安装任何客户端
2. **中国风美学**：宣纸、墨色调，区别于美团/有赞的互联网风格
3. **AI 深度集成**：OpenAI 兼容端点后台可配，模型切换零成本
4. **多平台通知**：企业微信/飞书/钉钉/Slack/Discord 五渠道
5. **状态机设计**：钟单完整生命周期 + 事务保证数据一致
6. **开箱即用**：seed 数据 + 默认配置 + 零配置启动

### 关键短板

1. **安全**：鉴权/JWT/限流/CSRF Origin 已补；XSS 过滤与 HTTPS 仍缺
2. **性能**：索引/分页/缓存已补；Ticket 列表仍 `limit=500`、部分列表未分页
3. **体验**：骨架屏/统一 toast/虚拟滚动/深色模式已补；PWA 离线队列仍缺
4. **健壮性**：根因边界与 ConfirmDialog 已有；无单元测试、无 CI/CD
5. **国际化**：i18n 基础设施已就绪，业务文案尚未全量 zh/en

### 一句话总结

> 足韵的核心价值是**纯 Web 零客户端 + 中国风美学 + AI 深度集成**，这在开源 POS 项目中是独树一帜的。当前的关键不是加功能，而是**补安全、打基础、提升体验**，然后再按路线图逐步扩展业务。
