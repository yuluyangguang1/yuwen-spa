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
│  │  Hermes Gateway (本地 8642)         │          │
│  │  + DeepSeek / 任意 OpenAI 兼容模型   │          │
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
| 🔴 **严重** | 所有 `/api/*` 端点无鉴权验证 | `req.user` 假设存在但不验证，JWT 可伪造 |
| 🔴 **严重** | JWT 密钥 `yuwen-spa-default-secret-change-me` | 默认密钥可直接伪造任意用户 token |
| 🔴 **严重** | 密码最短仅 4 位 | 暴力破解成本极低 |
| 🟠 **高危** | 无 CSRF 保护 | POST/PUT/DELETE 可被跨站请求伪造 |
| 🟠 **高危** | 无 CORS 配置 | 任意来源可调用 API |
| 🟠 **高危** | AI 端点无鉴权 | `/api/ai/config POST` 可任意修改 API Key |
| 🟠 **高危** | AI 配置通过 `process.cwd()` 读写 | 依赖 CWD，可能写到错误路径 |
| 🟡 **中危** | 无速率限制（除登录外） | `/api/ai/chat` 可被滥用消耗 LLM 额度 |
| 🟡 **中危** | `/api/system` 暴露系统信息 | hostname、Node.js 版本、CPU 数等 |
| 🟡 **中危** | 用户生成内容无输入过滤 | notes/bio/comments 存在存储型 XSS |
| 🟢 **低危** | 无请求体大小限制 | 可能造成 DoS |
| 🟢 **低危** | 无 HTTPS 强制 | 中间人攻击风险 |

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
| 500+ 行表格无虚拟滚动 | AdminTickets | 渲染卡顿 |
| 搜索无防抖 | AdminCustomers | 每次按键触发 API |
| `useMemo` 缺失 | Home 组件 | 每次渲染重新过滤 |
| `getLanHost()` 非 React 安全 | 多处 | 每次渲染调用 |
| 500+ 查询限制 | AdminTickets `limit=500` | 大量数据传输 |
| TanStack Query 缓存不持久化 | 全局 | 刷新丢失所有缓存 |

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
| **AI 集成** | ✅ Hermes Gateway 统一管理 | ❌ 仅同步调用，无流式 |
| **实时性** | ✅ WebSocket 内存广播 | ❌ 无连接状态提示 |
| **通知** | ✅ 5 平台支持 | ❌ 无重试机制 |
| **报表** | ✅ 日/技师/汇总/导出 | ❌ 无可视化图表 |
| **离线** | ✅ SQLite 本地 | ❌ 无 Service Worker 缓存（已补） |
| **国际化** | — | ❌ 全部硬编码中文 |
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

### Phase 2 健壮性加固（🔜 进行中）

- [ ] **安全加固**：JWT 密钥环境变量、密码策略 8 位、CSRF、速率限制全端点
- [ ] **鉴权中间件**：验证 session 有效性 + 角色权限（admin/pos/tech）
- [ ] **数据库索引补全**：9 个缺失索引
- [ ] **分页系统**：所有列表增加 page/offset + 总数返回
- [ ] **统一响应格式**：ApiResponse<T> 标准结构
- [ ] **输入校验**：Zod schema 验证所有 req.body/req.query
- [ ] **前端缓存持久化**：TanStack Query 持久化到 localStorage

### Phase 3 业务扩展（🔜 规划中）

- [ ] **预约系统**：customer → 预约 → 到店确认 → 开钟
- [ ] **折扣/优惠券**：创建 → 验证 → 使用 → 统计
- [ ] **审计日志查看端点**：`GET /api/audit-logs` + 前端展示
- [ ] **通知历史**：`GET /api/notify/history`
- [ ] **发票/收据生成**：PDF 模板 + 打印支持
- [ ] **技师排钟日历**：周视图 + 拖拽排钟
- [ ] **库存/耗材管理**：商品 CRUD + 出入库记录

### Phase 4 体验优化（🔜 规划中）

