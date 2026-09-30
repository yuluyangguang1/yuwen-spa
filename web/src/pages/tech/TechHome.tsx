import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, formatElapsed, statusLabel } from '@/lib/utils'
import { useRealtime } from '@/lib/realtime'
import { notifyNewTicket, warmupAudio } from '@/lib/notify'
import { useAuth } from '@/lib/auth'
import { Clock, Bell, Play, CheckCircle2, Coffee, LogOut } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { TableSkeleton } from '@/components/LoadingSkeleton'

// 技师端首页：当前排钟 + 自助接单/上下钟 + 今日业绩
export default function TechHome() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | undefined>(undefined)

  // 预热音频（页面首次交互后）
  useEffect(() => {
    const warmup = () => { warmupAudio(); document.removeEventListener('touchstart', warmup); document.removeEventListener('click', warmup) }
    document.addEventListener('touchstart', warmup, { once: true })
    document.addEventListener('click', warmup, { once: true })
    return () => {
      document.removeEventListener('touchstart', warmup)
      document.removeEventListener('click', warmup)
    }
  }, [])

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])

  const { data: technicians = [], isLoading: techsLoading } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })

  // 根据登录用户关联技师（不做 technicians[0] 回退 —— 否则会显示/操作别人的排钟）
  const currentTech = user?.technician_id
    ? technicians.find((t: any) => t.id === user.technician_id)
    : undefined

  // WebSocket 实时事件
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 5000)
  }, [])

  useRealtime({
    'ticket:created': (data: any) => {
      // 新钟单通知（只有自己的才提醒）
      if (data.technician_id === currentTech?.id) {
        const msg = `新派钟：${data.service_name || '服务'}${data.room_number ? ` · ${data.room_number}号房` : ''}`
        showToast(msg)
        notifyNewTicket()
      }
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
    },
    'ticket:updated': () => qc.invalidateQueries({ queryKey: ['tickets-today'] }),
    'ticket:assigned': (data: any) => {
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
      if (data.technician_id === currentTech?.id) {
        showToast(`已派给你：${data.service_name || '服务'}`)
        notifyNewTicket()
      }
    },
    'ticket:active': () => qc.invalidateQueries({ queryKey: ['tickets-today'] }),
    'ticket:completed': () => qc.invalidateQueries({ queryKey: ['tickets-today'] }),
    'ticket:canceled': () => qc.invalidateQueries({ queryKey: ['tickets-today'] }),
    'ticket:ending': (data: any) => {
      if (data.technician_id !== currentTech?.id) return
      const stage = Number(data.stage) || 0
      if (stage <= 0) return
      showToast(`快到点：${data.service_name || '服务'} 还有${stage}分钟`)
      // 声音由全局监听统一播（避免双响）；此处仅 toast
    },
    'ticket:end': (data: any) => {
      if (data.technician_id !== currentTech?.id) return
      showToast(`到点了：${data.service_name || '服务'}`)
    },
    'ticket:paid': (data: any) => {
      if (data.technician_id === currentTech?.id) {
        showToast(`已结账：${data.service_name || '服务'} +${formatMoney(data.commission_cents)}`)
      }
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
    },
  })

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today?pageSize=500'),
    refetchInterval: 10000, // 有 WebSocket 后降为 10s 兜底
  })

  const { data: myShifts = [] } = useQuery({
    queryKey: ['schedules', 'mine'],
    queryFn: () => get('/api/schedules/mine').then((r: any) => r?.data || []).catch(() => []),
    enabled: !!user?.technician_id,
    refetchInterval: 60000,
  })

  const startMut = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/start`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
      qc.invalidateQueries({ queryKey: ['technicians'] })
      showToast('已开钟')
    },
    onError: (e: any) => showToast(e?.message || '开钟失败'),
  })
  const completeMut = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
      qc.invalidateQueries({ queryKey: ['technicians'] })
      showToast('已下钟，待前台结账')
    },
    onError: (e: any) => showToast(e?.message || '下钟失败'),
  })
  const statusMut = useMutation({
    mutationFn: (status: string) => post('/api/technicians/me/status', { status }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['technicians'] })
      showToast(`状态：${statusLabel(data?.status || '')}`)
    },
    onError: (e: any) => showToast(e?.message || '状态切换失败'),
  })

  const isLoading = techsLoading || ticketsLoading

  // 每秒 tick：计时/进度条不再依赖 10s 轮询跳变
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-14 animate-pulse bg-[#2a2a29] rounded-lg w-32" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card p-3 space-y-2">
              <div className="h-3 w-1/2 animate-pulse bg-[#2a2a29] rounded" />
              <div className="h-7 w-3/4 animate-pulse bg-[#2a2a29] rounded" />
            </div>
          ))}
        </div>
        <TableSkeleton rows={4} />
      </div>
    )
  }

  if (!currentTech) {
    if (techsLoading) return <div className="p-4 text-white/50">加载中...</div>
    return (
      <div className="p-4 space-y-3">
        <div className="glass-card p-6 text-center space-y-2">
          <p className="text-white/70 text-sm">当前账号未关联技师</p>
          <p className="text-white/40 text-xs">
            {user?.technician_id
              ? '未找到对应技师资料，请联系管理员'
              : '请使用技师账号登录，或在管理后台「账号」中为当前账号关联技师'}
          </p>
        </div>
      </div>
    )
  }

  const myTickets = tickets.filter((t: any) => t.technician_id === currentTech.id)
  const activeTicket = myTickets.find((t: any) => t.status === 'active')
  const myPending = myTickets.filter((t: any) => t.status === 'pending')
  const completedToday = myTickets.filter((t: any) => t.status === 'paid' || t.status === 'completed')
  const todayCommission = completedToday.reduce((s: number, t: any) => s + (t.commission_cents || 0), 0)
  const todayRevenue = completedToday.reduce((s: number, t: any) => s + t.price_cents, 0)
  const techStatus = currentTech.status as string
  const onDuty = techStatus === 'working' || techStatus === 'idle'

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

      {/* 身份卡 + 状态操作 */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-tan/20 flex items-center justify-center text-tan text-lg font-bold">
            {currentTech.number}
          </div>
          <div className="flex-1">
            <div className="font-medium text-lg">{currentTech.name}</div>
            <div className="text-xs text-white/40">
              {currentTech.level} · {statusLabel(currentTech.status)}
              {myShifts.length > 0 && (
                <span className="text-tan/70"> · 今日班 {myShifts.map((s: any) => `${s.start_min / 60 | 0}:${String(s.start_min % 60).padStart(2, '0')}`).join('/')}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => statusMut.mutate('idle')}
            disabled={statusMut.isPending || techStatus === 'idle' || !!activeTicket}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-lg text-sm border border-white/15 text-white/60 disabled:opacity-30"
          >
            <Play size={14} /> 上岗
          </button>
          <button
            onClick={() => statusMut.mutate('break')}
            disabled={statusMut.isPending || techStatus === 'break' || !!activeTicket}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-lg text-sm border border-white/15 text-white/60 disabled:opacity-30"
          >
            <Coffee size={14} /> 休息
          </button>
          <button
            onClick={() => statusMut.mutate('off')}
            disabled={statusMut.isPending || techStatus === 'off' || !!activeTicket}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-lg text-sm border border-white/15 text-white/60 disabled:opacity-30"
          >
            <LogOut size={14} /> 下班
          </button>
        </div>
        {onDuty && techStatus === 'idle' && (
          <div className="text-xs text-moss mt-2">空闲可接钟 · 等待派钟</div>
        )}
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

      {/* 待我开钟的 pending 单 */}
      {myPending.length > 0 && !activeTicket && (
        <section>
          <h3 className="text-sm text-white/50 mb-2 flex items-center gap-1">
            <Play size={14} /> 待开钟
          </h3>
          <div className="space-y-2">
            {myPending.map((t: any) => (
              <div key={t.id} className="glass-card p-3 border-tan/25 bg-tan/5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{t.service_name}</div>
                  <div className="text-[10px] text-white/40">
                    {t.room_number ? `${t.room_number}号房` : '未定房'} · {formatMoney(t.price_cents)}
                  </div>
                </div>
                <button
                  onClick={() => startMut.mutate(t.id)}
                  disabled={startMut.isPending}
                  className="bg-tan text-white px-5 py-2.5 min-h-[44px] rounded-lg text-sm disabled:opacity-40 active:scale-[0.97]"
                >接单开钟</button>
              </div>
            ))}
          </div>
        </section>
      )}

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
                <div className="text-xs text-white/50">{activeTicket.service_duration || 0}分钟</div>
              </div>
            </div>
            {/* 进度条 */}
            <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-tan/60 rounded-full transition-all"
                style={{
                  width: (() => {
                    const dur = Number(activeTicket.service_duration) || 0
                    if (dur <= 0) return '0%'
                    const pct = Math.min(100, Math.max(0, ((now - activeTicket.started_at) / (dur * 60000)) * 100))
                    return `${pct}%`
                  })()
                }}
              />
            </div>
            <button
              onClick={() => completeMut.mutate(activeTicket.id)}
              disabled={completeMut.isPending}
              className="mt-3 w-full flex items-center justify-center gap-1.5 bg-moss/80 text-white py-2.5 rounded-lg text-sm disabled:opacity-40"
            >
              <CheckCircle2 size={16} /> 完成下钟
            </button>
          </div>
        </section>
      ) : (
        <div className="glass-card p-6 text-center text-white/30 text-sm">
          {techStatus === 'break' ? '休息中' : techStatus === 'off' ? '已下班' : '当前无服务，等待派钟'}
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
