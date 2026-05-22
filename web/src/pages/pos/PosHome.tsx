import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatElapsed, statusLabel } from '@/lib/utils'
import { Activity, Users } from 'lucide-react'

// 收银台首屏：今日台面一览（房间 + 正在进行的钟）
export default function PosHome() {
  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today'),
    refetchInterval: 5000,
  })
  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms'),
  })
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })

  const activeTickets = tickets.filter((t: any) => t.status === 'active')
  const busyTechs = technicians.filter((t: any) => t.status === 'working')

  return (
    <div className="p-4 space-y-4">
      {/* 快速统计 */}
      <div className="flex gap-3">
        <div className="glass-card px-4 py-2 flex items-center gap-2">
          <Activity size={16} className="text-tan" />
          <span className="text-sm">{activeTickets.length} 钟进行中</span>
        </div>
        <div className="glass-card px-4 py-2 flex items-center gap-2">
          <Users size={16} className="text-moss" />
          <span className="text-sm">{busyTechs.length}/{technicians.length} 技师在岗</span>
        </div>
      </div>

      {/* 房间网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {rooms.map((room: any) => {
          const ticket = activeTickets.find((t: any) => t.room_id === room.id)
          const occupied = !!ticket
          return (
            <div
              key={room.id}
              className={`glass-card p-4 min-h-[120px] flex flex-col justify-between transition-all cursor-pointer active:scale-[0.97] ${
                occupied ? 'border-tan/30 bg-tan/5' : 'hover:border-white/15'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{room.number}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  occupied ? 'bg-tan/20 text-tan' : 'bg-white/5 text-white/30'
                }`}>
                  {occupied ? '使用中' : '空闲'}
                </span>
              </div>
              <div className="text-[10px] text-white/30 mt-1">{room.type}</div>
              {ticket ? (
                <div className="mt-auto pt-2 border-t border-white/5 space-y-0.5">
                  <div className="text-xs text-white/70 truncate">{ticket.service_name}</div>
                  <div className="text-[10px] text-white/50">
                    {ticket.technician_number ? `${ticket.technician_number}号 ${ticket.technician_name}` : '未派技师'}
                  </div>
                  <div className="text-[10px] text-tan">{formatElapsed(ticket.started_at)}</div>
                </div>
              ) : (
                <div className="mt-auto text-[10px] text-white/20">点击开钟</div>
              )}
            </div>
          )
        })}
      </div>

      {/* 技师快速状态 */}
      <section>
        <h3 className="text-sm text-white/50 mb-2">技师状态</h3>
        <div className="flex flex-wrap gap-2">
          {technicians.map((t: any) => (
            <div key={t.id} className={`glass-card px-3 py-2 flex items-center gap-2 text-xs ${
              t.status === 'working' ? 'border-tan/20' : ''
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                t.status === 'working' ? 'bg-tan' :
                t.status === 'break' ? 'bg-gold' :
                t.status === 'off' ? 'bg-cinnabar/50' : 'bg-white/20'
              }`} />
              <span className="text-white/70">{t.number}号 {t.name}</span>
              <span className="text-white/30">{statusLabel(t.status)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
