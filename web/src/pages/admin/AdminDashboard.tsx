// 客服实时看板
//
// 全场一目了然：技师状态、房间状态、当前钟单、今日统计
// 实时刷新（WebSocket + 10s 轮询兜底）

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { useRealtime } from '@/lib/realtime'
import { formatMoney, formatElapsed, statusLabel } from '@/lib/utils'
import { StatsSkeleton, TableSkeleton } from '@/components/LoadingSkeleton'
import { AlertTriangle } from 'lucide-react'

export default function AdminDashboard() {
  const qc = useQueryClient()

  // WebSocket 实时刷新
  useRealtime({
    'ticket:created': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:updated': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:assigned': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:active': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:completed': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:canceled': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:paid': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'technician:updated': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'room:updated': () => qc.invalidateQueries({ queryKey: ['live'] }),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['live'],
    queryFn: () => get('/api/dashboard/live?pageSize=500'),
    refetchInterval: 10000,
  })

  const { data: queueData } = useQuery({
    queryKey: ['ticket-queue'],
    queryFn: () => get('/api/tickets/queue').then((r: any) => r?.data || r || []),
    refetchInterval: 10000,
  })

  const { data: anomalyData } = useQuery({
    queryKey: ['ai-anomalies'],
    queryFn: () => get('/api/ai/anomalies'),
    refetchInterval: 60000,
  })
  const anomalies: any[] = anomalyData?.anomalies || []
  const highAnomalies = anomalies.filter(a => a.severity === 'high')

  const techs = data?.techs || []
  const rooms = data?.rooms || []
  const stats = data?.stats || { total: 0, active: 0, paid: 0, pending: 0, revenue: 0 }
  const queueList: any[] = Array.isArray(queueData) ? queueData : []

  const idleTechs = useMemo(() => techs.filter((t: any) => t.status === 'idle'), [techs])
  const workingTechs = useMemo(() => techs.filter((t: any) => t.status === 'working'), [techs])
  const idleRooms = useMemo(() => rooms.filter((r: any) => r.status === 'idle'), [rooms])
  const occupiedRooms = useMemo(() => rooms.filter((r: any) => r.status === 'occupied'), [rooms])

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <StatsSkeleton />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          <TableSkeleton rows={4} />
        </div>
        <TableSkeleton rows={6} />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* 异常提醒 */}
      {anomalies.length > 0 && (
        <div className={`glass-card p-3 border ${
          highAnomalies.length ? 'border-cinnabar/30 bg-cinnabar/5' : 'border-amber-300/20'
        }`} role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <AlertTriangle size={14} className={highAnomalies.length ? 'text-cinnabar' : 'text-amber-300'} />
            异常检测
            <span className="text-[10px] text-white/40 font-normal">{anomalies.length} 项</span>
          </div>
          <ul className="space-y-1">
            {anomalies.slice(0, 3).map((a, i) => (
              <li key={i} className="text-xs text-white/60 flex gap-2">
                <span className={a.severity === 'high' ? 'text-cinnabar' : 'text-amber-300'}>
                  {a.severity === 'high' ? '●' : '○'}
                </span>
                <span>{a.title} — {a.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 今日概览 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="进行中" value={stats.active} color="text-tan" idx={0} />
        <StatCard label="已结账" value={stats.paid} color="text-moss" idx={1} />
        <StatCard label="等待中" value={stats.pending} color="text-white/60" idx={2} />
        <StatCard label="待派钟" value={queueList.length} color={queueList.length > 0 ? 'text-amber-300' : 'text-white/60'} idx={3} />
        <StatCard label="营收" value={formatMoney(stats.revenue)} color="text-tan" idx={4} />
      </div>

      {/* 技师 + 房间并排：各区内滚动，避免整页横向拥挤 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <section aria-labelledby="tech-status-heading">
          <h2 id="tech-status-heading" className="text-lg text-white/50 mb-3 flex items-center gap-2">
            技师状态
            <span className="text-[10px] text-white/50">空闲 {idleTechs.length} · 服务中 {workingTechs.length}</span>
          </h2>
          {/* 区内仅半宽，最多 3 列保证姓名/等级不挤成省略号 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
            {techs.map((t: any, i: number) => (
              <TechCard key={t.id} tech={t} style={{ animationDelay: `${Math.min(i * 60, 600)}ms` }} />
            ))}
          </div>
        </section>

        <section aria-labelledby="room-status-heading">
          <h2 id="room-status-heading" className="text-lg text-white/50 mb-3 flex items-center gap-2">
            房间状态
            <span className="text-[10px] text-white/50">空闲 {idleRooms.length} · 使用中 {occupiedRooms.length}</span>
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2 max-h-[60vh] overflow-y-auto pr-1">
            {rooms.map((r: any, i: number) => (
              <RoomCard key={r.id} room={r} style={{ animationDelay: `${Math.min(i * 60, 600)}ms` }} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, color, idx = 0 }: { label: string; value: any; color: string; idx?: number }) {
  const display = useCountUp(value)
  return (
    <div className="glass-card p-3 text-center rise-in" style={{ animationDelay: `${idx * 60}ms` }}>
      <div className="text-xs text-white/40">{label}</div>
      <div className={`text-xl font-medium mt-1 ${color}`} aria-label={`${label}：${value}`}>{display}</div>
    </div>
  )
}

// 数字滚动（Anime.js 式 ease-out 计数，纯 rAF 零依赖；减弱动效时直出终值）
function useCountUp(target: any, ms = 650) {
  const isNum = typeof target === 'number' && Number.isFinite(target)
  const [shown, setShown] = useState<any>(target)
  const prevRef = useRef<any>(target)

  useEffect(() => {
    if (!isNum) { setShown(target); prevRef.current = target; return }
    const from = typeof prevRef.current === 'number' ? prevRef.current : 0
    const to = target as number
    if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(to); prevRef.current = to; return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(from + (to - from) * e))
      if (p < 1) raf = requestAnimationFrame(tick)
      else prevRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, isNum, ms])

  return shown
}

function TechCard({ tech, style }: { tech: any; style?: React.CSSProperties }) {
  const isWorking = tech.status === 'working'
  const isIdle = tech.status === 'idle'

  return (
    <div style={style} className={`glass-card p-3 rise-in ${isWorking ? 'border-tan/30 bg-tan/5' : ''}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
          isWorking ? 'bg-tan/20 text-tan' : 'bg-white/5 text-white/40'
        }`}>
          {tech.number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" title={tech.name}>{tech.name}</div>
        </div>
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
          isWorking ? 'bg-tan/15 text-tan' :
          isIdle ? 'bg-moss/15 text-moss' :
          'bg-white/5 text-white/30'
        }`}>
          {statusLabel(tech.status)}
        </span>
      </div>

      <div className="text-[10px] text-white/30 truncate">
        {tech.level}
        {isIdle && <span className="text-moss"> · 等待派钟</span>}
      </div>

      {isWorking && tech.ticket_id && (
        <div className="text-xs text-white/50 space-y-0.5 mt-1.5">
          <div className="flex justify-between">
            <span>{tech.service_name}</span>
            <span className="text-tan">{formatElapsed(tech.started_at)}</span>
          </div>
          <div className="text-[10px] text-white/30">
            {tech.room_number && `${tech.room_number}号${tech.room_type || ''}`}
            {tech.customer_name && ` · ${tech.customer_name}`}
          </div>
          {/* 进度条 */}
          <div className="h-1 bg-white/5 rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-tan/50 rounded-full transition-all"
              style={{
                width: `${Math.min(100, ((Date.now() - tech.started_at) / (tech.service_duration * 60000)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function RoomCard({ room, style }: { room: any; style?: React.CSSProperties }) {
  const isOccupied = room.status === 'occupied'

  return (
    <div style={style} className={`glass-card p-2.5 text-center rise-in ${isOccupied ? 'border-tan/30 bg-tan/5' : ''}`}>
      <div className={`text-lg font-bold ${isOccupied ? 'text-tan' : 'text-white/50'}`}>
        {room.number}
      </div>
      <div className="text-[10px] text-white/30">{room.type}</div>

      {isOccupied ? (
        <div className="mt-1 space-y-0.5">
          <div className="text-[10px] text-tan truncate">{room.tech_name}</div>
          <div className="text-[10px] text-white/30 truncate">{room.service_name}</div>
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-moss">空闲</div>
      )}
    </div>
  )
}
