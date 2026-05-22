// AI Provider 统一接口
//
// 支持多个 LLM 后端，后台配置切换：
//   - deepseek（推荐，便宜好用）
//   - qwen（通义千问）
//   - openai（GPT-4o / GPT-4o-mini）
//   - ollama（本地模型，完全离线）
//   - custom（自定义 OpenAI 兼容接口）
//
// 所有 provider 统一走 OpenAI 兼容格式（/v1/chat/completions）

import fs from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(process.cwd(), 'db', 'ai-config.json')

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  ollama: {
    name: 'Ollama (本地)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    defaultModel: '',
  },
}

// 读取 AI 配置
export function getAIConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (e) { /* fallback */ }
  return { provider: '', apiKey: '', model: '', baseUrl: '', enabled: false }
}

// 保存 AI 配置
export function saveAIConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

// 获取 provider 信息
export function getProviders() {
  return PROVIDERS
}

// 统一调用 LLM
export async function chatCompletion(messages, opts = {}) {
  const config = getAIConfig()
  if (!config.enabled || !config.provider) {
    throw new Error('AI 未配置，请在后台设置 API Key')
  }

  const providerInfo = PROVIDERS[config.provider] || {}
  const baseUrl = config.baseUrl || providerInfo.baseUrl
  const model = config.model || providerInfo.defaultModel
  const apiKey = config.apiKey

  if (!baseUrl) throw new Error('未配置 API 地址')
  if (!apiKey && config.provider !== 'ollama') throw new Error('未配置 API Key')

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers = {
    'Content-Type': 'application/json',
  }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2000,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 30000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`AI API 错误 (${res.status}): ${errBody.slice(0, 200)}`)
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
