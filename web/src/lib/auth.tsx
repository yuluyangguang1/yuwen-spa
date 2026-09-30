// AuthContext：管理登录状态 + token 持久化

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api } from '../lib/api'

interface User {
  id: string
  username: string
  role: 'admin' | 'pos' | 'tech' | 'cs'
  display_name: string
  shop_id: string
  technician_id?: string
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthCtx = createContext<AuthState>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('yuwen_token'))
  const [loading, setLoading] = useState(true)

  // 启动时用 token 恢复登录状态
  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let cancelled = false
    api<{ user: User }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (!cancelled) setUser(res.user)
      })
      .catch(() => {
        if (cancelled) return
        // token 失效，清除
        localStorage.removeItem('yuwen_token')
        setToken(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [token])

  const login = async (username: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    localStorage.setItem('yuwen_token', res.token)
    setToken(res.token)
    setUser(res.user)
    // 通知 realtime 单例：等待 token 的订阅可以建立连接了（替代 2s 轮询）
    window.dispatchEvent(new CustomEvent('yuwen:login'))
  }

  const logout = () => {
    localStorage.removeItem('yuwen_token')
    setToken(null)
    setUser(null)
    // 通知 realtime 单例断开旧连接
    window.dispatchEvent(new CustomEvent('yuwen:logout'))
  }

  return (
    <AuthCtx.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
