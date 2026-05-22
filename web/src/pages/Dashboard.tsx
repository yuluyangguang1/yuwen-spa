import { useQuery } from '@tanstack/react-query'
import { Clock, Users, DollarSign, Activity } from 'lucide-react'

// 今日台面看板 —— 核心首屏
// 设计理念：一眼看清"现在谁在忙、哪个房间空、今天赚了多少"
export default function Dashboard() {
  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => fetch('/api/tickets/today').then(r => r.json()),
    refetchInterval: 5000, // 5 秒轮询（WebSocket 接入后改为实时推送）
  })

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => fetch('/api/technicians').then(r => r.json()),
  })

  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => fetch('/api/rooms').then(r => r.json()),
  })

  // 统计
  const activeTickets = tickets.filter((t: any) => t.status === 'active')
  const paidTickets = tickets.filter((t: any) => t.status === 'paid')
  const todayRevenue = paidTickets.reduce((s: number, t: any) => s + t.price_cents, 0)
  const busyTechs = technicians.filter((t: any) => t.status === 'working')

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 顶部统计卡片 - Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Activity} label="进行中" value={activeTickets.length} unit="钟" color="text-tan" />
        <StatCard icon={Users} label="在岗技师" value={`${busyTechs.length}/${technicians.length}`} color="text-moss" />
        <StatCard icon={Clock} label="今日完成" value={paidTickets.length} unit="单" color="text-tan-light" />
        <StatCard icon={DollarSign} label="今日营收" value={formatMoney(todayRevenue)} color="text-gold" />
      </div>

      {/* 房间状态看板 */}
      <section>
        <h2 className="text-lg font-medium mb-3 text-white/80">房间状态</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {rooms.map((room: any) => {
            const ticket = activeTickets.find((t: any) => t.room_id === room.id)
            const isOccupied = room.status === 'occupied' || !!ticket
            return (
              <div
                key={room.id}
                className={`glass-card p-4 transition-all ${
                  isOccupied
                    ? 'border-tan/30 bg-tan/5'
                    : 'border-white/5 hover:border-white/15'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-medium">{room.number}号</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    isOccupied ? 'bg-tan/20 text-tan' : 'bg-white/5 text-white/40'
                  }`}>
                    {isOccupied ? '使用中' : '空闲'}
                  </span>
                </div>
                <div className="text-xs text-white/40">{room.type}</div>
                {ticket && (
                  <div className="mt-2 pt-2 border-t border-white/5 text-xs space-y-1">
                    <div className="text-white/70">{ticket.service_name}</div>
                    <div className="text-white/50">技师: {ticket.technician_name || '-'}</div>
                    <div className="text-tan/80">{formatElapsed(ticket.started_at)}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* 技师状态 */}
      <section>
        <h2 className="text-lg font-medium mb-3 text-white/80">技师状态</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {technicians.map((tech: any) => (
            <div key={tech.id} className="glass-card p-3 text-center">
              <div className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-sm font-medium ${
                tech.status === 'working' ? 'bg-tan/20 text-tan' :
                tech.status === 'break' ? 'bg-gold/20 text-gold' :
                'bg-white/5 text-white/50'
              }`}>
                {tech.number}
              </div>
              <div className="mt-1.5 text-xs text-white/70 truncate">{tech.name}</div>
              <div className={`text-[10px] mt-0.5 ${
                tech.status === 'working' ? 'text-tan' :
                tech.status === 'break' ? 'text-gold' :
                'text-white/30'
              }`}>
                {statusLabel(tech.status)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, unit, color }: any) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color || 'text-white/40'} />
        <span className="text-xs text-white/50">{label}</span>
      </div>
      <div className={`text-2xl font-medium ${color || ''}`}>
        {value}
        {unit && <span className="text-sm text-white/40 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

function formatMoney(cents: number) {
  return `¥${(cents / 100).toFixed(0)}`
}

function formatElapsed(startedAt: number | null) {
  if (!startedAt) return ''
  const mins = Math.floor((Date.now() - startedAt) / 60000)
  return `已 ${mins} 分钟`
}

function statusLabel(s: string) {
  switch (s) {
    case 'working': return '服务中'
    case 'break': return '休息'
    case 'off': return '下班'
    default: return '空闲'
  }
}
