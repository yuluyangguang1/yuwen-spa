// AI Provider — 足韵内置，直接调 LLM API
//
// 后台填 API Key + 选服务商，足韵直接请求大模型。
// 不依赖任何外部项目/服务。
//
// 支持：DeepSeek / 通义千问 / OpenAI / Ollama(本地) / 任意 OpenAI 兼容接口

import fs from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(process.cwd(), 'db', 'ai-config.json')

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek（推荐，便宜）',
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
    name: 'Ollama（本地离线）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
    noKey: true,
  },
  custom: {
    name: '自定义接口',
    baseUrl: '',
    defaultModel: '',
  },
}

export function getProviders() { return PROVIDERS }

export function getAIConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (e) { /* fallback */ }
  return { provider: '', apiKey: '', model: '', baseUrl: '', enabled: false }
}

export function saveAIConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export async function chatCompletion(messages, opts = {}) {
  const config = getAIConfig()
  if (!config.enabled || !config.provider) {
    throw new Error('AI 未启用，请在后台 → AI 助手 → 配置中设置')
  }

  const providerInfo = PROVIDERS[config.provider] || {}
  const baseUrl = config.baseUrl || providerInfo.baseUrl
  const model = config.model || providerInfo.defaultModel
  const apiKey = config.apiKey

  if (!baseUrl) throw new Error('未配置 API 地址')
  if (!apiKey && !providerInfo.noKey) throw new Error('未配置 API Key')

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers = { 'Content-Type': 'application/json' }
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
      throw new Error(`API 错误 (${res.status}): ${errBody.slice(0, 200)}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeout)
  }
}

export async function ask(prompt, systemPrompt) {
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })
  return chatCompletion(messages)
}

export function isAIEnabled() {
  const config = getAIConfig()
  return config.enabled && !!config.provider
}
