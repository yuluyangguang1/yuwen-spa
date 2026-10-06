// 客服派单台：进店扫码顾客的派单工作台
//
// 场景：顾客在大堂扫码下单（无房间），客服需要
//   1. 看到待派钟队列（含顾客自助单）
//   2. 为顾客分配房间 + 技师
//   3. 一键开钟
//
// 与收银端 PosHome 的区别：
//   - PosHome 面向「到店即入座」的传统流程（房间已定）
//   - 这里面向「先下单后分配」的新流程（房间待定），房间分配是核心动作
//
// 权限：STAFF_ROLES = admin/pos/cs，客服可直接调用 /api/tickets/queue 和 /assign
//
// 移动优先：客服多在手机/平板上操作，所有可点元素 ≥44px，
// 派单弹窗从底部滑出（thumb-friendly），安全区适配刘海屏。

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { useRealtime } from '@/lib/realtime'
import {
  UserPlus, Moon, MapPin, Clock, Sparkles, RefreshCw, X, Users,
} from 'lucide-react'

function formatMoney(cents?: number) {
  if (cents == null) return '—'
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

export default function CsDashboard() {
  const queryClient = useQueryClient()
  const [assignTicket, setAssignTicket] = useState<any | null>(null)
  const [assignErr, setAssignErr] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPick, setAiPick] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null)

  // ── 数据 ────────────────────────────────────────
  const { data: queue = [], isLoading: queueLoading, refetch } = useQuery({
    queryKey: ['cs-ticket-queue'],
    queryFn: () => get('/api/tickets/queue').then((r: any) => r?.data || r || []),
    refetchInterval: 8000,   // 顾客随时可能下单
  })

  const { data: rooms = [] } = useQuery({
    queryKey: ['cs-rooms'],
    queryFn: () => get('/api/rooms').then((r: any) => r?.data || r || []),
  })

  const { data: techs = [] } = useQuery({
    queryKey: ['cs-techs'],
    queryFn: () => get('/api/technicians').then((r: any) => r?.data || r || []),
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['cs-ticket-queue'] })
    queryClient.invalidateQueries({ queryKey: ['cs-rooms'] })
    queryClient.invalidateQueries({ queryKey: ['cs-techs'] })
  }, [queryClient])

  useRealtime({
    'ticket:created': invalidate,
    'ticket:assigned': invalidate,
    'ticket:started': invalidate,
    'ticket:paid': invalidate,
  })

  // ── 派单 ────────────────────────────────────────
  const assignMut = useMutation({
    mutationFn: ({ id, technician_id, room_id }: any) =>
      post(`/api/tickets/${id}/assign`, { technician_id, room_id }),
    onSuccess: () => { invalidate(); setAssignTicket(null); setAssignErr('') },
    onError: (e: any) => setAssignErr(e?.message || '派单失败'),
  })

  const startMut = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/start`, {}),
    onSuccess: () => invalidate(),
    onError: (e: any) => setAssignErr(e?.message || '开钟失败'),
  })

  const suggestAi = async () => {
    if (!assignTicket) return
    setAiBusy(true); setAiPick(null)
    try {
      const res: any = await post('/api/ai/suggest-dispatch', { ticket_id: assignTicket.id })
      const id = res?.technician_id || res?.data?.technician_id || null
      setAiPick(id)
      if (id) setSelectedTechId(id)
    } catch { /* 推荐失败不阻断手动派单 */ }
    finally { setAiBusy(false) }
  }

  const queueList: any[] = Array.isArray(queue) ? queue : (queue?.data || [])
  const roomList: any[] = Array.isArray(rooms) ? rooms : (rooms?.data || [])
  const techList: any[] = Array.isArray(techs) ? techs : (techs?.data || [])
  const idleRooms = roomList.filter((r: any) => !r.status || r.status === 'idle' || r.status === 'free')
  const idleTechs = techList.filter((t: any) => t.status === 'idle' && t.active !== 0)

  return (
    <div className="p-4 space-y-5 max-w-4xl mx-auto safe-area-all">
      {/* 头部 */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-medium">派单台</h1>
          <p className="text-xs text-white/40 mt-0.5 truncate">
            {queueList.length > 0 ? `${queueList.length} 单待处理` : '暂无待派单'}
            <span className="mx-1.5">·</span>
            空闲房 {idleRooms.length} · 空闲技师 {idleTechs.length}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          aria-label="刷新队列"
          className="glass-card touch-target text-xs text-white/60 active:text-white/90 shrink-0"
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <RefreshCw size={15} className={queueLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {assignErr && (
        <div className="glass-card p-3 text-xs text-red-400 border-red-400/25 bg-red-400/5 flex items-center justify-between gap-2">
          <span className="min-w-0">{assignErr}</span>
          <button onClick={() => setAssignErr('')} aria-label="关闭提示" className="touch-target shrink-0">
            <X size={15} />
          </button>
        </div>
      )}

      {/* 待派钟队列 */}
      <section>
        <h3 className="text-sm text-white/50 mb-2 flex items-center gap-1.5">
          <UserPlus size={14} className="text-tan" /> 待派钟
          <span className="text-tan text-xs">({queueList.length})</span>
        </h3>

        {queueList.length === 0 ? (
          <div className="glass-card p-8 text-center text-white/30 text-sm">
            暂无待派单
            <div className="text-[10px] text-white/20 mt-1">顾客扫码下单后会自动出现在这里</div>
          </div>
        ) : (
          <div className="space-y-2">
            {queueList.map((t: any) => (
              <div key={t.id} className="glass-card p-3 border-tan/25 bg-tan/5">
                <div className="text-sm">
                  {t.service_name}
                  {t.overnight ? (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-tan/15 text-tan align-middle">
                      <Moon size={9} /> 过夜
                    </span>
                  ) : null}
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                    t.status === 'pending' ? 'bg-white/10 text-white/50' : 'bg-tan/20 text-tan'
                  }`}>
                    {t.status === 'pending' ? '待开钟' : '上钟中'}
                  </span>
                </div>
                <div className="text-[10px] text-white/40 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="flex items-center gap-0.5">
                    <MapPin size={9} />{t.room_number ? `${t.room_number}号房` : '未定房'}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Users size={9} />{t.technician_number ? `${t.technician_number}号${t.technician_name}` : '未派技师'}
                  </span>
                  <span>{formatMoney(t.price_cents)}</span>
                  {t.customer_name ? <span>{t.customer_name}</span> : null}
                </div>

                {/* 操作按钮：移动端大按钮、撑满宽度 */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { setAssignTicket(t); setAssignErr(''); setAiPick(null); setSelectedRoomId(t.room_id || null); setSelectedTechId(t.technician_id || null) }}
                    className="flex-1 bg-tan text-white rounded-lg text-sm min-h-[44px] active:scale-[0.98] transition-transform"
                  >
                    {t.technician_id ? '改派' : '派单'}
                  </button>
                  {t.status === 'pending' && t.technician_id && t.room_id && (
                    <button
                      onClick={() => startMut.mutate(t.id)}
                      disabled={startMut.isPending}
                      className="flex-1 bg-moss/80 text-white rounded-lg text-sm min-h-[44px] active:scale-[0.98] transition-transform disabled:opacity-40"
                    >开钟</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 资源概览 */}
      <section className="grid grid-cols-2 gap-3">
        <div className="glass-card p-3">
          <div className="text-xs text-white/40 mb-2">空闲房间</div>
          <div className="flex flex-wrap gap-1.5">
            {idleRooms.length === 0
              ? <span className="text-xs text-white/25">无</span>
              : idleRooms.map((r: any) => (
                  <span key={r.id} className="text-[11px] px-2 py-1 rounded bg-moss/15 text-moss">
                    {r.number}号
                  </span>
                ))}
          </div>
        </div>
        <div className="glass-card p-3">
          <div className="text-xs text-white/40 mb-2">空闲技师</div>
          <div className="flex flex-wrap gap-1.5">
            {idleTechs.length === 0
              ? <span className="text-xs text-white/25">无</span>
              : idleTechs.map((t: any) => (
                  <span key={t.id} className="text-[11px] px-2 py-1 rounded bg-moss/15 text-moss">
                    {t.number}号{t.name}
                  </span>
                ))}
          </div>
        </div>
      </section>

      {/* 派单弹窗：移动端底部滑出 */}
      {assignTicket && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => setAssignTicket(null)}
        >
          <div
            className="glass-card w-full sm:max-w-md max-h-[88dvh] overflow-y-auto overscroll-contain
                       rounded-b-none sm:rounded-b-2xl p-5 space-y-4 safe-area-pb
                       animate-[slideUp_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 拖拽提示条（移动端视觉暗示可下滑关闭） */}
            <div className="sm:hidden w-10 h-1 rounded-full bg-white/20 mx-auto -mt-1 mb-1" />

            <div className="flex items-center justify-between">
              <h2 className="font-medium">{assignTicket.technician_id ? '改派' : '派单'}</h2>
              <button onClick={() => setAssignTicket(null)} aria-label="关闭"
                      className="touch-target text-white/40 active:text-white/70 -mr-2">
                <X size={18} />
              </button>
            </div>

            <div className="text-xs text-white/50">
              {assignTicket.service_name}
              <span className="mx-1.5">·</span>
              {formatMoney(assignTicket.price_cents)}
              {assignTicket.customer_name ? <span className="ml-1.5">· {assignTicket.customer_name}</span> : null}
            </div>

            {/* AI 推荐 */}
            <button
              onClick={suggestAi}
              disabled={aiBusy}
              className="w-full glass-card text-xs flex items-center justify-center gap-1.5 text-tan min-h-[44px] disabled:opacity-40"
            >
              <Sparkles size={14} className={aiBusy ? 'animate-pulse' : ''} />
              {aiBusy ? '推荐中…' : aiPick ? `推荐：${techName(techList, aiPick)}` : 'AI 推荐技师'}
            </button>

            {/* 选房间 */}
            <div>
              <div className="text-xs text-white/40 mb-2">
                分配房间 <span className="text-white/25">（进店扫码单必选）</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {idleRooms.length === 0 ? (
                  <div className="col-span-4 text-xs text-white/25 py-2">暂无空闲房间</div>
                ) : idleRooms.map((r: any) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoomId(r.id)}
                    disabled={assignMut.isPending}
                    className={`glass-card min-h-[48px] text-sm active:bg-moss/20 active:text-moss disabled:opacity-40 ${
                      selectedRoomId === r.id ? 'border-moss/50 bg-moss/20 text-moss' : ''
                    }`}
                  >
                    {r.number}号
                  </button>
                ))}
              </div>
            </div>

            {/* 选技师 */}
            <div>
              <div className="text-xs text-white/40 mb-2">分配技师</div>
              <div className="grid grid-cols-3 gap-2">
                {idleTechs.length === 0 ? (
                  <div className="col-span-3 text-xs text-white/25 py-2">暂无空闲技师</div>
                ) : idleTechs.map((t: any) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTechId(t.id)}
                    disabled={assignMut.isPending}
                    className={`glass-card min-h-[52px] text-sm active:scale-[0.98] transition-transform disabled:opacity-40 ${
                      selectedTechId === t.id ? 'border-tan/50 bg-tan/10 text-tan' : ''
                    }`}
                  >
                    <div>{t.number}号</div>
                    <div className="text-[10px] text-white/50 truncate">{t.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 确认派单按钮 */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (!selectedRoomId || !selectedTechId) return
                assignMut.mutate({
                  id: assignTicket.id,
                  technician_id: selectedTechId,
                  room_id: selectedRoomId,
                })
              }}
              disabled={!selectedRoomId || !selectedTechId || assignMut.isPending}
              className="w-full bg-tan text-white rounded-lg text-sm min-h-[48px] active:scale-[0.98] transition-transform disabled:opacity-40"
            >
              {assignMut.isPending ? '处理中…' : '确认派单'}
            </button>

            {assignMut.isPending && (
              <div className="text-xs text-center text-white/40 flex items-center justify-center gap-1.5">
                <Clock size={12} className="animate-spin" /> 处理中…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function techName(techs: any[], id: string) {
  const t = (Array.isArray(techs) ? techs : []).find((x: any) => x.id === id)
  return t ? `${t.number}号${t.name}` : '技师'
}
