// 足韵 yuwen-spa 前端入口
//
// 优化要点：
//   1. React.ErrorBoundary：捕获渲染异常，防止白屏
//   2. 全局 Toast 通知系统（Web Audio + 页面内提示）
//   3. Query 缓存持久化：PersistQueryClientProvider + localStorage 持久化
//   4. 401 优雅跳转：SPA 路由导航而非全量刷新

import React, { type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core'
import { AuthProvider } from './lib/auth'
import { useRealtime } from './lib/realtime'
import { warmupAudio } from './lib/notify'
import App from './App'
import './index.css'

// ─── localStorage 持久化器 ──────────────────
const localStoragePersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      localStorage.setItem('yuwen-query-cache', JSON.stringify(client))
    } catch (_) {}
  },
  restoreClient: async () => {
    try {
      const raw = localStorage.getItem('yuwen-query-cache')
      return raw ? (JSON.parse(raw) as PersistedClient) : undefined
    } catch (_) {
      return undefined
    }
  },
  removeClient: async () => {
    try {
      localStorage.removeItem('yuwen-query-cache')
    } catch (_) {}
  },
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: true,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
      gcTime: 30 * 60 * 1000,
    },
  },
})

// ─── 401 路由重定向组件 ──────────────────────
// 检测 sessionStorage 中的重定向路径，通过路由器导航到登录页
function SessionRestore() {
  const navigate = useNavigate()

  React.useEffect(() => {
    const redirect = sessionStorage.getItem('yuwen_redirect')
    if (redirect) {
      sessionStorage.removeItem('yuwen_redirect')
      navigate('/login', { replace: true })
    }
  }, [navigate])

  return null
}

// ─── 全局错误边界 ──────────────────────────────────────────
// 捕获渲染时的异常，显示友好提示而不是白屏
class ErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a09] text-white/60">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-display text-tan">出了点问题</h2>
            <p className="text-sm">{this.state.error?.message || '未知错误'}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.href = '/login'
              }}
              className="px-4 py-2 bg-tan/20 text-tan rounded-lg text-sm hover:bg-tan/30 transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── 全局实时事件监听 + 通知唤醒 ──────────────────────────
function GlobalRealtimeListener() {
  useRealtime({
    'ticket:created': () => {
      warmupAudio()
    },
  })
  return null
}

// ─── 启动 ──────────────────────────────────────────────
if (localStorage.getItem('yuwen_token')) {
  warmupAudio()
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: localStoragePersister,
          maxAge: 5 * 60 * 1000,
          buster: 'yuwen-v1',
        }}
      >
          <BrowserRouter>
            <SessionRestore />
            <AuthProvider>
              <GlobalRealtimeListener />
              <App />
            </AuthProvider>
          </BrowserRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
