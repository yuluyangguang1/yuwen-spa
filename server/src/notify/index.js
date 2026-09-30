// 多平台通知模块
//
// 支持企业微信、飞书、钉钉、Slack、Discord 五种通知渠道。
// 每种渠道通过 webhook URL 配置，独立启用/禁用。
//
// 通知规则：
//   排钟 → 大群 + 技师私信
//   结算 → 仅技师私信
//   会员办卡/充值 → 大群
//   大额消费 → 大群

import { nanoid } from 'nanoid'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const CONFIG_PATH = path.join(ROOT, 'db', 'notify-config.json')

// 注入 db 后可写 notify_history（Phase 3 通知历史）
let historyDb = null
let historyShopFallback = null
export function setNotifyHistoryDb(db, shopId) {
  historyDb = db
  historyShopFallback = shopId || null
}
export function recordNotifyHistory(event, content, channels, shopId) {
  if (!historyDb) return
  try {
    historyDb.prepare(`
      INSERT INTO notify_history(id, shop_id, event, content, channels, created_at)
      VALUES(?,?,?,?,?,?)
    `).run(
      nanoid(12),
      shopId || historyShopFallback || null,
      String(event || 'unknown'),
      content == null ? null : String(content).slice(0, 4000),
      JSON.stringify(channels || []),
      Date.now(),
    )
  } catch (_) { /* 历史写入失败不影响通知 */ }
}

const DEFAULTS = {
  channels: {
    wechat: { enabled: false, webhookUrl: '', label: '企业微信' },
    feishu: { enabled: false, webhookUrl: '', label: '飞书' },
    dingtalk: { enabled: false, webhookUrl: '', label: '钉钉' },
    slack: { enabled: false, webhookUrl: '', label: 'Slack' },
    discord: { enabled: false, webhookUrl: '', label: 'Discord' },
  },
  // 完钟预警提前分钟（可配 [5] 或 [10,5]），到点固定提醒
  endWarnMinutes: [5],
}

// ── 配置管理（按店隔离，兼容旧全局文件）──────────
function configPathFor(shopId) {
  if (!shopId) return CONFIG_PATH
  const safe = String(shopId).replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(ROOT, 'db', `notify-config.${safe}.json`)
}

export function getNotifyConfig(shopId) {
  try {
    const p = configPathFor(shopId)
    if (fs.existsSync(p)) {
      const file = JSON.parse(fs.readFileSync(p, 'utf8'))
      return { ...DEFAULTS, ...file, channels: { ...DEFAULTS.channels, ...file.channels } }
    }
    // 本店无独立配置时，回退读旧全局文件（迁移兼容）
    if (shopId && fs.existsSync(CONFIG_PATH)) {
      const file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      return { ...DEFAULTS, ...file, channels: { ...DEFAULTS.channels, ...file.channels } }
    }
  } catch (_) {}
  return { ...DEFAULTS }
}

export function saveNotifyConfig(config, shopId) {
  const p = configPathFor(shopId)
  const dir = path.dirname(p)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(p, JSON.stringify(config, null, 2))
}

// ── 各平台消息格式 ──────────────────────────────

// 企业微信（已支持，保持兼容）
async function sendWeChatWebhook(url, content) {
  const body = { msgtype: 'markdown', markdown: { content } }
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
    console.error('[notify] wechat webhook failed:', e.message)
    return false
  }
}

// 飞书（自建应用群机器人 Webhook）
async function sendFeishuWebhook(url, content) {
  const body = {
    msg_type: 'markdown',
    content: {
      markdown: {
        text: content,
      },
    },
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return data.code === 0
  } catch (e) {
    console.error('[notify] feishu webhook failed:', e.message)
    return false
  }
}

// 钉钉（群机器人 Webhook）
async function sendDingTalkWebhook(url, content) {
  const body = {
    msgtype: 'markdown',
    markdown: { title: '足韵通知', text: content },
  }
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
    console.error('[notify] dingtalk webhook failed:', e.message)
    return false
  }
}

// Slack（Incoming Webhook）
async function sendSlackWebhook(url, content) {
  const body = { text: content }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return data.ok === true
  } catch (e) {
    console.error('[notify] slack webhook failed:', e.message)
    return false
  }
}

// Discord（Webhook）
async function sendDiscordWebhook(url, content) {
  const body = { content }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch (e) {
    console.error('[notify] discord webhook failed:', e.message)
    return false
  }
}

// ── 通用发送 ──────────────────────────────────────
async function sendToChannel(channelName, content, shopId) {
  const config = getNotifyConfig(shopId)
  const channel = config.channels?.[channelName]
  if (!channel?.enabled || !channel.webhookUrl) return false

  switch (channelName) {
    case 'wechat':
      return sendWeChatWebhook(channel.webhookUrl, content)
    case 'feishu':
      return sendFeishuWebhook(channel.webhookUrl, content)
    case 'dingtalk':
      return sendDingTalkWebhook(channel.webhookUrl, content)
    case 'slack':
      return sendSlackWebhook(channel.webhookUrl, content)
    case 'discord':
      return sendDiscordWebhook(channel.webhookUrl, content)
    default:
      return false
  }
}

