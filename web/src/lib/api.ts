// API 请求封装
// 自动带上 Authorization header

const BASE = ''  // 同源，Vite proxy 转发

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('yuwen_token')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts?.headers as Record<string, string> || {}),
  }
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
  })

  if (res.status === 401) {
    // token 失效，清除并跳转登录
    localStorage.removeItem('yuwen_token')
    window.location.href = '/login'
    throw new Error('请先登录')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export const get = <T = any>(path: string) => api<T>(path)
export const post = <T = any>(path: string, data?: any) =>
  api<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
export const put = <T = any>(path: string, data?: any) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) })
export const del = <T = any>(path: string) =>
  api<T>(path, { method: 'DELETE' })
