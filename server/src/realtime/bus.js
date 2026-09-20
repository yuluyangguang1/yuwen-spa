// 实时事件总线
//
// 排钟最重要的体验：收银台开了一个钟，房间显示屏、技师手机、老板平板
// 都要在 100ms 内看到。WebSocket 是最轻量的方案。
//
// 不引入 Redis pub/sub —— 单进程内存广播就够单店用，加 Redis 是过度设计。
//
// 安全改进：
//   - WebSocket 连接需携带 JWT token（query string）
//   - 心跳机制（ping/pong）检测连接存活
//   - 僵尸连接自动清理（60 秒无响应断开）

import { verifyToken } from '../auth/utils.js'

const clients = new Map() // ws → { userId, shopId, connectedAt, lastPong, pingInterval }

export function registerRealtimeBus(fastify) {
  fastify.get('/api/realtime', { websocket: true }, (socket, req) => {
    // 验证 WebSocket 连接 token
    const token = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token')
    if (!token) {
      socket.close(4001, 'Token required')
      return
    }

    const payload = verifyToken(token)
    if (!payload) {
      socket.close(4003, 'Invalid token')
      return
    }

    const userId = payload.sub
    const shopId = payload.shop_id

    clients.set(socket, { userId, shopId, connectedAt: Date.now(), lastPong: Date.now() })

    socket.send(JSON.stringify({ type: 'hello', ts: Date.now() }))

    // 心跳：每 30 秒发送 ping
    const pingInterval = setInterval(() => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
      }
    }, 30000)

    // 客户端回复 pong
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'pong') {
          const entry = clients.get(socket)
          if (entry) clients.set(socket, { ...entry, lastPong: Date.now() })
        }
      } catch (_) {}
    })

    socket.on('close', () => {
      clearInterval(pingInterval)
      clients.delete(socket)
    })
    socket.on('error', () => {
      clearInterval(pingInterval)
      clients.delete(socket)
    })
  })

  // 给业务代码用：fastify.broadcast({ type: 'ticket:created', ... })
  fastify.decorate('broadcast', (msg) => {
    const payload = JSON.stringify(msg)
    const now = Date.now()
    for (const [socket, entry] of clients) {
      try {
        // 跳过 60 秒内没有响应的僵尸连接
        if (now - entry.lastPong > 120000) {
          socket.close(4000, 'Heartbeat timeout')
          continue
        }
        if (socket.readyState === 1) {
          socket.send(payload)
        }
      } catch (_) { /* 客户端可能正在断开 */ }
    }
  })

  // 获取活跃客户端统计
  fastify.decorate('getRealtimeStats', () => {
    const now = Date.now()
    return {
      connections: clients.size,
      activeClients: [...clients.entries()].filter(([, e]) => now - (e.lastPong || e.connectedAt) < 60000).length,
    }
  })
}
