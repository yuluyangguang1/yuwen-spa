// AI Provider — 通用 OpenAI 兼容客户端
//
// 对接任意 OpenAI 兼容端点（POST {baseUrl}/v1/chat/completions）：
//   - 本地推理：Ollama / LM Studio / vLLM
//   - 云端 API：DeepSeek / OpenAI / Moonshot 等
//
// 配置项（server/db/ai-config.json）：
//   - baseUrl: API 基址，不含 /v1（如 https://api.deepseek.com）
//   - apiKey:  可选，Bearer Token（本地端点通常留空）
//   - model:   模型名
//   - enabled: 是否启用
//
// 兼容：旧配置里的 hermesUrl 会自动迁移为 baseUrl。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const CONFIG_PATH = path.join(ROOT, 'db', 'ai-config.json')

const DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  model: '',
  enabled: false,
}

function normalizeConfig(raw) {
  const merged = { ...DEFAULTS, ...raw }
  // 旧字段 hermesUrl → baseUrl
  if ((!merged.baseUrl || !merged.baseUrl.trim()) && merged.hermesUrl) {
    merged.baseUrl = merged.hermesUrl
  }
  delete merged.hermesUrl
  if (merged.enabled == null) merged.enabled = false
  return merged
}

export function getAIConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
    }
  } catch { /* fallback */ }
  return { ...DEFAULTS }
}

export function saveAIConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const normalized = normalizeConfig(config)
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2))
}

function buildHeaders(config) {
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey && config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`
  }
  return headers
}

function requireEndpoint(config) {
  const base = (config.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('未配置 AI API 地址，请在后台 AI 设置中填写')
  return base
}

export async function chatCompletion(messages, opts = {}) {
  const config = getAIConfig()
  if (!config.enabled) {
    throw new Error('AI 未启用，请在后台设置中开启')
  }

  const base = requireEndpoint(config)
  const url = `${base}/v1/chat/completions`

  const body = {
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2000,
  }
  if (config.model) body.model = config.model

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 60000)
  const onExternalAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`AI 接口返回错误 (${res.status}): ${errBody.slice(0, 300)}`)
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeout)
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
  }
}

export async function ask(prompt, systemPrompt) {
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })
  return chatCompletion(messages)
}

/**
 * 流式 chat completion（SSE）
 * @param {Array} messages
 * @param {{temperature?:number,max_tokens?:number,timeout?:number,onDelta:(text:string)=>void|Promise<void>}} opts
 * @returns {Promise<string>} 累积完整文本
 */
export async function chatCompletionStream(messages, opts = {}) {
  const config = getAIConfig()
  if (!config.enabled) {
    throw new Error('AI 未启用，请在后台设置中开启')
  }

  const base = requireEndpoint(config)
  const url = `${base}/v1/chat/completions`

  const body = {
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2000,
    stream: true,
  }
  if (config.model) body.model = config.model

  // 空闲超时：每个 chunk 到达即重置；总时长上限兜底。
  // 旧实现是 60s 硬超时（从发起到流结束），长回答会被中途掐断。
  const idleMs = opts.idleTimeout ?? 30000
  const maxMs = opts.timeout ?? 300000
  const controller = new AbortController()
  let idleTimer = null
  const hardTimer = setTimeout(() => controller.abort(), maxMs)
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleMs)
  }
  const onExternalAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  resetIdle()

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`AI 接口返回错误 (${res.status}): ${errBody.slice(0, 300)}`)
    }
    if (!res.body) throw new Error('AI 流式响应为空')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            resetIdle()
            if (opts.onDelta) await opts.onDelta(delta)
          }
        } catch { /* partial / ignore */ }
      }
    }
    if (controller.signal.aborted && !full) {
      throw new Error(opts.signal?.aborted ? '请求已取消' : 'AI 流式超时（空闲过久）')
    }
    return full
  } finally {
    clearTimeout(hardTimer)
    if (idleTimer) clearTimeout(idleTimer)
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
  }
}

export async function checkAIEndpointStatus() {
  const config = getAIConfig()
  let url
  try {
    url = `${requireEndpoint(config)}/v1/models`
  } catch (e) {
    return { online: false, url: config.baseUrl || '', error: e.message }
  }
  try {
    const res = await fetch(url, {
      headers: buildHeaders(config),
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) return { online: true, url }
    return { online: false, url, error: `HTTP ${res.status}` }
  } catch (e) {
    return { online: false, url, error: e.message }
  }
}

export function isAIEnabled() {
  return !!getAIConfig().enabled
}
