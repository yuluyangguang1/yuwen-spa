import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Field } from '@/components/Field'
import { ShiftsBoardPanel } from '@/components/ShiftsBoardPanel'

// 技师排钟日历：周视图 + 拖拽改期 + 点击精调（排班已合并为本页 Tab）

const HOURS = Array.from({ length: 14 }, (_, i) => i + 10) // 10:00–23:00
const SLOT_MIN = 30

function startOfWeek(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  return x
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function snapToSlot(ts: number) {
  // 对齐到 30 分钟槽
  return Math.round(ts / (SLOT_MIN * 60000)) * SLOT_MIN * 60000
}

function toLocalInput(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AdminSchedule() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: 'schedule' | 'shifts' = searchParams.get('tab') === 'shifts' ? 'shifts' : 'schedule'
  const [weekOffset, setWeekOffset] = useState(0)
  const [techFilter, setTechFilter] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [editAppt, setEditAppt] = useState<any | null>(null)

  const weekStart = useMemo(() => {
    const s = startOfWeek(new Date())
    s.setDate(s.getDate() + weekOffset * 7)
    return s
  }, [weekOffset])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  }), [weekStart])

  const from = weekStart.getTime()
  const to = from + 7 * 86400000

  const { data: techs = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })

  const { data: appts = [], isLoading } = useQuery({
    queryKey: ['appointments', 'week', from, to, techFilter],
    queryFn: () => get(
      `/api/appointments?pageSize=200&date_from=${from}&date_to=${to}` +
      (techFilter ? `&technician_id=${encodeURIComponent(techFilter)}` : '')
    ).then(async (list: any[]) => {
      // status 过滤在服务端；本地再按 technician_id 兜底（防服务端忽略参数）
      return list.filter((a: any) => !techFilter || a.technician_id === techFilter)
        .filter((a: any) => a.status === 'pending' || a.status === 'confirmed' || a.status === 'completed')
    }),
  })

  const rescheduleMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      post(`/api/appointments/${id}/reschedule`, body),
    onSuccess: () => {
      setErr('')
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (e: Error) => setErr(e.message || '改期失败'),
  })

  const byCell = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const a of appts as any[]) {
      if (a.status === 'canceled') continue
      const d = new Date(a.scheduled_at)
      const key = `${dayKey(d)}|${d.getHours()}`
      const list = map.get(key) || []
      list.push(a)
      map.set(key, list)
    }
    return map
  }, [appts])

  function onDrop(day: Date, hour: number, minute: number) {
    if (!dragId) return
    const appt = (appts as any[]).find(a => a.id === dragId)
    if (!appt) return
    const target = new Date(day)
    target.setHours(hour, minute, 0, 0)
    // 目标格时间即新时间（已按整点/半点落格），只需对齐到 30 分钟槽
    const next = snapToSlot(target.getTime())
    if (next === appt.scheduled_at) { setDragId(null); return }
    rescheduleMut.mutate({ id: appt.id, body: { scheduled_at: next } })
    setDragId(null)
  }

  const weekLabel = `${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${
    days[6].getMonth() + 1}/${days[6].getDate()}`

  const todayKey = dayKey(new Date())
  const stats = useMemo(() => {
    const list = appts as any[]
    const outOfGrid = list.filter(a => {
      const h = new Date(a.scheduled_at).getHours()
      return h < HOURS[0] || h > HOURS[HOURS.length - 1]
    }).length
    return {
      total: list.length,
      pending: list.filter(a => a.status === 'pending').length,
      confirmed: list.filter(a => a.status === 'confirmed').length,
      completed: list.filter(a => a.status === 'completed').length,
      outOfGrid,
    }
  }, [appts])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-medium">排钟日历</h1>
          <div role="tablist" aria-label="排钟排班视图" className="flex gap-1 bg-white/5 border border-white/10 p-1 rounded-lg">
            <button role="tab" aria-selected={tab === 'schedule'}
              onClick={() => setSearchParams({}, { replace: true })}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${
                tab === 'schedule' ? 'bg-tan/15 text-tan' : 'text-white/50 hover:text-white'
              }`}>
              排钟
            </button>
            <button role="tab" aria-selected={tab === 'shifts'}
              onClick={() => setSearchParams({ tab: 'shifts' }, { replace: true })}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${
                tab === 'shifts' ? 'bg-tan/15 text-tan' : 'text-white/50 hover:text-white'
              }`}>
              排班
            </button>
          </div>
        </div>
        {tab === 'schedule' && (
          <div className="flex items-center gap-2 flex-wrap">
            <select value={techFilter} onChange={e => setTechFilter(e.target.value)}
              aria-label="技师筛选"
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs">
              <option value="">全部技师</option>
              {(techs as any[]).map(t => (
                <option key={t.id} value={t.id}>{t.number} {t.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button onClick={() => setWeekOffset(w => w - 1)} aria-label="上一周"
                className="p-1.5 text-white/40 hover:text-tan rounded"><ChevronLeft size={16} /></button>
              <span className="text-xs text-white/50 min-w-[88px] text-center">{weekLabel}</span>
              <button onClick={() => setWeekOffset(w => w + 1)} aria-label="下一周"
                className="p-1.5 text-white/40 hover:text-tan rounded"><ChevronRight size={16} /></button>
              <button onClick={() => setWeekOffset(0)}
                className="px-2 py-1 text-xs border border-white/10 text-white/40 hover:text-tan rounded">本周</button>
            </div>
          </div>
        )}
      </div>

      {tab === 'shifts' ? (
        <ShiftsBoardPanel />
      ) : (
        <>
      {err && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="glass-card overflow-x-auto">
        <div className="min-w-[840px]">
          {/* 表头：7 天 */}
          <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-white/5 sticky top-0 bg-[#1c1408]/95 z-10">
            <div className="p-2 text-[10px] text-white/30" />
            {days.map(d => (
              <div key={d.toISOString()} className={`p-2 text-center text-xs border-l border-white/5 ${
                dayKey(d) === todayKey ? 'text-tan font-medium' : 'text-white/40'}`}>
                {['一', '二', '三', '四', '五', '六', '日'][(d.getDay() || 7) - 1]}
                <div className="text-[10px] opacity-70">{d.getMonth() + 1}/{d.getDate()}</div>
              </div>
            ))}
          </div>

          {/* 小时行 */}
          {isLoading && !appts.length ? HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-white/5 last:border-0">
              <div className="p-1.5 text-[10px] text-white/30 text-right pr-2 pt-1">{hour}:00</div>
              {days.map(d => (
                <div key={`${hour}-${d.toISOString()}`} className="min-h-[44px] border-l border-white/5 p-1">
                  <div className="h-4 rounded bg-white/[0.06] animate-pulse" />
                </div>
              ))}
            </div>
          )) : HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-white/5 last:border-0">
              <div className="p-1.5 text-[10px] text-white/30 text-right pr-2 pt-1">{hour}:00</div>
              {days.map(d => {
                const key = `${dayKey(d)}|${hour}`
                const list = byCell.get(key) || []
                return (
                  <div
                    key={key}
                    className="min-h-[44px] border-l border-white/5 p-1 space-y-1 hover:bg-white/[0.02] transition-colors"
                    onDragOver={e => { if (dragId) e.preventDefault() }}
                    onDrop={e => { e.preventDefault(); onDrop(d, hour, 0) }}
                  >
                    {list.map(a => {
                      const stCls = a.status === 'canceled' ? 'opacity-40 line-through' :
                        a.status === 'completed' ? 'border-moss/40 bg-moss/10' :
                        a.status === 'confirmed' ? 'border-sky-500/40 bg-sky-500/10' :
                        'border-amber-500/40 bg-amber-500/10'
                      return (
                        <div
                          key={a.id}
                          draggable={a.status === 'pending' || a.status === 'confirmed'}
                          onDragStart={() => setDragId(a.id)}
                          onDragEnd={() => setDragId(null)}
                          className={`text-[10px] leading-tight rounded px-1.5 py-1 border ${stCls} cursor-grab active:cursor-grabbing select-none ${
                            dragId === a.id ? 'opacity-50' : ''
                          }`}
                          title={`${fmtTime(a.scheduled_at)} ${a.customer_name || ''} · 拖拽改期，点击精调`}
                          onClick={() => {
                            if (dragId !== a.id) setEditAppt(a)
                          }}
                        >
                          <div className="font-medium text-white/80 truncate">
                            {fmtTime(a.scheduled_at)} {a.customer_name || '预约'}
                          </div>
                          <div className="text-white/40 truncate">
                            {a.technician_name || a.technician_number || '未指定'} · {a.service_name || ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-white/50">
        <span className="glass-card px-2.5 py-1">本周 {stats.total}</span>
        <span className="glass-card px-2.5 py-1 text-amber-300">待确认 {stats.pending}</span>
        <span className="glass-card px-2.5 py-1 text-sky-300">已确认 {stats.confirmed}</span>
        <span className="glass-card px-2.5 py-1 text-moss">已开钟 {stats.completed}</span>
        {stats.outOfGrid > 0 && (
          <span className="glass-card px-2.5 py-1 text-amber-300">
            {stats.outOfGrid} 条在 {HOURS[0]}:00–{HOURS[HOURS.length - 1]}:00 之外未显示
          </span>
        )}
      </div>

      <p className="text-xs text-white/30">
        拖拽预约卡片到其他日期/时段即可改期；点击卡片可精确改时间/技师。同技师时段冲突会拒绝。
        状态：琥珀=待确认，蓝=已确认，绿=已开钟。
        {isLoading && ' 加载中…'}
        {rescheduleMut.isPending && ' 改期中…'}
      </p>

      {editAppt && (
        <EditApptModal
          key={editAppt.id}
          appt={editAppt}
          techs={techs as any[]}
          onClose={() => { setEditAppt(null); rescheduleMut.reset() }}
          onSubmit={body => {
            rescheduleMut.mutate(
              { id: editAppt.id, body },
              { onSuccess: () => setEditAppt(null) },
            )
          }}
          error={rescheduleMut.error?.message}
          loading={rescheduleMut.isPending}
        />
      )}
        </>
      )}
    </div>
  )
}

function EditApptModal({ appt, techs, onClose, onSubmit, error, loading }: {
  appt: any
  techs: any[]
  onClose: () => void
  onSubmit: (body: any) => void
  error?: string
  loading?: boolean
}) {
  const [when, setWhen] = useState(toLocalInput(appt.scheduled_at))
  const [techId, setTechId] = useState(appt.technician_id || '')
  const [duration, setDuration] = useState(String(appt.duration_min || 60))
  const editable = appt.status === 'pending' || appt.status === 'confirmed'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editable) return
    const ts = new Date(when).getTime()
    if (!Number.isFinite(ts)) return
    onSubmit({
      scheduled_at: ts,
      technician_id: techId || null,
      duration_min: Number(duration) || 60,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">调整预约</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="text-xs text-white/40 space-y-1">
          <div>{appt.customer_name || '顾客'}{appt.customer_phone ? ` · ${appt.customer_phone}` : ''}</div>
          <div>{appt.service_name || '未选项目'} · {appt.room_number ? `${appt.room_number}房` : '未定房'}</div>
          <div>状态：{appt.status_label || appt.status}</div>
        </div>
        {!editable ? (
          <p className="text-xs text-white/40 text-center">该预约已结束，不可调整</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-white/40 mb-1">时间</label>
              <input
                type="datetime-local"
                value={when}
                onChange={e => setWhen(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">技师</label>
              <select value={techId} onChange={e => setTechId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="">不限 / 待定</option>
                {techs.map(t => (
                  <option key={t.id} value={t.id}>{t.number} {t.name}</option>
                ))}
              </select>
            </div>
            <Field label="时长(分钟)" type="number" value={duration} onChange={setDuration} required />
            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
              {loading ? '保存中...' : '保存'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
