// WebSocket Hook：连接实时事件总线
//
// 自动重连，事件回调，JWT 鉴权，心跳保活。
// 未登录不连接；token 失效不盲目重试，等重新登录。

import { useEffect, useRef, useState } from 'react'

type EventHandler = (data: any) => void

export function useRealtime(handlers: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [connected, setConnected] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let alive = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let rejectedToken: string | null = null

    function clearTimers() {
      if (retryTimer) clearTimeout(retryTimer)
      if (pollTimer) clearInterval(pollTimer)
      retryTimer = undefined
      pollTimer = undefined
    }

    function waitForToken() {
      // 已有未被拒绝的新 token 则立即连；否则每 2s 轮询
      const t = localStorage.getItem('yuwen_token')
      if (t && t !== rejectedToken) {
        connect()
        return
      }
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = setInterval(() => {
        if (!alive) return
        const nt = localStorage.getItem('yuwen_token')
        if (nt && nt !== rejectedToken) {
          clearInterval(pollTimer!)
          pollTimer = undefined
          setRetryCount(0)
          connect()
        }
      }, 2000)
    }

    function connect() {
      if (!alive) return
      clearTimers()

      const token = localStorage.getItem('yuwen_token')
      if (!token || token === rejectedToken) {
        setConnected(false)
        waitForToken()
        return
      }

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${location.host}/api/realtime?token=${encodeURIComponent(token)}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!alive) { ws.close(); return }
        setConnected(true)
        setRetryCount(0)
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          // 响应 ping
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
            return
          }
          const handler = handlersRef.current[msg.type]
          if (handler) handler(msg.data || msg)
        } catch (_) {}
      }

      ws.onclose = (e) => {
        setConnected(false)
        if (wsRef.current === ws) wsRef.current = null
        if (!alive) return

        // 4001 Token required / 4003 Invalid token：记录被拒 token，等重新登录
        if (e.code === 4001 || e.code === 4003) {
          rejectedToken = token
          waitForToken()
          return
        }

        // 指数退避重连：3s, 6s, 12s, 24s, 最大 30s
        const delay = Math.min(3000 * 2 ** retryCount, 30000)
        retryTimer = setTimeout(connect, delay)
        setRetryCount((c) => c + 1)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      alive = false
      clearTimers()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  return { connected }
}
