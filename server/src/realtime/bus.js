// 实时事件总线
//
// 排钟最重要的体验：收银台开了一个钟，房间显示屏、技师手机、老板平板
// 都要在 100ms 内看到。WebSocket 是最轻量的方案。
//
// 不引入 Redis pub/sub —— 单进程内存广播就够单店用，加 Redis 是过度设计。

const clients = new Set()

export function registerRealtimeBus(fastify) {
  fastify.get('/api/realtime', { websocket: true }, (socket, req) => {
    clients.add(socket)
    socket.send(JSON.stringify({ type: 'hello', ts: Date.now() }))

    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })

  // 给业务代码用：fastify.broadcast({ type: 'ticket:created', ... })
  fastify.decorate('broadcast', (msg) => {
    const payload = JSON.stringify(msg)
    for (const c of clients) {
      try {
        if (c.readyState === 1) c.send(payload)
      } catch (_) { /* 客户端可能正在断开 */ }
    }
  })
}
