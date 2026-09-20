// WebSocket Hook：连接实时事件总线
//
// 自动重连，事件回调，JWT 鉴权，心跳保活。

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
    let retryTimer: ReturnType<typeof setTimeout>

    function connect() {
      if (!alive) return

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const token = localStorage.getItem('yuwen_token')
      const ws = new WebSocket(`${proto}//${location.host}/api/realtime?token=${token || ''}`)
      wsRef.current = ws

      ws.onopen = () => {
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

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        if (alive) {
          // 指数退避重连：3s, 6s, 12s, 24s, 最大 30s
          const delay = Math.min(3000 * Math.pow(2, retryCount), 30000)
          retryTimer = setTimeout(connect, delay)
          setRetryCount((c) => c + 1)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      alive = false
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [])

  return { connected }
}
