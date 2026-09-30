import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, del } from '@/lib/api'
import { ChevronLeft, ChevronRight, X, Copy, CalendarPlus } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'

// 排班面板（已合并入排钟页 Tab）：技师 × 周 × 时段格（technician_schedules 表）
// 与排钟（预约日历）是不同概念。

function startOfWeek(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  return x
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function hhmm(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export function ShiftsBoardPanel() {
  const qc = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const [techFilter, setTechFilter] = useState('')
  const [err, setErr] = useState('')
  const [editShift, setEditShift] = useState<any | null>(null)
  const [addFor, setAddFor] = useState<{ technician_id: string; date: string } | null>(null)

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

  const from = ymd(weekStart)
  const toD = new Date(weekStart)
  toD.setDate(toD.getDate() + 6)
  const to = ymd(toD)

  const { data: techs = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['schedules', from, to, techFilter],
    queryFn: () =>
      get(`/api/schedules?pageSize=500&date_from=${from}&date_to=${to}${techFilter ? `&technician_id=${techFilter}` : ''}`)
        .then((r: any) => r?.data || r || []),
    placeholderData: (prev: any) => prev,
  })

  const saveMut = useMutation({
    mutationFn: (body: any) => post('/api/schedules/batch', body),
    onSuccess: () => {
      setErr('')
      setEditShift(null)
      setAddFor(null)
      qc.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (e: any) => setErr(e?.message || '保存失败'),
  })

  const delMut = useMutation({
    mutationFn: (id: string) => del(`/api/schedules/${id}`),
    onSuccess: () => {
      setErr('')
      setEditShift(null)
      qc.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (e: any) => setErr(e?.message || '删除失败'),
  })

  const copyMut = useMutation({
    mutationFn: () => {
      const toStart = ymd(weekStart)
      const prev = new Date(weekStart)
      prev.setDate(prev.getDate() - 7)
      return post('/api/schedules/copy-week', { from_start: ymd(prev), to_start: toStart })
    },
    onSuccess: (r: any) => {
      setErr('')
      qc.invalidateQueries({ queryKey: ['schedules'] })
      const copied = r?.copied ?? r?.inserted ?? 0
      setErr(copied ? '' : '上周无排班可复制')
    },
    onError: (e: any) => setErr(e?.message || '复制失败'),
  })

  const visibleTechs = useMemo(() => {
    const list = techs as any[]
    if (!techFilter) return list
    return list.filter(t => t.id === techFilter)
  }, [techs, techFilter])

  // Map: technicianId|date → shifts[]
  const byCell = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const s of shifts as any[]) {
      const key = `${s.technician_id}|${s.date}`
      const list = map.get(key) || []
      list.push(s)
      map.set(key, list)
    }
    return map
  }, [shifts])

  const weekLabel = `${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${days[6].getMonth() + 1}/${days[6].getDate()}`
  const todayKey = ymd(new Date())

  const stats = useMemo(() => {
    const list = shifts as any[]
    return {
      total: list.length,
      off: list.filter(s => s.status === 'off').length,
      techDays: new Set(list.filter(s => s.status !== 'off').map(s => `${s.technician_id}|${s.date}`)).size,
    }
  }, [shifts])

  function openAdd(techId: string, date: string) {
    setErr('')
    setAddFor({ technician_id: techId, date })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        <button
          onClick={() => copyMut.mutate()}
          disabled={copyMut.isPending}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-white/10 text-white/50 hover:text-tan rounded-lg disabled:opacity-40"
          title="复制上周排班到本周（冲突跳过）"
        >
          <Copy size={12} /> 复制上周
        </button>
      </div>

      {err && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="glass-card overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-white/5 sticky top-0 bg-[#1c1408]/95 z-10">
            <div className="p-2 text-[10px] text-white/30" />
            {days.map(d => (
              <div key={ymd(d)} className={`p-2 text-center text-xs border-l border-white/5 ${
                ymd(d) === todayKey ? 'text-tan font-medium' : 'text-white/40'}`}>
                {['一', '二', '三', '四', '五', '六', '日'][(d.getDay() || 7) - 1]}
                <div className="text-[10px] opacity-70">{d.getMonth() + 1}/{d.getDate()}</div>
              </div>
            ))}
          </div>

          {visibleTechs.length === 0 && (
            <div className="p-6 text-center text-sm text-white/30">
              {isLoading ? '加载中…' : '暂无技师，请先在「技师」页添加'}
            </div>
          )}

          {visibleTechs.map((tech: any) => (
            <div key={tech.id} className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-white/5 last:border-0">
              <div className="p-2 text-[11px] text-white/50 text-center border-r border-white/5">
                <div className="font-medium text-tan/80">{tech.number}</div>
                <div className="text-[10px] text-white/30 truncate">{tech.name}</div>
              </div>
              {days.map(d => {
                const dateStr = ymd(d)
                const key = `${tech.id}|${dateStr}`
                const list = (byCell.get(key) || []).slice().sort((a, b) => a.start_min - b.start_min)
                return (
                  <div
                    key={key}
                    className="min-h-[72px] border-l border-white/5 p-1 space-y-1 hover:bg-white/[0.02] transition-colors group"
                    onDoubleClick={() => openAdd(tech.id, dateStr)}
                    title="双击空白处添加班次"
                  >
                    {list.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setEditShift(s)}
                        className={`w-full text-left text-[10px] leading-tight rounded px-1.5 py-1 border transition-colors ${
                          s.status === 'off'
                            ? 'border-white/10 bg-white/5 text-white/30 line-through'
                            : 'border-tan/40 bg-tan/10 text-tan hover:border-tan/70'
                        }`}
                        title={`${hhmm(s.start_min)}–${hhmm(s.end_min)}${s.shift_name ? ` · ${s.shift_name}` : ''} · 点击编辑`}
                      >
                        <div className="font-medium truncate">
                          {hhmm(s.start_min)}–{hhmm(s.end_min)}
                        </div>
                        <div className="text-white/40 truncate">
                          {s.status === 'off' ? '休息' : (s.shift_name || '班次')}
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => openAdd(tech.id, dateStr)}
                      className="w-full flex items-center justify-center gap-0.5 text-[10px] text-white/20 hover:text-tan opacity-0 group-hover:opacity-100 transition-opacity py-0.5"
                      title="添加班次"
                    >
                      <CalendarPlus size={10} /> 添加
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-white/40">
        <span className="glass-card px-2.5 py-1">本周班次 {stats.total}</span>
        <span className="glass-card px-2.5 py-1 text-tan">排班人日 {stats.techDays}</span>
        <span className="glass-card px-2.5 py-1">休息 {stats.off}</span>
      </div>

      <p className="text-xs text-white/30">
        双击格子或点「添加」新建班次；点击班次编辑/删除。琥珀=在班，灰=休息(off)。
        「复制上周」把上周班表平移到本周，同技师同起止时间冲突会跳过。技师端「今日班次」读取本表。
        {isLoading && ' 加载中…'}
        {saveMut.isPending && ' 保存中…'}
        {copyMut.isPending && ' 复制中…'}
      </p>

      {(editShift || addFor) && (
        <ShiftEditModal
          shift={editShift}
          preset={addFor}
          techs={techs as any[]}
          onClose={() => { setEditShift(null); setAddFor(null); setErr('') }}
          onSave={body => saveMut.mutate(body)}
          onDelete={id => delMut.mutate(id)}
          error={saveMut.error?.message || delMut.error?.message}
          loading={saveMut.isPending || delMut.isPending}
        />
      )}
    </div>
  )
}

function ShiftEditModal({ shift, preset, techs, onClose, onSave, onDelete, error, loading }: {
  shift: any | null
  preset: { technician_id: string; date: string } | null
  techs: any[]
  onClose: () => void
  onSave: (body: any) => void
  onDelete: (id: string) => void
  error?: string
  loading?: boolean
}) {
  const isEdit = !!shift
  const [confirmDel, setConfirmDel] = useState(false)
  const [technicianId, setTechnicianId] = useState(shift?.technician_id || preset?.technician_id || '')
  const [date, setDate] = useState(shift?.date || preset?.date || '')
  const [startHm, setStartHm] = useState(shift ? hhmm(shift.start_min) : '10:00')
  const [endHm, setEndHm] = useState(shift ? hhmm(shift.end_min) : '23:00')
  const [shiftName, setShiftName] = useState(shift?.shift_name || '')
  const [status, setStatus] = useState(shift?.status || 'scheduled')

  function toMin(hm: string) {
    const [h, m] = hm.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!technicianId || !date) return
    const start_min = toMin(startHm)
    const end_min = toMin(endHm)
    if (end_min <= start_min) return
    const item = {
      id: shift?.id,
      technician_id: technicianId,
      date,
      start_min,
      end_min,
      shift_name: shiftName || null,
      status,
      notes: shift?.notes || null,
    }
    onSave({
      items: [item],
      deleted: isEdit && status === 'deleted' ? [shift.id] : [],
    })
  }

  function handleDelete() {
    setConfirmDel(false)
    if (shift) onDelete(shift.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{isEdit ? '编辑班次' : '添加班次'}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1">技师</label>
            <select value={technicianId} onChange={e => setTechnicianId(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">— 请选择 —</option>
              {techs.map(t => (
                <option key={t.id} value={t.id}>{t.number} {t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">日期</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-white/40 mb-1">开始</label>
              <input type="time" value={startHm} onChange={e => setStartHm(e.target.value)} required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">结束</label>
              <input type="time" value={endHm} onChange={e => setEndHm(e.target.value)} required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">班次名（可选）</label>
            <input type="text" value={shiftName} onChange={e => setShiftName(e.target.value)}
              placeholder="早班 / 晚班 / 全天"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">状态</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="scheduled">在班</option>
              <option value="off">休息</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <div className="flex gap-2 pt-1">
            {isEdit && (
              <button type="button" onClick={() => setConfirmDel(true)} disabled={loading}
                className="px-3 py-2 text-xs text-red-400 border border-red-500/30 rounded-lg disabled:opacity-40">
                删除
              </button>
            )}
            <button type="button" onClick={onClose} disabled={loading}
              className="flex-1 glass-card py-2 text-sm text-white/60 rounded-lg disabled:opacity-40">
              取消
            </button>
            <button type="submit" disabled={loading || !technicianId || !date}
              className="flex-1 bg-tan text-white py-2 rounded-lg text-sm disabled:opacity-40">
              {loading ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={confirmDel}
        title="删除班次"
        message={`确认删除 ${date} ${startHm}–${endHm} 的班次？`}
        variant="danger"
        loading={loading}
        onConfirm={handleDelete}
        onCancel={() => !loading && setConfirmDel(false)}
      />
    </div>
  )
}
