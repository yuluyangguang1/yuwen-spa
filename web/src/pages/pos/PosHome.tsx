import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, post } from '@/lib/api'
import { formatElapsed, statusLabel, formatMoney } from '@/lib/utils'
import { Activity, Users, ScanLine } from 'lucide-react'
import { RoomCardSkeleton } from '@/components/LoadingSkeleton'

// 收银台首屏：今日台面一览（房间 + 正在进行的钟）
export default function PosHome() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today?pageSize=500'),
    refetchInterval: 5000,
  })
  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms?pageSize=500'),
  })
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })

  const isLoading = ticketsLoading || roomsLoading

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex gap-3">
          <div className="h-10 w-48 animate-pulse bg-[#2a2a29] rounded-lg" />
          <div className="h-10 w-48 animate-pulse bg-[#2a2a29] rounded-lg" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <RoomCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  const activeTickets = tickets.filter((t: any) => t.status === 'active')
  const busyTechs = technicians.filter((t: any) => t.status === 'working')
  // 顾客扫码自助/自提：待前台确认的 self 单
  const selfOrders = tickets.filter((t: any) => t.fulfillment === 'self' && (t.status === 'pending' || t.status === 'active'))
  const selfPending = selfOrders.filter((t: any) => t.status === 'pending')

  const acceptSelf = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tickets-today'] }),
  })
  const cancelSelf = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tickets-today'] }),
  })

  return (
    <div className="p-4 space-y-4">
      {/* 快速统计 */}
      <div className="flex gap-3 flex-wrap">
        <div className="glass-card px-4 py-2 flex items-center gap-2">
          <Activity size={16} className="text-tan" />
          <span className="text-sm">{activeTickets.length} 钟进行中</span>
        </div>
        <div className="glass-card px-4 py-2 flex items-center gap-2">
          <Users size={16} className="text-moss" />
          <span className="text-sm">{busyTechs.length}/{technicians.length} 技师在岗</span>
        </div>
        {selfOrders.length > 0 && (
          <div className="glass-card px-4 py-2 flex items-center gap-2 border-tan/20">
            <ScanLine size={16} className="text-tan" />
            <span className="text-sm">自助/自提 {selfOrders.length}</span>
            {selfPending.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-tan/20 text-tan">{selfPending.length} 待确认</span>
            )}
          </div>
        )}
      </div>

      {/* 顾客自助/自提订单队列 */}
      {selfOrders.length > 0 && (
        <section>
          <h3 className="text-sm text-white/50 mb-2 flex items-center gap-1.5">
            <ScanLine size={14} className="text-tan" /> 顾客自助下单（自提）
          </h3>
          <div className="space-y-2">
            {selfOrders.map((t: any) => (
              <div key={t.id} className="glass-card p-3 flex items-center justify-between gap-3 border-tan/20">
                <div className="min-w-0">
                  <div className="text-sm truncate">{t.service_name}</div>
                  <div className="text-[10px] text-white/40">
                    {t.room_number ? `${t.room_number}号房 · ` : '到店自提 · '}
                    {t.technician_number ? `${t.technician_number}号${t.technician_name}` : '未派技师'} · {formatMoney(t.price_cents)}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] ${t.status === 'pending' ? 'text-tan' : 'text-white/40'}`}>
                    {statusLabel(t.status)}
                  </span>
                  {t.status === 'pending' && (
                    <>
                      <button
                        onClick={() => acceptSelf.mutate(t.id)}
                        disabled={acceptSelf.isPending}
                        className="bg-tan text-white px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                      >接单</button>
                      <button
                        onClick={() => cancelSelf.mutate(t.id)}
                        disabled={cancelSelf.isPending}
                        className="bg-white/5 text-white/40 px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                      >取消</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 房间网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {rooms.map((room: any) => {
          const ticket = activeTickets.find((t: any) => t.room_id === room.id)
          const occupied = !!ticket
          return (
            <div
              key={room.id}
              onClick={() => { if (!occupied) navigate('/pos/new', { state: { room_id: room.id } }) }}
              role={occupied ? undefined : 'button'}
              tabIndex={occupied ? undefined : 0}
              onKeyDown={(e) => {
                if (!occupied && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  navigate('/pos/new', { state: { room_id: room.id } })
                }
              }}
              className={`glass-card p-4 min-h-[120px] flex flex-col justify-between transition-all ${
                occupied ? 'border-tan/30 bg-tan/5' : 'cursor-pointer hover:border-white/15 active:scale-[0.97]'
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
                <div className="mt-auto text-[10px] text-white/40">点击开钟</div>
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
