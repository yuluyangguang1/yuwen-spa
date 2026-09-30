// 登录页面
// 足韵暗色风格，简洁表单

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { LogIn, Eye, EyeOff } from 'lucide-react'
import { Skeleton } from '@/components/LoadingSkeleton'
import { BrandTitle } from '@/components/BrandTitle'

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  // 登录页品牌名走免登录接口（门店名称可在系统设置修改）

  // 已登录则跳转（useEffect，避免渲染期间副作用）
  useEffect(() => {
    if (!user) return
    const redirect = user.role === 'admin' ? '/admin' : user.role === 'pos' ? '/pos' : user.role === 'cs' ? '/cs' : '/tech'
    navigate(redirect, { replace: true })
  }, [user, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      // login 成功后 user 更新，下次渲染会自动跳转
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-bg min-h-[100dvh] flex items-center justify-center bg-[#0a0a09] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <BrandTitle size="hero" shimmer publicPage stack className="mb-2" />
          <div className="flex items-center justify-center gap-2.5 mb-2.5" aria-hidden="true">
            <span className="h-px w-10 bg-tan/30" />
            <span className="text-tan/50 text-[8px] leading-none">◆</span>
            <span className="h-px w-10 bg-tan/30" />
          </div>
          <p className="text-white/30 text-sm tracking-[0.35em] pl-[0.35em]">门店管理系统</p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-xs text-white/40 mb-1.5">用户名</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50"
              placeholder="输入用户名"
              autoFocus
              autoComplete="username"
              aria-describedby={error ? 'login-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs text-white/40 mb-1.5">密码</label>
            <div className="relative">
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-11 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50"
                placeholder="输入密码"
                autoComplete="current-password"
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={error ? true : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-white/40 hover:text-white/70 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p id="login-error" role="alert" className="text-red-400 text-xs text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="btn-shine w-full flex items-center justify-center gap-2 bg-tan hover:bg-[#e6c493] disabled:opacity-30 disabled:cursor-not-allowed text-[#170d02] rounded-lg py-2.5 text-sm font-semibold transition-colors shadow-[0_2px_12px_rgb(217_179_8/0.18)]"
          >
            {loading ? (
              <Skeleton className="h-5 w-5 rounded-full" />
            ) : (
              <LogIn size={16} />
            )}
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {/* 提示 */}
        <p className="text-center text-white/30 text-[11px] mt-4">
          默认账号 admin / admin1234
        </p>
      </div>
    </div>
  )
}
