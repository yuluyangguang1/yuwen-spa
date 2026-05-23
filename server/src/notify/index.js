// 通知模块：企业微信 Webhook 推送
//
// 通知规则：
//   排钟 → 大群 + 技师私信
//   结算 → 仅技师私信
//   会员办卡/充值 → 大群
//   客服办大卡 → 大群
//
// 企业微信群机器人 webhook 格式：
//   POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
//   Body: { "msgtype": "markdown", "markdown": { "content": "..." } }

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
async function sendWebhookTo(url, content, msgtype = 'markdown') {
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

// 发送到大群
async function sendToGroup(content) {
  const config = getNotifyConfig()
  if (!config.enabled || !config.webhookUrl) return false
  return sendWebhookTo(config.webhookUrl, content)
}

// 发送到技师私信
async function sendToTech(techWebhookUrl, content) {
  if (!techWebhookUrl) return false
  return sendWebhookTo(techWebhookUrl, content)
}

// ── 新派钟：大群 + 技师私信 ──────────────────────
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

  // 群 + 私信
  return Promise.all([
    sendToGroup(content),
    sendToTech(techWebhookUrl, content),
  ])
}

// ── 结算：仅技师私信 ──────────────────────────────
export async function notifyTicketPaid(ticket, techWebhookUrl) {
  const tech = ticket.technician_name || ''
  const service = ticket.service_name || '服务'
  const price = (ticket.price_cents / 100).toFixed(0)
  const commission = (ticket.commission_cents / 100).toFixed(0)

  const content = [
    `💰 <font color="info">结算通知</font>`,
    ``,
    `> 技师：${tech}`,
    `> 项目：${service}`,
    `> 金额：¥${price}`,
    `> 提成：<font color="warning">¥${commission}</font>`,
  ].join('\n')

  // 仅私信
  return sendToTech(techWebhookUrl, content)
}

// ── 会员办卡/充值：大群 ──────────────────────────
export async function notifyMembershipTopup(customer, amount_cents, type) {
  const name = customer.name || '顾客'
  const phone = customer.phone ? `${customer.phone.slice(-4)}` : ''
  const amount = (amount_cents / 100).toFixed(0)
  const balance = (customer.balance_cents / 100).toFixed(0)
  const label = type === 'topup' ? '充值' : '办卡'

  const content = [
    `🎉 <font color="info">会员${label}</font>`,
    ``,
    `> 会员：${name}${phone ? `（尾号${phone}）` : ''}`,
    `> 金额：¥${amount}`,
    `> 余额：¥${balance}`,
  ].join('\n')

  return sendToGroup(content)
}

// ── 大额消费提醒：大群 ──────────────────────────
export async function notifyBigTicket(ticket, threshold_cents = 20000) {
  if (ticket.price_cents < threshold_cents) return false

  const tech = ticket.technician_name || ''
  const service = ticket.service_name || '服务'
  const price = (ticket.price_cents / 100).toFixed(0)

  const content = [
    `🔥 <font color="warning">大额订单</font>`,
    ``,
    `> 技师：${tech}`,
    `> 项目：${service}`,
    `> 金额：<font color="warning">¥${price}</font>`,
  ].join('\n')

  return sendToGroup(content)
}

// ── 测试连接 ──────────────────────────────────────
export async function testWebhook() {
  return sendToGroup('✅ 足韵 webhook 连接测试成功\n\n当前时间：' + new Date().toLocaleString('zh-CN'))
}
