// WebSocket Hook：连接实时事件总线
//
// 自动重连，事件回调。

import { useEffect, useRef, useCallback } from 'react'

type EventHandler = (data: any) => void

export function useRealtime(handlers: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let alive = true
    let retryTimer: ReturnType<typeof setTimeout>

    function connect() {
      if (!alive) return

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${location.host}/api/realtime`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          const handler = handlersRef.current[msg.type]
          if (handler) handler(msg.data || msg)
        } catch (_) {}
      }

      ws.onclose = () => {
        wsRef.current = null
        if (alive) retryTimer = setTimeout(connect, 3000) // 3 秒后重连
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      alive = false
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [])
}
