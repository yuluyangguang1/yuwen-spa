// API 请求封装
const BASE = ''  // 同源，Vite proxy 转发

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
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
