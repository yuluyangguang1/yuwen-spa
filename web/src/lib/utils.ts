export function formatMoney(cents: number) {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
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
    occupied: '使用中',
  }
  return map[s] || s
}

export function statusColor(s: string) {
  const map: Record<string, string> = {
    idle: 'text-white/40', working: 'text-tan', break: 'text-gold', off: 'text-white/20',
    pending: 'text-white/50', active: 'text-tan', completed: 'text-moss', paid: 'text-white/40', canceled: 'text-cinnabar',
  }
  return map[s] || 'text-white/50'
}
