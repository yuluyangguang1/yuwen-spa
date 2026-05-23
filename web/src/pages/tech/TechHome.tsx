import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney, formatElapsed } from '@/lib/utils'
import { useRealtime } from '@/lib/realtime'
import { notifyNewTicket, warmupAudio } from '@/lib/notify'
import { DollarSign, Clock, Bell } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'

// 技师端首页：当前排钟 + 今日业绩 + 实时通知
export default function TechHome() {
  const qc = useQueryClient()
  const [toast, setToast] = useState<string | null>(null)

  // 预热音频（页面首次交互后）
  useEffect(() => {
    const warmup = () => { warmupAudio(); document.removeEventListener('touchstart', warmup); document.removeEventListener('click', warmup) }
    document.addEventListener('touchstart', warmup, { once: true })
    document.addEventListener('click', warmup, { once: true })
  }, [])

  // WebSocket 实时事件
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 5000)
  }, [])

  useRealtime({
    'ticket:created': (data: any) => {
      // 新钟单通知（只有自己的才提醒）
      if (data.technician_id === currentTech?.id) {
        const msg = `新派钟：${data.service_name || '服务'}${data.room_number ? ` · ${data.room_number}号房` : ''}`
        showToast(msg)
        notifyNewTicket(data)
      }
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
    },
    'ticket:updated': () => qc.invalidateQueries({ queryKey: ['tickets-today'] }),
    'ticket:paid': (data: any) => {
      if (data.technician_id === currentTech?.id) {
        showToast(`已结账：${data.service_name || '服务'} +${formatMoney(data.commission_cents)}`)
      }
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
    },
  })

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })

  // 暂时用第一个技师做演示（后续加登录关联）
  const currentTech = technicians[0]

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today'),
    refetchInterval: 10000, // 有 WebSocket 后降为 10s 兜底
  })

  if (!currentTech) return <div className="p-4 text-white/40">加载中...</div>

  const myTickets = tickets.filter((t: any) => t.technician_id === currentTech.id)
  const activeTicket = myTickets.find((t: any) => t.status === 'active')
  const completedToday = myTickets.filter((t: any) => t.status === 'paid' || t.status === 'completed')
  const todayCommission = completedToday.reduce((s: number, t: any) => s + (t.commission_cents || 0), 0)
  const todayRevenue = completedToday.reduce((s: number, t: any) => s + t.price_cents, 0)

  return (
    <div className="p-4 space-y-4">
      {/* Toast 通知 */}
      {toast && (
        <div className="fixed top-14 left-4 right-4 z-50 animate-bounce">
          <div className="glass-card border-tan/40 bg-tan/10 p-3 flex items-center gap-2 text-sm">
            <Bell size={16} className="text-tan flex-shrink-0" />
            <span className="text-tan">{toast}</span>
          </div>
        </div>
      )}

      {/* 身份卡 */}
      <div className="glass-card p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-tan/20 flex items-center justify-center text-tan text-lg font-bold">
          {currentTech.number}
        </div>
        <div>
          <div className="font-medium text-lg">{currentTech.name}</div>
          <div className="text-xs text-white/40">{currentTech.level} · {currentTech.status === 'working' ? '服务中' : '空闲'}</div>
        </div>
      </div>

      {/* 今日业绩 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card p-3 text-center">
          <div className="text-xs text-white/40">完成</div>
          <div className="text-xl font-medium mt-1">{completedToday.length}</div>
          <div className="text-[10px] text-white/30">单</div>
        </div>
        <div className="glass-card p-3 text-center">
          <div className="text-xs text-white/40">营收</div>
          <div className="text-xl font-medium text-tan mt-1">{formatMoney(todayRevenue)}</div>
        </div>
        <div className="glass-card p-3 text-center">
          <div className="text-xs text-white/40">提成</div>
          <div className="text-xl font-medium text-moss mt-1">{formatMoney(todayCommission)}</div>
        </div>
      </div>

      {/* 当前服务 */}
      {activeTicket ? (
        <section>
          <h3 className="text-sm text-white/50 mb-2 flex items-center gap-1">
            <Clock size={14} /> 当前服务
          </h3>
          <div className="glass-card p-4 border-tan/30 bg-tan/5">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{activeTicket.service_name}</div>
                <div className="text-xs text-white/40 mt-1">
                  {activeTicket.room_number && `${activeTicket.room_number}号房 · `}
                  {activeTicket.customer_name || '散客'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-tan text-lg">{formatElapsed(activeTicket.started_at)}</div>
                <div className="text-xs text-white/30">{activeTicket.service_duration}分钟</div>
              </div>
            </div>
            {/* 进度条 */}
            <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-tan/60 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, ((Date.now() - activeTicket.started_at) / (activeTicket.service_duration * 60000)) * 100)}%`
                }}
              />
            </div>
          </div>
        </section>
      ) : (
        <div className="glass-card p-6 text-center text-white/30 text-sm">
          当前无服务，等待派钟
        </div>
      )}

      {/* 今日排钟列表 */}
      {myTickets.length > 0 && (
        <section>
          <h3 className="text-sm text-white/50 mb-2">今日排钟</h3>
          <div className="space-y-2">
            {myTickets.map((t: any) => (
              <div key={t.id} className="glass-card p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm">{t.service_name}</div>
                  <div className="text-[10px] text-white/30">
                    {t.room_number && `${t.room_number}号房`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/50">{formatMoney(t.price_cents)}</div>
                  <div className={`text-[10px] ${
                    t.status === 'active' ? 'text-tan' :
                    t.status === 'paid' ? 'text-moss' : 'text-white/30'
                  }`}>
                    {t.status === 'active' ? '进行中' : t.status === 'paid' ? '已结' : t.status === 'completed' ? '待结' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
