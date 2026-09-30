import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, post } from '@/lib/api'
import { formatElapsed, statusLabel, formatMoney } from '@/lib/utils'
import { useRealtime } from '@/lib/realtime'
import { Activity, Users, ScanLine, ShoppingBasket, Moon, ArrowLeftRight, UserPlus, X, Sparkles } from 'lucide-react'
import { RoomCardSkeleton } from '@/components/LoadingSkeleton'
import { OrderQueue } from '@/components/OrderQueue'
import { ShiftModal } from '@/components/ShiftModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/lib/toast'

// 收银台首屏：待派钟 + 今日台面（房间 + 钟单 + 点单）
export default function PosHome() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [shiftOpen, setShiftOpen] = useState(false)
  const [assignTicket, setAssignTicket] = useState<any | null>(null)
  const [pickTechId, setPickTechId] = useState('')
  const [assignErr, setAssignErr] = useState('')
  const [aiSuggest, setAiSuggest] = useState<any | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
    queryClient.invalidateQueries({ queryKey: ['ticket-queue'] })
    queryClient.invalidateQueries({ queryKey: ['technicians'] })
    queryClient.invalidateQueries({ queryKey: ['rooms'] })
  }

  // 实时推送：新钟/新点单立刻刷新（5s 轮询兜底）
  useRealtime({
    'ticket:created': invalidateAll,
    'ticket:updated': invalidateAll,
    'ticket:assigned': invalidateAll,
    'ticket:active': invalidateAll,
    'ticket:completed': invalidateAll,
    'ticket:canceled': invalidateAll,
    'ticket:paid': invalidateAll,
    'technician:updated': () => queryClient.invalidateQueries({ queryKey: ['technicians'] }),
    'room:updated': () => queryClient.invalidateQueries({ queryKey: ['rooms'] }),
  })

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today?pageSize=500'),
    refetchInterval: 10000,
  })
  const { data: queue = [] } = useQuery({
    queryKey: ['ticket-queue'],
    queryFn: () => get('/api/tickets/queue').then((r: any) => r?.data || r || []),
    refetchInterval: 10000,
  })
  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms?pageSize=500'),
  })
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })
  const { data: shiftData } = useQuery({
    queryKey: ['shifts', 'current'],
    queryFn: () => get('/api/shifts/current'),
    refetchInterval: 15000,
    retry: false,
  })

  // ⚠️ 所有 hooks 必须在 isLoading 提前 return 之前
  const acceptSelf = useMutation({
    mutationFn: ({ id, technician_id }: { id: string; technician_id?: string }) =>
      post(`/api/tickets/${id}/start`, technician_id ? { technician_id } : {}),
    onSuccess: () => { invalidateAll(); setAssignTicket(null); setPickTechId(''); setAssignErr('') },
    onError: (e: any) => setAssignErr(e?.message || '接单失败'),
  })
  const assignMut = useMutation({
    mutationFn: ({ id, technician_id }: { id: string; technician_id: string }) =>
      post(`/api/tickets/${id}/assign`, { technician_id }),
    onSuccess: () => { invalidateAll(); setAssignTicket(null); setPickTechId(''); setAssignErr('') },
    onError: (e: any) => setAssignErr(e?.message || '派钟失败'),
  })
  const cancelSelf = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/cancel`),
    onSuccess: () => { invalidateAll(); setCancelId(null) },
    onError: (e: any) => toast.error(e?.message || '取消失败'),
  })

  const isLoading = ticketsLoading || roomsLoading
  const hasOpenShift = !!shiftData?.shift

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
  const queueList: any[] = Array.isArray(queue) ? queue : (queue?.data || [])
  const idleTechs = technicians.filter((t: any) => t.status === 'idle' && t.active)

  function openAssign(t: any) {
    setAssignTicket(t)
    setPickTechId(t.technician_id || '')
    setAssignErr('')
    setAiSuggest(null)
  }

  async function requestAiSuggest() {
    if (!assignTicket || aiBusy) return
    setAiBusy(true)
    setAssignErr('')
    try {
      const res = await post('/api/ai/suggest-dispatch', { ticket_id: assignTicket.id })
      setAiSuggest(res)
      if (res?.recommend?.id) {
        setPickTechId(res.recommend.id)
        toast.info(res.reason ? `AI 推荐：${res.recommend.name} — ${res.reason}` : `AI 推荐：${res.recommend.name}`)
      } else {
        toast.info(res?.reason || '暂无推荐')
      }
    } catch (e: any) {
      toast.error(e?.message || '智能排钟失败')
    } finally {
      setAiBusy(false)
    }
  }

  function submitAssignAndMaybeStart(asStart: boolean) {
    if (!assignTicket) return
    if (!pickTechId) { setAssignErr('请选择技师'); return }
    if (asStart) {
      acceptSelf.mutate({ id: assignTicket.id, technician_id: pickTechId })
    } else {
      assignMut.mutate({ id: assignTicket.id, technician_id: pickTechId })
    }
  }

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
        {queueList.length > 0 && (
          <div className="glass-card px-4 py-2 flex items-center gap-2 border-tan/30 bg-tan/5">
            <UserPlus size={16} className="text-tan" />
            <span className="text-sm">待派钟 {queueList.length}</span>
          </div>
        )}
        {selfOrders.length > 0 && (
          <div className="glass-card px-4 py-2 flex items-center gap-2 border-tan/20">
            <ScanLine size={16} className="text-tan" />
            <span className="text-sm">自助/自提 {selfOrders.length}</span>
            {selfPending.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-tan/20 text-tan">{selfPending.length} 待确认</span>
            )}
          </div>
        )}
        <button
          onClick={() => setShiftOpen(true)}
          className="glass-card px-4 py-2 flex items-center gap-2 hover:border-tan/30 transition-colors"
          title="交接班"
        >
          <ArrowLeftRight size={16} className={hasOpenShift ? 'text-moss' : 'text-tan'} />
          <span className="text-sm">{hasOpenShift ? '交班' : '开班'}</span>
          <span className={`w-2 h-2 rounded-full ${hasOpenShift ? 'bg-moss' : 'bg-white/20'}`} />
        </button>
      </div>

      {/* 待派钟队列 */}
      {queueList.length > 0 && (
        <section>
          <h3 className="text-sm text-white/50 mb-2 flex items-center gap-1.5">
            <UserPlus size={14} className="text-tan" /> 待派钟
            <span className="text-tan text-xs">({queueList.length})</span>
          </h3>
          <div className="space-y-2">
            {queueList.map((t: any) => (
              <div key={t.id} className="glass-card p-3 flex items-center justify-between gap-3 border-tan/25 bg-tan/5">
                <div className="min-w-0">
                  <div className="text-sm truncate">
                    {t.service_name}
                    {t.overnight ? (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-tan/15 text-tan align-middle">
                        <Moon size={9} /> 过夜
                      </span>
                    ) : null}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                      t.status === 'pending' ? 'bg-white/10 text-white/50' : 'bg-tan/20 text-tan'
                    }`}>
                      {t.status === 'pending' ? '待开钟' : '上钟中·无技师'}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/40">
                    {t.room_number ? `${t.room_number}号房 · ` : '未定房 · '}
                    {t.technician_number ? `${t.technician_number}号${t.technician_name}` : '未派技师'} · {formatMoney(t.price_cents)}
                    {t.customer_name ? ` · ${t.customer_name}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openAssign(t)}
                    className="bg-tan text-white px-3 py-1.5 rounded-lg text-xs"
                  >
                    {t.technician_id ? '改派' : '派钟'}
                  </button>
                  {t.status === 'pending' && t.technician_id && (
                    <button
                      onClick={() => acceptSelf.mutate({ id: t.id })}
                      disabled={acceptSelf.isPending}
                      className="bg-moss/80 text-white px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                    >开钟</button>
                  )}
                  {t.status === 'pending' && (
                    <button
                      onClick={() => setCancelId(t.id)}
                      disabled={cancelSelf.isPending}
                      className="bg-white/5 text-white/60 px-3 py-1.5 rounded-lg text-xs min-h-[32px] disabled:opacity-40"
                    >取消</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 顾客点单队列（食物用品，实时推送） */}
      <section>
        <h3 className="text-sm text-white/50 mb-2 flex items-center gap-1.5">
          <ShoppingBasket size={14} className="text-tan" /> 顾客点单（食物用品）
        </h3>
        <OrderQueue />
      </section>

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
                  <div className="text-sm truncate">
                    {t.service_name}
                    {t.overnight ? (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-tan/15 text-tan align-middle">
                        <Moon size={9} /> 过夜
                      </span>
                    ) : null}
                  </div>
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
                        onClick={() => openAssign(t)}
                        className="bg-tan text-white px-3 py-1.5 rounded-lg text-xs"
                      >接单</button>
                      <button
                        onClick={() => setCancelId(t.id)}
                        disabled={cancelSelf.isPending}
                        className="bg-white/5 text-white/60 px-3 py-1.5 rounded-lg text-xs min-h-[32px] disabled:opacity-40"
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
                  occupied ? 'bg-tan/20 text-tan' : 'bg-moss/15 text-moss'
                }`}>
                  {occupied ? '使用中' : '空闲'}
                </span>
              </div>
              <div className="text-[10px] text-white/30 mt-1">{room.type}</div>
              {ticket ? (
                <div className="mt-auto pt-2 border-t border-white/5 space-y-0.5">
                  <div className="text-xs text-white/70 truncate">
                    {ticket.service_name}
                    {ticket.overnight ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-tan/15 text-tan">
                        <Moon size={8} /> 过夜
                      </span>
                    ) : null}
                  </div>
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

      {shiftOpen && <ShiftModal onClose={() => setShiftOpen(false)} />}

      {/* 派钟 / 接单选技师 */}
      {assignTicket && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium">{assignTicket.technician_id ? '改派技师' : '派钟'}</h2>
                <p className="text-xs text-white/40 mt-1">
                  {assignTicket.service_name}
                  {assignTicket.room_number ? ` · ${assignTicket.room_number}号房` : ''}
                </p>
              </div>
              <button onClick={() => setAssignTicket(null)} className="text-white/30 hover:text-white" aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-white/40">选择空闲技师</label>
                <button
                  type="button"
                  onClick={requestAiSuggest}
                  disabled={aiBusy}
                  className="flex items-center gap-1 text-[11px] text-tan/80 hover:text-tan disabled:opacity-50"
                  title="基于评分、星级、近7日负载智能推荐"
                >
                  <Sparkles size={12} className={aiBusy ? 'animate-pulse' : ''} />
                  {aiBusy ? '推荐中…' : 'AI 智能推荐'}
                </button>
              </div>
              <select
                value={pickTechId}
                onChange={e => { setPickTechId(e.target.value); setAssignErr('') }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-tan/40 focus:outline-none"
              >
                <option value="">— 请选择 —</option>
                {(aiSuggest?.ranked?.length
                  ? [
                      ...aiSuggest.ranked.filter((r: any) => idleTechs.some((t: any) => t.id === r.id)),
                      ...idleTechs.filter((t: any) => !aiSuggest.ranked.some((r: any) => r.id === t.id)),
                    ]
                  : idleTechs
                ).map((t: any) => {
                  const ranked = aiSuggest?.ranked?.find((r: any) => r.id === t.id)
                  return (
                    <option key={t.id} value={t.id}>
                      {t.number}号 {t.name}（空闲{ranked ? ` · AI ${ranked.score}` : ''}）
                    </option>
                  )
                })}
                {assignTicket.technician_id && !idleTechs.some((t: any) => t.id === assignTicket.technician_id) && (
                  <option value={assignTicket.technician_id}>
                    {assignTicket.technician_number} {assignTicket.technician_name}（当前）
                  </option>
                )}
              </select>
              {aiSuggest?.reason && (
                <div className="text-[10px] text-tan/70 mt-1 flex gap-1">
                  <Sparkles size={10} className="shrink-0 mt-0.5" />
                  <span>{aiSuggest.reason}{aiSuggest.source === 'ai' ? ' · LLM' : ''}</span>
                </div>
              )}
              {idleTechs.length === 0 && !assignTicket.technician_id && (
                <div className="text-[10px] text-amber-300 mt-1">暂无空闲技师，可稍后再派</div>
              )}
            </div>
            {assignErr && <div className="text-xs text-red-400">{assignErr}</div>}
            <div className="flex gap-2">
              <button
                onClick={() => setAssignTicket(null)}
                className="flex-1 glass-card py-2 text-sm text-white/50 rounded-lg"
              >取消</button>
              {assignTicket.status === 'pending' ? (
                <button
                  onClick={() => submitAssignAndMaybeStart(true)}
                  disabled={acceptSelf.isPending || !pickTechId}
                  className="flex-1 bg-tan text-white py-2 rounded-lg text-sm disabled:opacity-40"
                >{acceptSelf.isPending ? '开钟中...' : '派钟并开钟'}</button>
              ) : (
                <button
                  onClick={() => submitAssignAndMaybeStart(false)}
                  disabled={assignMut.isPending || !pickTechId}
                  className="flex-1 bg-tan text-white py-2 rounded-lg text-sm disabled:opacity-40"
                >{assignMut.isPending ? '派钟中...' : '确认改派'}</button>
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!cancelId}
        title="取消钟单"
        message="确认取消该钟单？取消后不可恢复，若已开钟会影响技师计时。"
        variant="danger"
        loading={cancelSelf.isPending}
        onConfirm={() => cancelId && cancelSelf.mutate(cancelId)}
        onCancel={() => { if (!cancelSelf.isPending) setCancelId(null) }}
      />
    </div>
  )
}
