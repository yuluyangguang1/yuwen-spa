// 通知模块：企业微信 Webhook 推送
//
// 企业微信群机器人 webhook 格式：
//   POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
//   Body: { "msgtype": "text", "text": { "content": "消息内容" } }
//
// 支持 markdown 格式更美观。
//
// 配置存储在 db/notify-config.json：
//   webhookUrl: string  （群机器人 webhook 地址）
//   enabled: boolean

import fs from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(process.cwd(), 'db', 'notify-config.json')

const DEFAULTS = {
  webhookUrl: '',
  enabled: false,
}

// ── 配置管理 ──────────────────────────────────────
export function getNotifyConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
    }
  } catch (_) {}
  return { ...DEFAULTS }
}

export function saveNotifyConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

// ── 发送企业微信 webhook ──────────────────────────
async function sendWebhookTo(url, content, msgtype = 'text') {
  const body = msgtype === 'markdown'
    ? { msgtype: 'markdown', markdown: { content } }
    : { msgtype: 'text', text: { content } }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return data.errcode === 0
  } catch (e) {
    console.error('[notify] webhook 发送失败:', e.message)
    return false
  }
}

async function sendWebhook(content, msgtype = 'text') {
  const config = getNotifyConfig()
  if (!config.enabled || !config.webhookUrl) return false
  return sendWebhookTo(config.webhookUrl, content, msgtype)
}

// ── 业务通知：新派钟 ──────────────────────────────
export async function notifyTicketCreated(ticket, techWebhookUrl) {
  const tech = ticket.technician_name || ticket.technician_number || '未指派'
  const service = ticket.service_name || '服务'
  const room = ticket.room_number ? `${ticket.room_number}号房` : ''
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  const content = [
    `📢 <font color="info">新派钟通知</font>`,
    ``,
    `> 技师：<font color="warning">${tech}</font>`,
    `> 项目：${service}`,
    room ? `> 房间：${room}` : null,
    `> 时间：${time}`,
  ].filter(Boolean).join('\n')

  // 同时发群消息和个人消息
  const tasks = [sendWebhook(content, 'markdown')]
  if (techWebhookUrl) {
    tasks.push(sendWebhookTo(techWebhookUrl, content, 'markdown'))
  }
  return Promise.all(tasks)
}

// ── 业务通知：结账 ────────────────────────────────
export async function notifyTicketPaid(ticket, techWebhookUrl) {
  const tech = ticket.technician_name || ''
  const service = ticket.service_name || '服务'
  const price = (ticket.price_cents / 100).toFixed(0)
  const commission = (ticket.commission_cents / 100).toFixed(0)

  const content = [
    `💰 <font color="info">结账通知</font>`,
    ``,
    `> 技师：${tech}`,
    `> 项目：${service}`,
    `> 金额：¥${price}`,
    `> 提成：<font color="warning">¥${commission}</font>`,
  ].join('\n')

  const tasks = [sendWebhook(content, 'markdown')]
  if (techWebhookUrl) {
    tasks.push(sendWebhookTo(techWebhookUrl, content, 'markdown'))
  }
  return Promise.all(tasks)
}

// ── 测试连接 ──────────────────────────────────────
export async function testWebhook() {
  return sendWebhook('✅ 足韵 webhook 连接测试成功\n\n当前时间：' + new Date().toLocaleString('zh-CN'), 'text')
}
