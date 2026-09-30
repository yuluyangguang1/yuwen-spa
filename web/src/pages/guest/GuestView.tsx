import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, formatElapsed } from '@/lib/utils'
import { Clock, User, Check, Plus, Star, ShoppingBasket, Moon } from 'lucide-react'
import { useState, useEffect, useRef, useCallback, memo, type ReactNode } from 'react'
import { TechProfile } from '@/components/TechProfile'
import { HoloCard } from '@/components/HoloCard'
import { GuestOrderSheet } from '@/components/GuestOrderSheet'
import { ReviewSheet } from '@/components/ReviewSheet'
import { BrandTitle } from '@/components/BrandTitle'
import { notifyEndWarn, notifyEnd, warmupAudio } from '@/lib/notify'

// 过夜睡眠服务附加费（分）— 与后端 guest.js 保持一致
const OVERNIGHT_FEE_CENTS = 3000

// 空闲技师卡片：memo 隔离轮询重渲（props 仅 tech 引用 + 稳定回调）
const IdleTechCard = memo(function IdleTechCard({ tech, onPick }: { tech: any; onPick: (id: string) => void }) {
  return (
    <HoloCard
      src={tech.avatar}
      fallbackNumber={tech.number}
      star={!!tech.is_star}
      onClick={() => onPick(tech.id)}
      ariaLabel={`查看${tech.name}技师详情`}
    >
      <span className="holo-card-no">{tech.number}号</span>
      <span className="holo-card-status">空闲</span>
      <div className="holo-card-name">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xl font-medium text-white">{tech.name}</div>
            <div className="text-xs text-white/60 mt-0.5">
              {tech.level || '技师'}{tech.years ? ` · 从业${tech.years}年` : ''}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Star size={13} className="text-tan fill-tan" />
            <span className="text-sm text-tan font-medium">{tech.ai_score || tech.avg_rating || '-'}</span>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-white/40">
            {tech.review_count > 0 ? `${tech.review_count}条评价` : '新技师'}
          </span>
          <span className="text-[10px] text-tan/80">点击查看详情 →</span>
        </div>
      </div>
    </HoloCard>
  )
})

