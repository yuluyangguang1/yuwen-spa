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
import { I18nProvider } from './lib/i18n'
import { useRealtime } from './lib/realtime'
import { warmupAudio, notifyNewTicket, notifyEndWarn, notifyEnd } from './lib/notify'
import { useAuth } from './lib/auth'
import { toast } from './lib/toast'
import { ToastHost } from './components/ToastHost'
import { useGlobalHotkeys } from './lib/hotkeys'
import { initWebVitals } from './lib/vitals'
import './lib/theme'
import App from './App'
import './index.css'

// ─── localStorage 持久化器 ──────────────────
// 写盘去抖：轮询会让 queryCache 频繁变化，避免每次变更都同步 JSON.stringify 整个缓存
let persistTimer: number | undefined
const localStoragePersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      persistTimer = undefined
      try {
        localStorage.setItem('yuwen-query-cache', JSON.stringify(client))
      } catch (_) {}
    }, 1000)
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

// 只持久化低频、静态的字典类数据：轮询数据（tickets/live/guest…）和大列表
// （customers/users 含 PII）不写入 localStorage，减小体积、加快冷启动
const PERSIST_PREFIXES = new Set([
  'services', 'rooms', 'technicians', 'products', 'shops', 'coupons',
  'categories', 'settings', 'commission', 'schedules', 'shop', 'guest-shop',
])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error: any) => {
        // 4xx 业务错误不重试（避免 401/409 反复打接口）
        if (error?.status >= 400 && error?.status < 500) return false
        return failureCount < 2
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
      gcTime: 30 * 60 * 1000,
    },
  },
})

// ─── 全局未处理异常日志（便于线上排查）─────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
})
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.error || e.message)
})

// ─── 导航引用（供 ErrorBoundary 使用）─────────────
let navigateFn: ((path: string, opts?: { replace?: boolean }) => void) | null = null

// ─── 导航引用设置器 ──────────────────────
// 将 useNavigate 注入到模块级 navigateFn，供 ErrorBoundary 使用
function NavigateRef() {
  const navigate = useNavigate()
  React.useEffect(() => { navigateFn = navigate }, [navigate])
  return null
}

// ─── 401 事件监听组件 ──────────────────────
// 监听 api.ts 派发的 yuwen:401 自定义事件，通过路由器导航到登录页
function On401Listener() {
  const navigate = useNavigate()

  React.useEffect(() => {
    const handler = () => {
      const redirect = sessionStorage.getItem('yuwen_redirect') || '/login'
      navigate(redirect, { replace: true })
    }
    window.addEventListener('yuwen:401', handler)
    return () => window.removeEventListener('yuwen:401', handler)
  }, [navigate])

  return null
}

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
function isChunkError(error: any): boolean {
  const m = `${error?.name || ''} ${error?.message || ''}`
  return /ChunkLoadError|Failed to fetch dynamically imported|Importing a module script failed|dynamically imported module|Loading chunk/i.test(m)
}

class ErrorBoundary extends React.Component<{ children: ReactNode }> {
  state: { hasError: boolean; error: Error | null }

  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleRecover = () => {
    const err = this.state.error
    // 发版后旧 hash chunk 404：SPA 跳转会卡在同一错误页，必须硬刷新
    if (isChunkError(err)) {
      window.location.reload()
      return
    }
    this.setState({ hasError: false, error: null })
    if (navigateFn) {
      navigateFn('/login', { replace: true })
    } else {
      window.location.href = '/login'
    }
  }

  render() {
    if (this.state.hasError) {
      const chunk = isChunkError(this.state.error)
      return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-[#0a0a09] text-white/60">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-display text-tan">{chunk ? '页面需要更新' : '出了点问题'}</h2>
            <p className="text-sm">{this.state.error?.message || '未知错误'}</p>
            <button
              onClick={this.handleRecover}
              className="px-4 py-2 bg-tan/20 text-tan rounded-lg text-sm hover:bg-tan/30 transition-colors"
            >
              {chunk ? '刷新页面' : '重新加载'}
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
  const { user } = useAuth()

  // 技师端只关心自己的钟；收银/管理端全店提醒
  const mineOnly = (data: any) => {
    if (user?.role !== 'tech') return true
    if (!user?.technician_id) return false
    return data?.technician_id === user.technician_id
  }

  const endSpeech = (data: any, stage: number) => {
    const tech = data?.technician_number
      ? `${data.technician_number}号${data.technician_name || ''}`
      : (data?.technician_name || '技师')
    const place = [
      data?.room_number ? `${data.room_number}号房` : '',
      data?.service_name || '服务',
    ].filter(Boolean).join('')
    if (stage === 0) return `${tech}，${place}到点了`
    return `${tech}，${place}还有${stage}分钟`
  }

  useRealtime({
    'ticket:created': () => {
      warmupAudio()
      notifyNewTicket()
    },
    'product_order:created': () => {
      warmupAudio()
      notifyNewTicket()
    },
    'ticket:ending': (data: any) => {
      if (!mineOnly(data)) return
      warmupAudio()
      const stage = Number(data?.stage) || 0
      if (stage <= 0) return
      const speech = data?.test ? `还有${stage}分钟测试提醒` : endSpeech(data, stage)
      notifyEndWarn(stage, speech)
      toast.info(speech, 6000)
    },
    'ticket:end': (data: any) => {
      if (!mineOnly(data)) return
      warmupAudio()
      const speech = data?.test ? '到点测试提醒' : endSpeech(data, 0)
      notifyEnd(speech)
      toast.info(speech, 6000)
    },
  })

  return null
}

function GlobalChrome() {
  useGlobalHotkeys()
  return <ToastHost />
}

// ─── 启动 ──────────────────────────────────────────────
if (localStorage.getItem('yuwen_token')) {
  warmupAudio()
}
initWebVitals()

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: localStoragePersister,
          maxAge: 5 * 60 * 1000,
          buster: 'yuwen-v2',
          dehydrateOptions: {
            shouldDehydrateQuery: (query) =>
              query.state.status === 'success' && PERSIST_PREFIXES.has(String(query.queryKey[0])),
          },
        }}
      >
        <BrowserRouter>
          <NavigateRef />
          <SessionRestore />
          <On401Listener />
          <AuthProvider>
            <I18nProvider>
              <GlobalRealtimeListener />
              <GlobalChrome />
              <App />
            </I18nProvider>
          </AuthProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
