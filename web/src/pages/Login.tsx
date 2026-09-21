// 登录页面
// 足韵暗色风格，简洁表单

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { LogIn } from 'lucide-react'
import { Skeleton } from '@/components/LoadingSkeleton'

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 已登录则跳转
  if (user) {
    const redirect = user.role === 'admin' ? '/admin' : user.role === 'pos' ? '/pos' : '/tech'
    navigate(redirect, { replace: true })
    return null
  }

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
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0a0a09] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl text-tan mb-1">足韵</h1>
          <p className="text-white/30 text-sm">门店管理系统</p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
          <div>
            <label className="block text-xs text-white/40 mb-1.5">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50"
              placeholder="输入用户名"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-xs text-white/40 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50"
              placeholder="输入密码"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 bg-tan/20 hover:bg-tan/30 disabled:opacity-30 disabled:cursor-not-allowed text-tan border border-tan/30 rounded-lg py-2.5 text-sm font-medium transition-colors"
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
        <p className="text-center text-white/20 text-[11px] mt-4">
          默认账号 admin / admin
        </p>
      </div>
    </div>
  )
}