// 发送到所有启用的渠道
// event: 可选事件名，用于 notify_history
async function broadcastToAll(content, shopId, event = 'broadcast') {
  const keys = Object.keys(DEFAULTS.channels)
  const results = await Promise.all(keys.map(ch => sendToChannel(ch, content, shopId)))
  const channels = keys.map((k, i) => ({ key: k, ok: !!results[i] }))
  recordNotifyHistory(event, content, channels, shopId)
  return results
}

// ── 新派钟：大群 + 技师私信 ──────────────────────
export async function notifyTicketCreated(ticket, techWebhookUrl) {
  const tech = ticket.technician_name || ticket.technician_number || '未指派'
  const service = ticket.service_name || '服务'
  const room = ticket.room_number ? `${ticket.room_number}号房` : ''
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  const content = [
    `📢 **新派钟通知**`,
    `> 技师：${tech}`,
    `> 项目：${service}`,
    room ? `> 房间：${room}` : null,
    `> 时间：${time}`,
  ].filter(Boolean).join('\n')

  const results = await Promise.allSettled([
    broadcastToAll(content, ticket.shop_id, 'ticket.created'),
    techWebhookUrl ? sendToChannelByUrl(techWebhookUrl, content, ticket.shop_id, 'ticket.created.tech') : Promise.resolve(false),
  ])
  return results.every(r => r.status === 'fulfilled')
}

// 按 URL 发送（兼容旧接口的技师私信）
async function sendToChannelByUrl(url, content, shopId, event = 'direct') {
  const ok = await sendWebhookByUrl(url, content)
  if (ok) recordNotifyHistory(event, content, [{ key: 'url', ok: true }], shopId)
  return ok
}

async function sendWebhookByUrl(url, content) {
  if (url.includes('qyapi.weixin')) return sendWeChatWebhook(url, content)
  if (url.includes('open.feishu')) return sendFeishuWebhook(url, content)
  if (url.includes('oapi.dingtalk')) return sendDingTalkWebhook(url, content)
  if (url.includes('hooks.slack')) return sendSlackWebhook(url, content)
  if (url.includes('discord.com/api')) return sendDiscordWebhook(url, content)
  return sendWeChatWebhook(url, content)
}

// ── 结算：仅技师私信 ────────────────────────────
export async function notifyTicketPaid(ticket, techWebhookUrl) {
  const tech = ticket.technician_name || ''
  const service = ticket.service_name || '服务'
  const price = (ticket.price_cents / 100).toFixed(0)
  const commission = (ticket.commission_cents / 100).toFixed(0)

  const content = [
    `💰 **结算通知**`,
    `> 技师：${tech}`,
    `> 项目：${service}`,
    `> 金额：¥${price}`,
    `> 提成：¥${commission}`,
  ].join('\n')

  return broadcastToAll(content, ticket.shop_id, 'ticket.paid').then(() => {
    if (techWebhookUrl) return sendToChannelByUrl(techWebhookUrl, content, ticket.shop_id, 'ticket.paid.tech')
    return true
  })
}

// ── 会员办卡/充值：大群 ──────────────────────────
export async function notifyMembershipTopup(customer, amount_cents, type) {
  const name = customer.name || '顾客'
  const phone = customer.phone ? customer.phone.slice(-4) : ''
  const amount = (amount_cents / 100).toFixed(0)
  const balance = (customer.balance_cents / 100).toFixed(0)
  const label = type === 'topup' ? '充值' : '办卡'

  const content = [
    `🎉 **会员${label}**`,
    `> 会员：${name}${phone ? `（尾号${phone}）` : ''}`,
    `> 金额：¥${amount}`,
    `> 余额：¥${balance}`,
  ].join('\n')

  return broadcastToAll(content, customer.shop_id, 'customer.topup')
}

// ── 大额消费提醒：大群 ──────────────────────────
export async function notifyBigTicket(ticket, threshold_cents = 20000) {
  if (ticket.price_cents < threshold_cents) return false
  const price = (ticket.price_cents / 100).toFixed(0)
  const content = [
    `🔥 **大额订单**`,
    `> 技师：${ticket.technician_name || ''}`,
    `> 项目：${ticket.service_name || '服务'}`,
    `> 金额：¥${price}`,
  ].join('\n')
  return broadcastToAll(content, ticket.shop_id, 'ticket.big')
}

// ── 测试连接 ──────────────────────────────────────
export async function testWebhook(shopId) {
  const content = '✅ 足韵 webhook 连接测试成功\n\n当前时间：' + new Date().toLocaleString('zh-CN')
  return broadcastToAll(content, shopId, 'test')
}

// ── 获取各渠道状态 ──────────────────────────────
export function getChannelStatus(shopId) {
  const config = getNotifyConfig(shopId)
  return Object.entries(config.channels || {}).map(([key, ch]) => ({
    key,
    label: ch.label || key,
    enabled: ch.enabled,
    hasUrl: !!ch.webhookUrl,
  }))
}
