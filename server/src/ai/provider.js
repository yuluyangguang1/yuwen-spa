// AI Provider — 通过 Hermes Gateway 调用
//
// 足韵不再直接对接各家 LLM API，而是统一走本地 Hermes Gateway：
//   http://127.0.0.1:8642/v1/chat/completions
//
// 好处：
//   - 多模型管理在 Hermes CLI / Web UI 里搞定
//   - Token 用量、计费、限流 Hermes 自带
//   - 足韵只需要知道 Hermes 地址，不关心底层是哪个模型
//   - 老板可以随时在 Hermes 里切模型，足韵代码不用改
//
// 配置项：
//   - hermesUrl: Hermes Gateway 地址（默认 http://127.0.0.1:8642）
//   - model: 模型名（留空 = Hermes 默认模型）
//   - enabled: 是否启用

import fs from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(process.cwd(), 'db', 'ai-config.json')

// 默认配置
const DEFAULTS = {
  hermesUrl: 'http://127.0.0.1:8642',
  model: '',
  enabled: false,
}

// 读取配置
export function getAIConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      return { ...DEFAULTS, ...saved }
    }
  } catch (e) { /* fallback */ }
  return { ...DEFAULTS }
}

// 保存配置
export function saveAIConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

// 调用 Hermes（OpenAI 兼容格式）
export async function chatCompletion(messages, opts = {}) {
  const config = getAIConfig()
  if (!config.enabled) {
    throw new Error('AI 未启用，请在后台设置中开启')
  }

  const url = `${config.hermesUrl.replace(/\/+$/, '')}/v1/chat/completions`
  const headers = {
    'Content-Type': 'application/json',
  }

  const body = {
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2000,
  }
  // 如果指定了模型就传，否则让 Hermes 用默认
  if (config.model) body.model = config.model

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 60000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Hermes 返回错误 (${res.status}): ${errBody.slice(0, 300)}`)
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeout)
  }
}

// 便捷方法：单轮对话
export async function ask(prompt, systemPrompt) {
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })
  return chatCompletion(messages)
}

// 检查 Hermes 是否在线
export async function checkHermesStatus() {
  const config = getAIConfig()
  try {
    const res = await fetch(`${config.hermesUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    })
    return { online: res.ok, url: config.hermesUrl }
  } catch (e) {
    return { online: false, url: config.hermesUrl, error: e.message }
  }
}

// 检查 AI 是否可用
export function isAIEnabled() {
  const config = getAIConfig()
  return config.enabled
}
