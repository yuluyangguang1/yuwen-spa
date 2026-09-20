// 足韵 yuwen-spa 前端入口
//
// 优化要点：
//   1. React.ErrorBoundary：捕获渲染异常，防止白屏
//   2. 全局 Toast 通知系统（Web Audio + 页面内提示）
//   3. StrictMode 保持开发期双渲染检测

import React, { type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './lib/auth'
import { useRealtime } from './lib/realtime'
import { warmupAudio } from './lib/notify'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: true,
      // 失败重试 2 次，避免网络抖动导致白屏
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    },
  },
})

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
                window.location.reload()
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
      // 新派钟：声音 + 震动提醒
      warmupAudio()
      // 可以在此扩展 toast 通知
    },
  })
  return null
}

// ─── 启动 ──────────────────────────────────────────────
// 登录后预加载音频上下文（移动端需要用户交互后才能播放声音）
if (localStorage.getItem('yuwen_token')) {
  warmupAudio()
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <GlobalRealtimeListener />
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
