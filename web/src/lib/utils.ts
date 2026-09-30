export function formatMoney(cents: number) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '¥0'
  return `¥${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`
}

export function formatElapsed(startedAt: number | null) {
  if (!startedAt) return ''
  const mins = Math.floor((Date.now() - startedAt) / 60000)
  if (mins < 1) return '刚开始'
  return `${mins} 分钟`
}

export function statusLabel(s: string) {
  const map: Record<string, string> = {
    idle: '空闲', working: '服务中', break: '休息', off: '下班',
    pending: '待开始', active: '进行中', completed: '待结账', paid: '已结账', canceled: '已取消',
    refunded: '已退款',
    occupied: '使用中',
    onsite: '到店', self: '自提',
  }
  return map[s] || s
}

export function statusColor(s: string) {
  const map: Record<string, string> = {
    idle: 'text-white/50', working: 'text-tan', break: 'text-gold', off: 'text-white/40',
    pending: 'text-white/60', active: 'text-tan', completed: 'text-moss', paid: 'text-white/50', canceled: 'text-cinnabar',
    refunded: 'text-gold',
  }
  return map[s] || 'text-white/60'
}

// 点单订单状态（与钟单状态分开，避免 pending 语义冲突）
export function orderStatusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '待接单', accepted: '已接单', delivered: '已送达', canceled: '已取消',
  }
  return map[s] || s
}

export function paymentMethodLabel(m?: string | null) {
  const map: Record<string, string> = {
    cash: '现金', wechat: '微信', alipay: '支付宝', balance: '余额', card: '银行卡', unknown: '未知',
  }
  return m ? (map[m] || m) : '—'
}