// 顾客端：扫房间二维码进入
// URL: /guest/room/:roomId
//
// 两种状态：
// 1. 房间空闲 → 显示技师选择 → 选项目 → 下单
// 2. 房间使用中 → 显示当前服务进度 + 加钟按钮
// 服务完成/结账后 → 可评价（reviewed 标记）
export default function GuestView() {
  const { roomId } = useParams()
  const [orderOpen, setOrderOpen] = useState(false)
  const [reviewTicket, setReviewTicket] = useState<any>(null)
  const [dismissed, setDismissed] = useState<string[]>([])

  const { data: room, isLoading: roomLoading } = useQuery({
    queryKey: ['guest-room', roomId],
    queryFn: () => get(`/api/guest/rooms/${roomId}`),
  })

  const { data: tickets = [] } = useQuery({
    queryKey: ['guest-tickets', roomId],
    queryFn: () => get(`/api/guest/tickets?room_id=${roomId}`),
    refetchInterval: 10000,
  })

  // 当前房间正在进行的钟
  const activeTicket = tickets.find((t: any) => t.room_id === roomId && t.status === 'active')
  // 可评价：completed/paid 且有技师、未评价、未点关闭
  const reviewable = tickets.find((t: any) =>
    (t.status === 'completed' || t.status === 'paid') &&
    t.technician_id && !t.reviewed && !dismissed.includes(t.id)
  )

  if (roomLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="text-center text-white/40 animate-pulse text-sm">加载中...</div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="text-center text-white/40">
          <div className="text-lg mb-2">未找到该房间</div>
          <div className="text-xs text-white/20">请确认二维码是否正确</div>
        </div>
      </div>
    )
  }

  // 房间有正在进行或刚下单的服务 → 显示服务进度
  let content: ReactNode
  if (activeTicket) {
    content = <GuestActiveView ticket={activeTicket} room={room} />
  } else {
    // 有顾客自助下单待确认（pending）
    const pendingTicket = tickets.find((t: any) => t.room_id === roomId && t.status === 'pending')
    if (pendingTicket) {
      content = (
        <div className="min-h-[100dvh] flex items-center justify-center p-4">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-tan/20 flex items-center justify-center animate-pulse">
              <Clock size={32} className="text-tan" />
            </div>
            <div className="text-lg text-tan">下单成功，等待接单</div>
            <div className="text-sm text-white/40">{pendingTicket.service_name || '服务'}</div>
            {pendingTicket.overnight ? (
              <div className="text-xs text-moss inline-flex items-center gap-1">
                <Moon size={12} /> 已勾选过夜睡眠服务
              </div>
            ) : null}
            <div className="text-xs text-white/20">前台确认后将为您开钟</div>
          </div>
        </div>
      )
    } else {
      // 房间空闲 → 选技师 + 选项目（顶部可评价横幅）
      content = (
        <div className="space-y-3">
          {reviewable && (
            <div className="glass-card p-4 border-tan/30 bg-tan/5 space-y-2">
              <div className="text-sm text-white/70">
                {reviewable.technician_number ? `${reviewable.technician_number}号 ` : ''}
                {reviewable.technician_name || '技师'} 的服务已完成
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setReviewTicket(reviewable)}
                  className="flex-1 bg-tan text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
                >
                  <Star size={14} /> 评价本次服务
                </button>
                <button
                  onClick={() => setDismissed(prev => [...prev, reviewable.id])}
                  className="px-4 text-xs text-white/40 py-2.5"
                >暂不</button>
              </div>
            </div>
          )}
          <GuestSelectView room={room} />
        </div>
      )
    }
  }

  return (
    <>
      {/* 已完成但未在选技师页时也给入口（例如 completed 且无 pending） */}
      {reviewable && activeTicket && (
        <div className="fixed z-40 left-4 right-4 top-4 sm:max-w-md sm:left-1/2 sm:-translate-x-1/2">
          <button
            onClick={() => setReviewTicket(reviewable)}
            className="w-full glass-card border-tan/40 bg-tan/10 px-4 py-3 text-sm text-tan flex items-center justify-center gap-2 shadow-lg"
          >
            <Star size={14} className="fill-tan" /> 评价 {reviewable.technician_name || '技师'} 的服务
          </button>
        </div>
      )}

      {content}

      {/* 全局点单入口（任意状态可点） */}
      <button
        onClick={() => setOrderOpen(true)}
        aria-label="食物用品点单"
        className="fixed z-40 right-4 bottom-20 sm:bottom-6 flex items-center gap-2 px-4 py-3 rounded-full bg-tan text-white text-sm font-medium shadow-lg shadow-black/40 active:scale-95"
      >
        <ShoppingBasket size={16} />
        点单
      </button>

      {orderOpen && roomId && (
        <GuestOrderSheet roomId={roomId} onClose={() => setOrderOpen(false)} />
      )}

      {reviewTicket && (
        <ReviewSheet
          ticket={reviewTicket}
          onClose={() => {
            setDismissed(prev => [...prev, reviewTicket.id])
            setReviewTicket(null)
          }}
        />
      )}
    </>
  )
}

