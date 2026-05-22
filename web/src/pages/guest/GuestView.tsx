import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, formatElapsed } from '@/lib/utils'
import { Clock, Plus, User } from 'lucide-react'
import { useState } from 'react'

// 顾客端：扫码查看当前服务 + 加钟
// URL: /guest/:ticketId
export default function GuestView() {
  const { ticketId } = useParams()
  const queryClient = useQueryClient()
  const [showAddService, setShowAddService] = useState(false)

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => get(`/api/tickets?limit=200`).then(
      (list: any[]) => list.find(t => t.id === ticketId) || null
    ),
    refetchInterval: 5000,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => get('/api/services?active=1'),
  })

  const addTicket = useMutation({
    mutationFn: (serviceId: string) => {
      const svc = services.find((s: any) => s.id === serviceId)
      return post('/api/tickets', {
        shop_id: ticket?.shop_id,
        service_id: serviceId,
        technician_id: ticket?.technician_id,
        room_id: ticket?.room_id,
        customer_id: ticket?.customer_id,
        auto_start: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
      setShowAddService(false)
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40">加载中...</div>
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="text-white/40">未找到该服务记录</div>
          <div className="text-xs text-white/20">请确认二维码是否正确</div>
        </div>
      </div>
    )
  }

  const progress = ticket.started_at
    ? Math.min(100, ((Date.now() - ticket.started_at) / (ticket.service_duration * 60000)) * 100)
    : 0

  return (
    <div className="min-h-screen max-w-md mx-auto p-4 space-y-4">
      {/* 品牌头 */}
      <div className="text-center py-4">
        <h1 className="font-display text-2xl text-tan">足韵</h1>
        <p className="text-xs text-white/30 mt-1">您的服务正在进行中</p>
      </div>

      {/* 服务信息卡 */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-tan/20 flex items-center justify-center">
            <User size={20} className="text-tan" />
          </div>
          <div>
            <div className="font-medium">{ticket.technician_name || '技师'}</div>
            <div className="text-xs text-white/40">
              {ticket.technician_number && `${ticket.technician_number}号 · `}{ticket.service_name}
            </div>
          </div>
        </div>

        {/* 进度 */}
        {ticket.status === 'active' && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-white/40">
              <span className="flex items-center gap-1"><Clock size={12} /> {formatElapsed(ticket.started_at)}</span>
              <span>{ticket.service_duration}分钟</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-tan/60 to-tan rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {ticket.status === 'paid' && (
          <div className="text-center py-2 text-moss text-sm">服务已完成，感谢光临</div>
        )}

        <div className="flex justify-between text-sm pt-2 border-t border-white/5">
          <span className="text-white/40">费用</span>
          <span className="text-tan">{formatMoney(ticket.price_cents)}</span>
        </div>
        {ticket.room_number && (
          <div className="flex justify-between text-sm">
            <span className="text-white/40">房间</span>
            <span>{ticket.room_number}号 {ticket.room_type}</span>
          </div>
        )}
      </div>

      {/* 加钟按钮 */}
      {ticket.status === 'active' && !showAddService && (
        <button
          onClick={() => setShowAddService(true)}
          className="w-full glass-card p-4 flex items-center justify-center gap-2 text-sm text-tan hover:border-tan/30 active:scale-[0.97]"
        >
          <Plus size={16} />
          加钟 / 加项目
        </button>
      )}

      {/* 加钟选择 */}
      {showAddService && (
        <div className="space-y-2">
          <h3 className="text-sm text-white/50">选择加钟项目</h3>
          <div className="grid grid-cols-2 gap-2">
            {services.map((s: any) => (
              <button
                key={s.id}
                onClick={() => addTicket.mutate(s.id)}
                disabled={addTicket.isPending}
                className="glass-card p-3 text-left active:scale-[0.97] hover:border-tan/20"
              >
                <div className="text-sm">{s.name}</div>
                <div className="text-[10px] text-white/30">{s.duration}分钟</div>
                <div className="text-xs text-tan mt-1">{formatMoney(s.price_cents)}</div>
              </button>
            ))}
          </div>
          <button onClick={() => setShowAddService(false)} className="w-full text-xs text-white/30 py-2">取消</button>
        </div>
      )}
    </div>
  )
}