- [ ] **前端虚拟滚动**：AdminTickets 500+ 行流畅渲染
- [ ] **列排序 + URL 筛选**：表格支持排序 + 筛选链接可分享
- [ ] **统一 toast 系统**：全局位置 + 堆栈 + 自动 dismiss
- [ ] **确认弹窗库**：替代原生 `confirm()`
- [ ] **国际化**：zh/en/i18n 基础设施
- [ ] **深色模式切换**：CSS 变量 + 系统偏好
- [ ] **键盘快捷键**：全局快捷键（Ctrl+N 新建单等）
- [ ] **Web Vitals 监控**：RUM 性能数据收集

### Phase 5 AI 深化（🔜 规划中）

- [ ] **AI 流式输出**：SSE 流式返回，经营日报逐字显示
- [ ] **智能排钟**：基于技师技能+顾客偏好+房间状态的自动排钟
- [ ] **语音点单**：语音输入服务项目
- [ ] **经营预测**：基于历史数据的营收预测
- [ ] **异常检测**：营收异常、技师流失预警

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
| P0 | JWT_SECRET 从环境变量读取 | 5 分钟 | 🔴 严重 |
| P0 | 密码最短 8 位 + 复杂度校验 | 10 分钟 | 🔴 严重 |
| P0 | 鉴权中间件验证 session 有效性 | 30 分钟 | 🔴 严重 |
| P1 | CSRF Token 保护所有 POST/PUT/DELETE | 2 小时 | 🟠 高危 |
| P1 | 所有端点添加速率限制 | 1 小时 | 🟠 高危 |
| P1 | 输入校验（Zod）所有端点 | 4 小时 | 🟠 高危 |
| P2 | `/api/system` 脱敏敏感信息 | 15 分钟 | 🟡 中危 |
| P2 | AI 端点添加鉴权 | 30 分钟 | 🟠 高危 |
| P2 | 用户生成内容 XSS 过滤 | 1 小时 | 🟡 中危 |
| P3 | 请求体大小限制 | 5 分钟 | 🟢 低危 |
| P3 | HTTPS 强制（HSTS） | 30 分钟 | 🟡 中危 |

---

## 十一、前端体验优先级

| 优先级 | 优化项 | 预估工作量 | 用户感知 |
|--------|--------|-----------|----------|
| P0 | 前端缓存持久化（TanStack Query） | 2 小时 | 高 |
| P0 | 401 改用 SPA 路由跳转 | 15 分钟 | 高 |
| P1 | 骨架屏覆盖所有页面 | 3 小时 | 高 |
| P1 | AdminTickets 虚拟滚动 | 4 小时 | 高 |
| P1 | 统一 toast 系统 | 2 小时 | 中 |
| P2 | 列排序 + URL 筛选 | 4 小时 | 中 |
| P2 | 确认弹窗库替代 confirm() | 2 小时 | 中 |
| P3 | 国际化基础设施 | 1 天 | 低 |
| P3 | 键盘快捷键 | 2 小时 | 低 |
| P3 | 深色模式切换 | 2 小时 | 低 |

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
| 原生 `confirm()` 多处 | AdminUsers/AdminServices | 低 |
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
3. **AI 深度集成**：通过 Hermes Gateway 统一管理，模型切换零成本
4. **多平台通知**：企业微信/飞书/钉钉/Slack/Discord 五渠道
5. **状态机设计**：钟单完整生命周期 + 事务保证数据一致
6. **开箱即用**：seed 数据 + 默认配置 + 零配置启动

### 关键短板

1. **安全**：所有端点无鉴权验证，JWT 可伪造（最严重）
2. **性能**：缺少索引、无分页、无缓存，全表扫描风险
3. **体验**：无骨架屏、无统一 toast、无虚拟滚动、无 PWA 完整离线
4. **健壮性**：无单元测试、无错误边界覆盖、原生 confirm()
5. **国际化**：全部硬编码中文，无法服务海外客户

### 一句话总结

> 足韵的核心价值是**纯 Web 零客户端 + 中国风美学 + AI 深度集成**，这在开源 POS 项目中是独树一帜的。当前的关键不是加功能，而是**补安全、打基础、提升体验**，然后再按路线图逐步扩展业务。
