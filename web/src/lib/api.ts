// API 请求封装
// 自动带上 Authorization header + AbortController 超时控制

const BASE = ''  // 同源，Vite proxy 转发
const REQUEST_TIMEOUT = 15000 // 15 秒超时

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('yuwen_token')
  const controller = new AbortController()

  // 设置超时
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts?.headers as Record<string, string> || {}),
  }
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (res.status === 401) {
      // token 失效，记录重定向路径（SPA 路由导航而非全量刷新）
      localStorage.removeItem('yuwen_token')
      sessionStorage.setItem('yuwen_redirect', location.pathname + location.search)
      throw new Error('请先登录')
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接')
    }
    throw err
  }
}

export const get = <T = any>(path: string) => api<T>(path)
export const post = <T = any>(path: string, data?: any) =>
  api<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
export const put = <T = any>(path: string, data?: any) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) })
export const del = <T = any>(path: string) =>
  api<T>(path, { method: 'DELETE' })
