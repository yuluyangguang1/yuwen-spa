// AuthContext：管理登录状态 + token 持久化

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api } from '../lib/api'

interface User {
  id: string
  username: string
  role: 'admin' | 'pos' | 'tech'
  display_name: string
  shop_id: string
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
    api<{ user: User }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => setUser(res.user))
      .catch(() => {
        // token 失效，清除
        localStorage.removeItem('yuwen_token')
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, [token])

  const login = async (username: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    localStorage.setItem('yuwen_token', res.token)
    setToken(res.token)
    setUser(res.user)
  }

  const logout = () => {
    localStorage.removeItem('yuwen_token')
    setToken(null)
    setUser(null)
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
