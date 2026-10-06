// WebSocket Hook：模块级单例连接 + 订阅分发
//
// 多组件共用一条连接（POS 首页此前会开 3 条），订阅者计数管理生命周期。
// 自动重连，事件回调，JWT 鉴权，心跳保活。
// 未登录不连接；token 失效不盲目重试，等重新登录。

import { useEffect, useRef, useState } from 'react'

type EventHandler = (data: any) => void

interface Sub {
  handlersRef: { current: Record<string, EventHandler> }
  notify: (connected: boolean) => void
}

let ws: WebSocket | null = null
let connected = false
let retryCount = 0
const MAX_RETRY = 10
let retryTimer: ReturnType<typeof setTimeout> | undefined
let rejectedToken: string | null = null
// 等待登录时注册的事件监听清理器（事件驱动，替代原 2s localStorage 轮询）
let tokenWaitCleanup: (() => void) | null = null
const subs = new Set<Sub>()

function notifyAll() {
  for (const s of subs) s.notify(connected)
}

function clearTimers() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
}

function dispatch(type: string, data: any) {
  for (const s of subs) {
    const h = s.handlersRef.current[type]
    if (!h) continue
    try {
      h(data)
    } catch (e) {
      console.error('[realtime] handler error', type, e)
    }
  }
}

function stopTokenWait() {
  if (tokenWaitCleanup) {
    tokenWaitCleanup()
    tokenWaitCleanup = null
  }
}

function waitForToken() {
  const t = localStorage.getItem('yuwen_token')
  if (t && t !== rejectedToken) {
    connect()
    return
  }
  if (tokenWaitCleanup) return
  const onLogin = () => {
    const nt = localStorage.getItem('yuwen_token')
    if (nt && nt !== rejectedToken) {
      stopTokenWait()
      retryCount = 0
      connect()
    }
  }
  window.addEventListener('yuwen:login', onLogin)
  tokenWaitCleanup = () => window.removeEventListener('yuwen:login', onLogin)
}

function teardown() {
  clearTimers()
  stopTokenWait()
  rejectedToken = null
  retryCount = 0
  connected = false
  if (ws) {
    try { ws.close() } catch { /* ignore */ }
    ws = null
  }
  notifyAll()
}

function connect() {
  if (subs.size === 0) return
  clearTimers()

  const token = localStorage.getItem('yuwen_token')
  if (!token || token === rejectedToken) {
    connected = false
    notifyAll()
    waitForToken()
    return
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${proto}//${location.host}/api/realtime?token=${encodeURIComponent(token)}`)
  ws = socket

  socket.onopen = () => {
    if (ws !== socket || subs.size === 0) {
      socket.close()
      return
    }
    connected = true
    retryCount = 0
    notifyAll()
  }

  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }))
        return
      }
      dispatch(msg.type, msg.data || msg)
    } catch (err) {
      console.warn('[realtime] message parse error', err)
    }
  }

  socket.onclose = (e) => {
    if (ws === socket) ws = null
    connected = false
    notifyAll()
    if (subs.size === 0) return

    if (e.code === 4001 || e.code === 4003) {
      rejectedToken = token
      waitForToken()
      return
    }

    if (retryCount >= MAX_RETRY) {
      console.warn('[realtime] 已达最大重试次数，停止重连')
      return
    }
    const delay = Math.min(3000 * 2 ** retryCount, 30000)
    retryTimer = setTimeout(connect, delay)
    retryCount++
  }

  socket.onerror = () => {
    try { socket.close() } catch { /* ignore */ }
  }
}

// 登出时主动断开，避免旧 token 连接残留
if (typeof window !== 'undefined') {
  window.addEventListener('yuwen:logout', () => {
    teardown()
    if (subs.size > 0) waitForToken()
  })
}

export function useRealtime(handlers: Record<string, EventHandler>) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [isConnected, setIsConnected] = useState(connected)

  useEffect(() => {
    const sub: Sub = {
      handlersRef,
      notify: (c) => setIsConnected(c),
    }
    subs.add(sub)
    setIsConnected(connected)
    if (subs.size === 1) connect()

    return () => {
      subs.delete(sub)
      if (subs.size === 0) teardown()
    }
  }, [])

  return { connected: isConnected }
}
