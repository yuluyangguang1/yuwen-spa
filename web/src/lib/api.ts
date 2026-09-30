// API 请求封装
// 自动带上 Authorization header + AbortController 超时控制

const BASE = ''  // 同源，Vite proxy 转发
const REQUEST_TIMEOUT = 15000 // 15 秒超时（覆盖到 body 读完）
const SSE_IDLE_TIMEOUT = 30000 // SSE 空闲超时：30s 无 chunk 即中止

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const json = await rawRequest(path, opts)
  // 后端列表接口统一返回 { data, total, page, pageSize }，这里解包 data
  if (json && typeof json === 'object' && !Array.isArray(json) && 'data' in json) {
    return (json as any).data as T
  }
  return json as T
}

/** 不解包 data 的请求：需要同时拿 rows + total/page 时用（如通知历史、审计日志分页） */
export async function getFull<T = any>(path: string): Promise<T> {
  return (await rawRequest(path, {})) as T
}

async function rawRequest(path: string, opts?: RequestInit): Promise<any> {
  const token = localStorage.getItem('yuwen_token')
  const controller = new AbortController()
  const external = opts?.signal

  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  // 超时覆盖整个请求 + body 读取
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  // 无 body 的请求不要带 Content-Type，否则 Fastify JSON parser 可能对空 body 报错
  const headers: Record<string, string> = {
    ...(opts?.headers as Record<string, string> || {}),
  }
  if (opts?.body != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
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

    if (res.status === 401) {
      // token 失效：抛错让 mutation 走 onError（避免伪成功），同时 SPA 跳转登录
      localStorage.removeItem('yuwen_token')
      sessionStorage.setItem('yuwen_redirect', location.pathname + location.search)
      window.dispatchEvent(new CustomEvent('yuwen:401'))
      throw new ApiError('登录已失效，请重新登录', 401)
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any))
      throw new ApiError(body.error || `HTTP ${res.status}`, res.status)
    }

    if (res.status === 204) return undefined
    const text = await res.text()
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      throw new ApiError('响应格式错误', res.status)
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (external?.aborted) throw new Error('请求已取消')
      throw new Error('请求超时，请检查网络连接')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }
}

export const get = <T = any>(path: string) => api<T>(path)
export const post = <T = any>(path: string, data?: any) =>
  api<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
export const put = <T = any>(path: string, data?: any) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) })
export const del = <T = any>(path: string) =>
  api<T>(path, { method: 'DELETE' })

/**
 * SSE 流式请求（POST 或 GET）。
 * 同步返回 cancel（流结束前均可取消）；finished 在流结束时 resolve。
 * 服务端事件: {delta?} | {done,response} | {error} | {meta?} | {report?}
 * - 空闲 30s 无 chunk 自动中止
 * - 只回调一次 onDone；收到 error 后不再 onDone
 */
export function streamSSE(
  path: string,
  opts: {
    method?: 'GET' | 'POST'
    body?: any
    onEvent: (ev: any) => void
    onDone?: (full: string) => void
    onError?: (msg: string) => void
  },
): { cancel: () => void; finished: Promise<void> } {
  const token = localStorage.getItem('yuwen_token')
  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let canceled = false
  let failed = false

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      failed = true
      opts.onError?.('流式响应超时（长时间无数据）')
      controller.abort()
    }, SSE_IDLE_TIMEOUT)
  }

  const cancel = () => {
    canceled = true
    if (idleTimer) clearTimeout(idleTimer)
    controller.abort()
  }

  const finished = (async () => {
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (opts.body != null) headers['Content-Type'] = 'application/json'

    resetIdle()
    try {
      const res = await fetch(path, {
        method: opts.method || 'POST',
        headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any))
        failed = true
        opts.onError?.(body.error || `HTTP ${res.status}`)
        return
      }
      if (!res.body) {
        failed = true
        opts.onError?.('无流式响应体')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''
      let sawDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (failed || canceled) break
        resetIdle()
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const chunk of parts) {
          if (failed || canceled) break
          // SSE 规范：一个事件内的多行 data 用 \n 拼接后再解析
          const dataLines = chunk
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
          if (!dataLines.length) continue
          const payload = dataLines.join('\n')
          try {
            const ev = JSON.parse(payload)
            if (ev.error) {
              failed = true
              opts.onError?.(ev.error)
              controller.abort()
              break
            }
            if (typeof ev.delta === 'string') full += ev.delta
            opts.onEvent(ev)
            if (ev.done && !sawDone) {
              sawDone = true
              opts.onDone?.(typeof ev.response === 'string' ? ev.response : full)
            }
          } catch {
            console.warn('[sse] 无法解析事件', payload.slice(0, 120))
          }
        }
      }
      if (!sawDone && !failed && full) opts.onDone?.(full)
    } catch (err: any) {
      if (canceled || err?.name === 'AbortError') return
      failed = true
      const msg = err?.message || '流式请求失败'
      opts.onError?.(msg)
      throw err
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
    }
  })()

  return { cancel, finished }
}
