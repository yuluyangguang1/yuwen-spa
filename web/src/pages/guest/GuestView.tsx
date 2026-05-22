import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, formatElapsed } from '@/lib/utils'
import { Clock, User, Check, Plus, Star } from 'lucide-react'
import { useState } from 'react'
import TechProfile from '@/components/TechProfile'

// 顾客端：扫房间二维码进入
// URL: /guest/room/:roomId
//
// 两种状态：
// 1. 房间空闲 → 显示技师选择 → 选项目 → 下单
// 2. 房间使用中 → 显示当前服务进度 + 加钟按钮
export default function GuestView() {
  const { roomId } = useParams()
  const queryClient = useQueryClient()

  const { data: room } = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => get('/api/rooms').then((list: any[]) => list.find(r => r.id === roomId) || null),
  })

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today'),
    refetchInterval: 5000,
  })

  // 当前房间正在进行的钟
  const activeTicket = tickets.find((t: any) => t.room_id === roomId && t.status === 'active')

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center text-white/40">
          <div className="text-lg mb-2">未找到该房间</div>
          <div className="text-xs text-white/20">请确认二维码是否正确</div>
        </div>
      </div>
    )
  }

  // 房间有正在进行的服务 → 显示服务进度
  if (activeTicket) {
    return <GuestActiveView ticket={activeTicket} room={room} />
  }

  // 房间空闲 → 选技师 + 选项目
  return <GuestSelectView room={room} />
}

