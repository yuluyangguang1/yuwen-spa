# 足韵 yuwen-spa

> 一台主机，全店通用。专为线下足浴/足疗门店设计的本地部署 SaaS。

## 它是什么

一台不断电的小主机跑后端 + 数据库，店内所有设备（收银台、老板平板、技师手机、顾客手机）打开浏览器就能用。不依赖云服务，断网照样开钟、结账、查账。

## 它解决什么

线下足浴店的"全场景"日常：

- **收银台**：开钟、派钟、结账、出小票
- **排钟看板**：实时同步到所有屏幕，谁忙谁闲一目了然
- **会员系统**：储值卡、计次卡、折扣卡
- **技师管理**：考勤、提成、当日业绩
- **顾客查询**：扫码看历史消费、储值余额、续杯
- **老板看板**：日营业、月报表、跨店汇总（可选）

## 设计原则

1. **本地优先**：单店一台主机就够，断网不影响
2. **零客户端**：浏览器就是入口，不装 App、不开发小程序
3. **触屏友好**：收银台用平板/触屏一体机也顺手
4. **不打扰老板**：默认极简，复杂功能 cmd+k 呼出
5. **中国风**：保持余韵、宣纸、墨色调，区别于美团/有赞那种互联网风

## 架构

```
        主机（mini PC，不断电）
        Node.js + Fastify + SQLite
        监听 0.0.0.0:8080
              │
              ├── Hermes Gateway (127.0.0.1:8642)
              │    └── AI 对话 / 技师评分 / 经营日报
              │
       局域网 WiFi（同 WiFi 即可访问）
              │
   ┌──────────┼──────────┬───────────┐
   收银台      老板平板    技师手机     顾客手机
  Chrome     Safari    浏览器      扫码访问
```

## 技术栈

**后端**
- Node.js 20+
- Fastify（轻量 HTTP 框架）
- better-sqlite3（同步 SQLite，单文件 DB）
- WebSocket（实时同步排钟变动）

**前端**
- Vite + React 19 + TypeScript
- shadcn/ui + Tailwind v4
- TanStack Query / Table
- Zustand（状态）
- Framer Motion（动画）

**部署形态**
- 复刻 OpenClaw Portable 思路：双击启动器 → 自检 → 启动后端 → 浏览器自动打开
- 跨平台支持 Win / Mac / Linux

## 项目结构

```
yuwen-spa/
├── server/          # 后端 + DB + 静态文件托管
│   ├── src/         # 源码（Fastify 路由、业务模块）
│   ├── db/          # SQLite 文件 + 备份
│   └── public/      # 前端构建产物（npm run build 后产生）
├── web/             # 前端源码（Vite + React）
├── installers/      # 启动器
│   ├── start.bat    # Windows
│   ├── start.command  # macOS
│   └── start.sh     # Linux
└── docs/            # 文档
```

## 开发模式

```bash
# 后端（端口 8080）
cd server && npm run dev

# 前端（端口 5173，自动代理到后端）
cd web && npm run dev
```

## 生产模式

```bash
# 一键打包：前端构建产物拷贝到 server/public，统一由后端托管
npm run build

# 首次部署：安装并配置 Hermes Agent（只需一次）
bash installers/setup-hermes.sh

# 启动（双击 installers/ 里的对应脚本）
```

## 首次部署流程

1. 在客户主机上解压足韵包
2. 运行 `bash installers/setup-hermes.sh`（macOS/Linux）或双击 `setup-hermes.bat`（Windows）
   - 自动安装 Hermes Agent（如果尚未安装）
   - 引导填写 AI API Key（推荐 DeepSeek，便宜好用）
   - 启动 Hermes Gateway（端口 8642）
   - 配置足韵 AI 连接地址
3. 运行 `start.command`（macOS）/ `start.bat`（Windows）/ `start.sh`（Linux）
   - 检查并启动 Hermes Gateway
   - 启动足韵后端（端口 8080）
   - 自动打开浏览器
4. 店内设备同 WiFi 访问主机 IP + 端口号

> **AI 模型管理**：打开 Hermes Web UI (http://localhost:8642) 可切换模型、查看用量统计。
> 足韵只管调用，不关心底层是哪个模型。