// ─── 空闲状态：选技师 + 选项目 ─────────────────────────────
function GuestSelectView({ room }: { room: any }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'tech' | 'service' | 'confirm'>('tech')
  const [selectedTech, setSelectedTech] = useState<any>(null)
  const [selectedService, setSelectedService] = useState<any>(null)
  const [overnight, setOvernight] = useState(false)
  const [success, setSuccess] = useState(false)
  const [previewTechId, setPreviewTechId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const pickTech = useCallback((id: string) => setPreviewTechId(id), [])
  const closePreview = useCallback(() => setPreviewTechId(null), [])

  const { data: technicians = [], isLoading: techsLoading } = useQuery({
    queryKey: ['guest-technicians'],
    queryFn: () => get('/api/guest/technicians?active=1&pageSize=500'),
  })

  const confirmPreviewTech = useCallback(() => {
    const tech = technicians.find((t: any) => t.id === previewTechId)
    setSelectedTech(tech)
    setPreviewTechId(null)
    setStep('service')
  }, [technicians, previewTechId])

  const { data: services = [] } = useQuery({
    queryKey: ['guest-services'],
    queryFn: () => get('/api/guest/services?active=1&pageSize=500'),
  })

  const { data: shop } = useQuery({
    queryKey: ['guest-shop'],
    queryFn: () => get('/api/guest/shops/current'),
  })

  // 按 AI 评分排序（高分靠前）
  const sortedTechs = [...technicians].sort((a: any, b: any) => (b.ai_score || 0) - (a.ai_score || 0))
  const idleTechs = sortedTechs.filter((t: any) => t.status === 'idle')
  const busyTechs = sortedTechs.filter((t: any) => t.status === 'working')

  const createTicket = useMutation({
    mutationFn: () => post('/api/guest/tickets', {
      shop_id: shop?.id,
      service_id: selectedService?.id,
      technician_id: selectedTech?.id || undefined,
      room_id: room.id,
      auto_start: false,
      overnight,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-tickets'] })
      queryClient.invalidateQueries({ queryKey: ['guest-technicians'] })
      setSuccess(true)
    },
    onError: (e: any) => {
      setErr(e?.message || '下单失败，请重试')
    },
  })

  if (success) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
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

  const stepIndex = step === 'tech' ? 0 : step === 'service' ? 1 : 2
  const stepDefs = [
    { key: 'tech', label: '选技师' },
    { key: 'service', label: '选项目' },
    { key: 'confirm', label: '确认下单' },
  ] as const

  return (
    <div className="min-h-[100dvh] max-w-md mx-auto p-4 space-y-4">
      {/* 品牌头 + 房间信息 */}
      <div className="text-center py-3">
        <BrandTitle size="xl" shimmer publicPage stack />
        <p className="text-xs text-white/30 mt-1">{room.number}号{room.type} · 欢迎光临</p>
      </div>

      {/* 下单步骤指示（已完成的步骤可点击返回） */}
      <ol className="flex items-center justify-center gap-1" aria-label="下单步骤">
        {stepDefs.map((s, i) => {
          const active = i === stepIndex
          const done = i < stepIndex
          return (
            <li key={s.key} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!done}
                onClick={() => { if (done) setStep(s.key) }}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs min-h-[32px] transition-colors ${
                  active ? 'bg-tan/15 text-tan font-medium'
                  : done ? 'text-white/60 hover:text-white hover:bg-white/5'
                  : 'text-white/30 cursor-default'
                }`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] leading-4 text-center ${
                  active ? 'bg-tan text-black'
                  : done ? 'bg-white/15 text-white/70'
                  : 'bg-white/5 text-white/30'
                }`}>{i + 1}</span>
                {s.label}
              </button>
              {i < stepDefs.length - 1 && <span className="w-5 h-px bg-white/10" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>

      {/* Step 1: 选技师 */}
      {step === 'tech' && (
        <div className="space-y-3">
          <h2 className="text-sm text-white/60 text-center">请选择您的技师</h2>

          {/* 空闲技师 */}
          {techsLoading && !technicians.length && (
            <div className="space-y-4">
              <div className="text-xs text-white/30 px-1">可选技师（按评分排序）</div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-[18px] bg-white/[0.05] animate-pulse" style={{ aspectRatio: '3 / 4' }} />
              ))}
            </div>
          )}
          {idleTechs.length > 0 && (
            <div className="space-y-4">
              <div className="text-xs text-white/30 px-1">可选技师（按评分排序）</div>
              {idleTechs.map((tech: any) => (
                <IdleTechCard key={tech.id} tech={tech} onPick={pickTech} />
              ))}
            </div>
          )}

          {/* 技师详情预览弹窗 */}
          {previewTechId && (
            <TechProfile
              techId={previewTechId}
              onClose={closePreview}
              onSelect={confirmPreviewTech}
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
              <div className="w-10 h-10 shrink-0 rounded-full bg-tan/20 flex items-center justify-center text-tan font-bold overflow-hidden">
                {selectedTech.avatar
                  ? <img src={selectedTech.avatar} alt="" width={600} height={800} decoding="async" className="w-full h-full object-cover" />
                  : selectedTech.number}
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

            {/* 过夜睡眠服务 */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overnight}
                onChange={e => setOvernight(e.target.checked)}
                className="accent-[#edff45] w-4 h-4 mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm text-white/80">
                  <Moon size={13} className="text-tan" />
                  过夜睡眠服务
                  <span className="text-tan text-xs">+{formatMoney(OVERNIGHT_FEE_CENTS)}</span>
                </span>
                <span className="block text-[11px] text-white/35 mt-0.5">
                  按摩结束后留在房间过夜休息，次日离店
                </span>
              </span>
            </label>

            <div className="flex justify-between items-center pt-3 border-t border-white/5">
              <span className="text-white/50">费用</span>
              <span className="text-right">
                {overnight && (
                  <span className="block text-xs text-white/40">
                    {formatMoney(selectedService.price_cents)} + 过夜 {formatMoney(OVERNIGHT_FEE_CENTS)}
                  </span>
                )}
                <span className="text-2xl text-tan font-medium">
                  {formatMoney(selectedService.price_cents + (overnight ? OVERNIGHT_FEE_CENTS : 0))}
                </span>
              </span>
            </div>
          </div>

          {createTicket.isError && (
            <div className="text-xs text-cinnabar text-center">{createTicket.error?.message || '下单失败'}</div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setStep('service')}
              className="flex-1 glass-card py-3 text-center text-sm text-white/40"
            >
              返回
            </button>
            <button
              onClick={() => { setErr(''); createTicket.mutate() }}
              disabled={createTicket.isPending || !shop?.id || !selectedService?.id}
              className="flex-1 bg-tan text-white py-3 rounded-xl text-sm font-medium active:scale-[0.97] disabled:opacity-50"
            >
              {createTicket.isPending ? '下单中...' : '确认下单'}
            </button>
          </div>
          {err && <div className="text-xs text-cinnabar text-center">{err}</div>}
        </div>
      )}
    </div>
  )
}

// ─── 使用中状态：显示服务进度 + 加钟 ────────────────────────
function GuestActiveView({ ticket, room }: { ticket: any; room: any }) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [endToast, setEndToast] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const endToastTimerRef = useRef<number | undefined>(undefined)

  const { data: services = [] } = useQuery({
    queryKey: ['guest-services'],
    queryFn: () => get('/api/guest/services?active=1&pageSize=500'),
  })

  const { data: shop } = useQuery({
    queryKey: ['guest-shop'],
    queryFn: () => get('/api/guest/shops/current'),
  })

  const addTicket = useMutation({
    mutationFn: (serviceId: string) => post('/api/guest/tickets', {
      shop_id: shop?.id,
      service_id: serviceId,
      technician_id: ticket.technician_id,
      room_id: room.id,
      auto_start: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-tickets'] })
      setShowAdd(false)
    },
    onError: (e: any) => {
      setErr(e?.message || '加钟失败，请重试')
    },
  })

  const progress = ticket.started_at
    ? Math.min(100, ((Date.now() - ticket.started_at) / (ticket.service_duration * 60000)) * 100)
    : 0

  // 顾客端无 JWT，用本地倒计时做快完钟/到点外放（与服务端同档默认 5 分钟）
  useEffect(() => {
    if (!ticket.started_at || !ticket.service_duration || ticket.overnight) return
    warmupAudio()
    const endAt = ticket.started_at + ticket.service_duration * 60000
    const fired = new Set<string>()
    const show = (msg: string) => {
      setEndToast(msg)
      if (endToastTimerRef.current) clearTimeout(endToastTimerRef.current)
      endToastTimerRef.current = window.setTimeout(() => setEndToast(null), 8000)
    }
    const iv = window.setInterval(() => {
      const remainMs = endAt - Date.now()
      if (remainMs <= 5 * 60000 && remainMs > 0 && !fired.has('w5')) {
        fired.add('w5')
        notifyEndWarn(5, '您的服务还有5分钟')
        show('服务即将结束，还有 5 分钟')
      }
      if (remainMs <= 0 && !fired.has('end')) {
        fired.add('end')
        notifyEnd('您的服务时间到了')
        show('服务时间到了，如需加钟请告知技师')
      }
      if (fired.has('end')) {
        clearInterval(iv)
      }
    }, 1000)
    return () => {
      clearInterval(iv)
      if (endToastTimerRef.current) clearTimeout(endToastTimerRef.current)
    }
  }, [ticket.id, ticket.started_at, ticket.service_duration, ticket.overnight])

  return (
    <div className="min-h-[100dvh] max-w-md mx-auto p-4 space-y-4">
      {endToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[min(92vw,420px)]">
          <div className="rounded-xl border border-tan/40 bg-[#1a1a18]/95 backdrop-blur px-4 py-3 text-sm text-tan">
            {endToast}
          </div>
        </div>
      )}
      <div className="text-center py-3">
        <BrandTitle size="xl" shimmer publicPage stack />
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
        {ticket.overnight ? (
          <div className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-tan/10 text-tan border border-tan/20">
            <Moon size={11} /> 过夜睡眠服务已开通
          </div>
        ) : null}
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
          {err && <div className="text-xs text-cinnabar text-center">{err}</div>}
          <button onClick={() => setShowAdd(false)} className="w-full text-xs text-white/30 py-2">取消</button>
        </div>
      )}

      <div className="text-center text-[10px] text-white/15 pt-4">
        服务结束后请至前台结账
      </div>
    </div>
  )
}