// ─── 空闲状态：选技师 + 选项目 ─────────────────────────────
function GuestSelectView({ room }: { room: any }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'tech' | 'service' | 'confirm'>('tech')
  const [selectedTech, setSelectedTech] = useState<any>(null)
  const [selectedService, setSelectedService] = useState<any>(null)
  const [success, setSuccess] = useState(false)
  const [previewTechId, setPreviewTechId] = useState<string | null>(null)

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?active=1'),
  })

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => get('/api/services?active=1'),
  })

  const { data: shop } = useQuery({
    queryKey: ['shop'],
    queryFn: () => get('/api/shops/current'),
  })

  // 按 AI 评分排序（高分靠前）
  const sortedTechs = [...technicians].sort((a: any, b: any) => (b.ai_score || 0) - (a.ai_score || 0))
  const idleTechs = sortedTechs.filter((t: any) => t.status === 'idle')
  const busyTechs = sortedTechs.filter((t: any) => t.status === 'working')

  const createTicket = useMutation({
    mutationFn: () => post('/api/tickets', {
      shop_id: shop?.id,
      service_id: selectedService?.id,
      technician_id: selectedTech?.id || undefined,
      room_id: room.id,
      auto_start: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
      setSuccess(true)
    },
  })

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-moss/20 flex items-center justify-center">
            <Check size={32} className="text-moss" />
          </div>
          <div className="text-lg text-moss">下单成功</div>
          <div className="text-sm text-white/40">
            {selectedTech ? `${selectedTech.name} 技师即将为您服务` : '技师即将为您服务'}
          </div>
          <div className="text-xs text-white/20">页面将自动刷新显示服务进度</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen max-w-md mx-auto p-4 space-y-4">
      {/* 品牌头 + 房间信息 */}
      <div className="text-center py-3">
        <h1 className="font-display text-2xl text-tan">足韵</h1>
        <p className="text-xs text-white/30 mt-1">{room.number}号{room.type} · 欢迎光临</p>
      </div>

      {/* Step 1: 选技师 */}
      {step === 'tech' && (
        <div className="space-y-3">
          <h2 className="text-sm text-white/60 text-center">请选择您的技师</h2>

          {/* 空闲技师 */}
          {idleTechs.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-white/30 px-1">可选技师（按评分排序）</div>
              <div className="grid grid-cols-2 gap-3">
                {idleTechs.map((tech: any) => (
                  <button
                    key={tech.id}
                    onClick={() => setPreviewTechId(tech.id)}
                    className="glass-card p-4 text-center active:scale-[0.97] hover:border-tan/30 transition-all"
                  >
                    <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-tan/20 to-tan/5 flex items-center justify-center mb-2">
                      <span className="text-xl font-bold text-tan">{tech.number}</span>
                    </div>
                    <div className="font-medium">{tech.name}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{tech.level || '技师'}{tech.years ? ` · ${tech.years}年` : ''}</div>
                    {/* 评分 */}
                    <div className="flex items-center justify-center gap-1 mt-1.5">
                      <Star size={10} className="text-tan fill-tan" />
                      <span className="text-xs text-tan">{tech.ai_score || tech.avg_rating || '-'}</span>
                      {tech.review_count > 0 && (
                        <span className="text-[10px] text-white/30">({tech.review_count}评)</span>
                      )}
                    </div>
                    <div className="mt-2 text-[10px] px-2 py-0.5 rounded-full bg-moss/15 text-moss inline-block">
                      空闲
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 技师详情预览弹窗 */}
          {previewTechId && (
            <TechProfile
              techId={previewTechId}
              onClose={() => setPreviewTechId(null)}
              onSelect={() => {
                const tech = technicians.find((t: any) => t.id === previewTechId)
                setSelectedTech(tech)
                setPreviewTechId(null)
                setStep('service')
              }}
            />
          )}

          {/* 忙碌技师（灰显） */}
          {busyTechs.length > 0 && (
            <div className="space-y-2 mt-4">
              <div className="text-xs text-white/20 px-1">服务中（需等待）</div>
              <div className="grid grid-cols-3 gap-2">
                {busyTechs.map((tech: any) => (
                  <div key={tech.id} className="glass-card p-3 text-center opacity-50">
                    <div className="w-10 h-10 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-1">
                      <span className="text-sm font-bold text-white/30">{tech.number}</span>
                    </div>
                    <div className="text-xs text-white/30">{tech.name}</div>
                    <div className="text-[10px] text-tan/50">服务中</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 不指定技师 */}
          <button
            onClick={() => { setSelectedTech(null); setStep('service') }}
            className="w-full glass-card p-3 text-center text-sm text-white/40 hover:text-white/60 mt-4"
          >
            不指定技师，由前台安排
          </button>
        </div>
      )}

      {/* Step 2: 选项目 */}
      {step === 'service' && (
        <div className="space-y-3">
          {selectedTech && (
            <div className="glass-card p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-tan/20 flex items-center justify-center text-tan font-bold">
                {selectedTech.number}
              </div>
              <div>
                <div className="text-sm font-medium">{selectedTech.name}</div>
                <div className="text-[10px] text-white/40">{selectedTech.level}</div>
              </div>
              <button onClick={() => setStep('tech')} className="ml-auto text-xs text-white/30">换一位</button>
            </div>
          )}

          <h2 className="text-sm text-white/60 text-center">请选择服务项目</h2>
          <div className="space-y-2">
            {services.map((svc: any) => (
              <button
                key={svc.id}
                onClick={() => { setSelectedService(svc); setStep('confirm') }}
                className="w-full glass-card p-4 flex items-center justify-between active:scale-[0.98] hover:border-tan/20 transition-all"
              >
                <div className="text-left">
                  <div className="font-medium">{svc.name}</div>
                  <div className="text-xs text-white/40 mt-0.5">{svc.category} · {svc.duration}分钟</div>
                </div>
                <div className="text-tan text-lg font-medium">{formatMoney(svc.price_cents)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: 确认 */}
      {step === 'confirm' && selectedService && (
        <div className="space-y-4">
          <h2 className="text-sm text-white/60 text-center">确认下单</h2>
          <div className="glass-card p-5 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-white/50">房间</span>
              <span>{room.number}号 {room.type}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/50">技师</span>
              <span>{selectedTech ? `${selectedTech.number}号 ${selectedTech.name}` : '由前台安排'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/50">项目</span>
              <span>{selectedService.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/50">时长</span>
              <span>{selectedService.duration} 分钟</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-white/5">
              <span className="text-white/50">费用</span>
              <span className="text-2xl text-tan font-medium">{formatMoney(selectedService.price_cents)}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('service')}
              className="flex-1 glass-card py-3 text-center text-sm text-white/40"
            >
              返回
            </button>
            <button
              onClick={() => createTicket.mutate()}
              disabled={createTicket.isPending}
              className="flex-1 bg-tan text-white py-3 rounded-xl text-sm font-medium active:scale-[0.97] disabled:opacity-50"
            >
              {createTicket.isPending ? '下单中...' : '确认下单'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 使用中状态：显示服务进度 + 加钟 ────────────────────────
function GuestActiveView({ ticket, room }: { ticket: any; room: any }) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => get('/api/services?active=1'),
  })

  const { data: shop } = useQuery({
    queryKey: ['shop'],
    queryFn: () => get('/api/shops/current'),
  })

  const addTicket = useMutation({
    mutationFn: (serviceId: string) => post('/api/tickets', {
      shop_id: shop?.id,
      service_id: serviceId,
      technician_id: ticket.technician_id,
      room_id: room.id,
      customer_id: ticket.customer_id,
      auto_start: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
      setShowAdd(false)
    },
  })

  const progress = ticket.started_at
    ? Math.min(100, ((Date.now() - ticket.started_at) / (ticket.service_duration * 60000)) * 100)
    : 0

  return (
    <div className="min-h-screen max-w-md mx-auto p-4 space-y-4">
      <div className="text-center py-3">
        <h1 className="font-display text-2xl text-tan">足韵</h1>
        <p className="text-xs text-white/30 mt-1">{room.number}号{room.type}</p>
      </div>

      {/* 技师信息 */}
      <div className="glass-card p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-tan/20 to-tan/5 flex items-center justify-center">
          <User size={24} className="text-tan" />
        </div>
        <div>
          <div className="font-medium text-lg">{ticket.technician_name || '技师'}</div>
          <div className="text-xs text-white/40">
            {ticket.technician_number && `${ticket.technician_number}号 · `}
            正在为您服务
          </div>
        </div>
      </div>

      {/* 服务进度 */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-medium">{ticket.service_name}</span>
          <span className="text-sm text-tan">{formatMoney(ticket.price_cents)}</span>
        </div>
        <div className="flex justify-between text-xs text-white/40">
          <span className="flex items-center gap-1"><Clock size={12} /> {formatElapsed(ticket.started_at)}</span>
          <span>共 {ticket.service_duration} 分钟</span>
        </div>
        <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-tan/60 to-tan rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
        {progress >= 90 && (
          <div className="text-xs text-tan/80 text-center">即将完成</div>
        )}
      </div>

      {/* 加钟 */}
      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full glass-card p-4 flex items-center justify-center gap-2 text-sm text-tan hover:border-tan/30 active:scale-[0.97]"
        >
          <Plus size={16} />
          加钟 / 加项目
        </button>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm text-white/50">选择加钟项目</h3>
          <div className="space-y-2">
            {services.map((s: any) => (
              <button
                key={s.id}
                onClick={() => addTicket.mutate(s.id)}
                disabled={addTicket.isPending}
                className="w-full glass-card p-3 flex justify-between items-center active:scale-[0.98] hover:border-tan/20"
              >
                <div>
                  <div className="text-sm">{s.name}</div>
                  <div className="text-[10px] text-white/30">{s.duration}分钟</div>
                </div>
                <span className="text-tan">{formatMoney(s.price_cents)}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowAdd(false)} className="w-full text-xs text-white/30 py-2">取消</button>
        </div>
      )}

      <div className="text-center text-[10px] text-white/15 pt-4">
        服务结束后请至前台结账
      </div>
    </div>
  )
}
