// 客服实时看板
//
// 全场一目了然：技师状态、房间状态、当前钟单、今日统计
// 实时刷新（WebSocket + 10s 轮询兜底）

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { useRealtime } from '@/lib/realtime'
import { formatMoney, formatElapsed, statusLabel } from '@/lib/utils'
import { StatsSkeleton, TableSkeleton } from '@/components/LoadingSkeleton'

export default function AdminDashboard() {
  const qc = useQueryClient()

  // WebSocket 实时刷新
  useRealtime({
    'ticket:created': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:updated': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'ticket:paid': () => qc.invalidateQueries({ queryKey: ['live'] }),
    'technician:updated': () => qc.invalidateQueries({ queryKey: ['live'] }),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['live'],
    queryFn: () => get('/api/dashboard/live'),
    refetchInterval: 10000,
  })

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

  const techs = data?.techs || []
  const rooms = data?.rooms || []
  const stats = data?.stats || { total: 0, active: 0, paid: 0, pending: 0, revenue: 0 }

  const idleTechs = techs.filter((t: any) => t.status === 'idle')
  const workingTechs = techs.filter((t: any) => t.status === 'working')
  const idleRooms = rooms.filter((r: any) => r.status === 'idle')
  const occupiedRooms = rooms.filter((r: any) => r.status === 'occupied')

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* 今日概览 */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="进行中" value={stats.active} color="text-tan" />
        <StatCard label="已结账" value={stats.paid} color="text-moss" />
        <StatCard label="等待中" value={stats.pending} color="text-white/60" />
        <StatCard label="营收" value={formatMoney(stats.revenue)} color="text-tan" />
      </div>

      {/* 技师状态 */}
      <section>
        <h2 className="text-sm text-white/50 mb-3 flex items-center gap-2">
          技师状态
          <span className="text-[10px] text-white/25">空闲 {idleTechs.length} · 服务中 {workingTechs.length}</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {techs.map((t: any) => (
            <TechCard key={t.id} tech={t} />
          ))}
        </div>
      </section>

      {/* 房间状态 */}
      <section>
        <h2 className="text-sm text-white/50 mb-3 flex items-center gap-2">
          房间状态
          <span className="text-[10px] text-white/25">空闲 {idleRooms.length} · 使用中 {occupiedRooms.length}</span>
        </h2>
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {rooms.map((r: any) => (
            <RoomCard key={r.id} room={r} />
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div className="glass-card p-3 text-center">
      <div className="text-xs text-white/40">{label}</div>
      <div className={`text-xl font-medium mt-1 ${color}`}>{value}</div>
    </div>
  )
}

function TechCard({ tech }: { tech: any }) {
  const isWorking = tech.status === 'working'
  const isIdle = tech.status === 'idle'

  return (
    <div className={`glass-card p-3 ${isWorking ? 'border-tan/30 bg-tan/5' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
          isWorking ? 'bg-tan/20 text-tan' : 'bg-white/5 text-white/40'
        }`}>
          {tech.number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{tech.name}</div>
          <div className="text-[10px] text-white/30">{tech.level}</div>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          isWorking ? 'bg-tan/15 text-tan' :
          isIdle ? 'bg-moss/15 text-moss' :
          'bg-white/5 text-white/30'
        }`}>
          {statusLabel(tech.status)}
        </span>
      </div>

      {isWorking && tech.ticket_id && (
        <div className="text-xs text-white/50 space-y-0.5">
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
                width: `${Math.min(100, ((Date.now() - tech.started_at) / (tech.service_duration * 60000)) * 100)}%`
              }}
            />
          </div>
        </div>
      )}

      {isIdle && (
        <div className="text-[10px] text-moss/60 mt-1">等待派钟</div>
      )}
    </div>
  )
}

function RoomCard({ room }: { room: any }) {
  const isOccupied = room.status === 'occupied'

  return (
    <div className={`glass-card p-2.5 text-center ${isOccupied ? 'border-tan/30 bg-tan/5' : ''}`}>
      <div className={`text-lg font-bold ${isOccupied ? 'text-tan' : 'text-white/30'}`}>
        {room.number}
      </div>
      <div className="text-[10px] text-white/30">{room.type}</div>

      {isOccupied ? (
        <div className="mt-1 space-y-0.5">
          <div className="text-[10px] text-tan truncate">{room.tech_name}</div>
          <div className="text-[10px] text-white/30 truncate">{room.service_name}</div>
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-moss/50">空闲</div>
      )}
    </div>
  )
}
