import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { X, CheckCircle, XCircle, LogIn, Plus, CalendarX } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { toast } from '@/lib/toast'

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '待确认', cls: 'bg-amber-500/15 text-amber-300' },
  confirmed: { label: '已确认', cls: 'bg-sky-500/15 text-sky-300' },
  canceled: { label: '已取消', cls: 'bg-white/5 text-white/30' },
  completed: { label: '已完成', cls: 'bg-moss/15 text-moss' },
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function AdminAppointments() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; run: () => void }>({ open: false, title: '', run: () => {} })
  const [openAppt, setOpenAppt] = useState<any | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: appts = [], isLoading } = useQuery({
    queryKey: ['appointments', filter],
    queryFn: () => get(`/api/appointments?pageSize=100${filter ? `&status=${filter}` : ''}`),
    placeholderData: (prev: any) => prev,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['appointments'] })

  const confirmMut = useMutation({
    mutationFn: (id: string) => post(`/api/appointments/${id}/confirm`, {}),
    onSuccess: () => { invalidate(); toast.success('已确认') },
    onError: (e: any) => toast.error(e.message || '确认失败'),
  })
  const cancelMut = useMutation({
    mutationFn: (id: string) => post(`/api/appointments/${id}/cancel`, {}),
    onSuccess: () => {
      invalidate()
      toast.success('已取消')
      setConfirm({ open: false, title: '', run: () => {} })
    },
    onError: (e: any) => toast.error(e.message || '取消失败'),
  })
  const openMut = useMutation({
    mutationFn: ({ id, body }: any) => post(`/api/appointments/${id}/open`, body),
    onSuccess: () => { invalidate(); setOpenAppt(null); toast.success('已开钟') },
    onError: (e: any) => toast.error(e.message || '开钟失败'),
  })
  const createMut = useMutation({
    mutationFn: (body: any) => post('/api/appointments', body),
    onSuccess: () => {
      invalidate()
      setShowCreate(false)
      toast.success('预约已创建')
    },
    onError: (e: any) => toast.error(e.message || '创建失败'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-medium">预约管理</h1>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-tan text-white px-3 py-1.5 rounded-lg text-xs active:scale-[0.97]">
            <Plus size={13} /> 代客预约
          </button>
          {['', 'pending', 'confirmed', 'completed', 'canceled'].map(s => (
            <button key={s || 'all'} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${filter === s ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
              {s ? STATUS[s]?.label : '全部'}
            </button>
          ))}
        </div>
      </div>

      {isLoading && !appts.length ? (
        <div className="glass-card p-4"><TableSkeleton rows={5} /></div>
      ) : !appts.length ? (
        <EmptyState icon={CalendarX}
          title={filter ? `没有${STATUS[filter]?.label || filter}的预约` : '暂无预约'}
          hint={filter ? '换个状态看看，或查看全部' : '顾客来电预约或在收银端「代客预约」创建'}
          action={filter
            ? { label: '查看全部', onClick: () => setFilter('') }
            : { label: '代客预约', onClick: () => setShowCreate(true) }} />
      ) : (
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">时间</th>
              <th className="text-left p-3">顾客</th>
              <th className="text-left p-3">房间</th>
              <th className="text-left p-3">技师</th>
              <th className="text-left p-3">项目</th>
              <th className="text-center p-3">状态</th>
              <th className="text-center p-3 w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {appts.map((a: any) => {
              const st = STATUS[a.status] || { label: a.status, cls: 'bg-white/5 text-white/40' }
              return (
                <tr key={a.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3 text-white/70">{fmt(a.scheduled_at)}</td>
                  <td className="p-3">
                    <div className="font-medium">{a.customer_name || '-'}</div>
                    {a.customer_phone && <div className="text-xs text-white/30">{a.customer_phone}</div>}
                  </td>
                  <td className="p-3 text-white/50">{a.room_number || '-'}</td>
                  <td className="p-3 text-white/50">{a.technician_name || a.technician_number || '-'}</td>
                  <td className="p-3 text-white/50">{a.service_name || '-'}</td>
                  <td className="p-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {a.status === 'pending' && (
                        <button onClick={() => confirmMut.mutate(a.id)} title="确认" aria-label="确认预约"
                          disabled={confirmMut.isPending}
                          className="p-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-white/50 hover:text-moss rounded disabled:opacity-40"><CheckCircle size={14} /></button>
                      )}
                      {(a.status === 'pending' || a.status === 'confirmed') && (
                        <>
                          <button onClick={() => setOpenAppt(a)} title="开钟" aria-label="开钟"
                            className="p-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-white/50 hover:text-tan rounded"><LogIn size={14} /></button>
                          <button onClick={() => setConfirm({
                            open: true, title: '取消预约',
                            run: () => cancelMut.mutate(a.id),
                          })} title="取消" aria-label="取消预约"
                            className="p-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-white/50 hover:text-red-400 rounded"><XCircle size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}

      {openAppt && <OpenTicketModal appt={openAppt}
        onSubmit={(body) => openMut.mutate({ id: openAppt.id, body })}
        onClose={() => setOpenAppt(null)}
        error={openMut.error?.message} loading={openMut.isPending} />}

      {showCreate && <CreateAppointmentModal
        onSubmit={(body) => createMut.mutate(body)}
        onClose={() => setShowCreate(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message="确认执行此操作？此操作不可撤销。"
        variant="danger"
        loading={cancelMut.isPending}
        onConfirm={() => confirm.run()}
        onCancel={() => { if (!cancelMut.isPending) setConfirm({ open: false, title: '', run: () => {} }) }}
      />
    </div>
  )
}

function CreateAppointmentModal({ onSubmit, onClose, error, loading }: {
  onSubmit: (body: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 3600000)
    d.setMinutes(d.getMinutes() < 30 ? 30 : 0, 0, 0)
    if (d.getMinutes() === 0) d.setHours(d.getHours() + 1)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [duration, setDuration] = useState(60)
  const [serviceId, setServiceId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [techId, setTechId] = useState('')
  const [notes, setNotes] = useState('')

  const { data: services = [] } = useQuery({ queryKey: ['services', { active: 1, pageSize: 200 }], queryFn: () => get('/api/services?active=1&pageSize=200') })
  const { data: rooms = [] } = useQuery({ queryKey: ['rooms', { pageSize: 200 }], queryFn: () => get('/api/rooms?pageSize=200') })
  const { data: techs = [] } = useQuery({ queryKey: ['technicians', { active: 1, pageSize: 200 }], queryFn: () => get('/api/technicians?active=1&pageSize=200') })

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm'

  const submit = () => {
    if (!name.trim() || !when) return
    onSubmit({
      customer_name: name.trim(),
      customer_phone: phone.trim() || undefined,
      scheduled_at: new Date(when).getTime(),
      duration_min: duration,
      service_id: serviceId || undefined,
      room_id: roomId || undefined,
      technician_id: techId || undefined,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">代客预约</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1">顾客姓名 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="如 王女士" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">手机号</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="选填" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">预约时间 *</label>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">时长（分钟）</label>
            <select value={duration} onChange={e => setDuration(Number(e.target.value))} className={inputCls}>
              {[30, 45, 60, 90, 120, 180].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/40 mb-1">项目</label>
              <select value={serviceId} onChange={e => setServiceId(e.target.value)} className={inputCls}>
                <option value="">不限</option>
                {(services as any[]).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name} · {formatMoney(s.price_cents)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">房间</label>
              <select value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls}>
                <option value="">不限</option>
                {(rooms as any[]).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.number}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">技师</label>
            <select value={techId} onChange={e => setTechId(e.target.value)} className={inputCls}>
              <option value="">不限</option>
              {(techs as any[]).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">备注</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="选填" className={inputCls} />
          </div>
        </div>
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <button disabled={!name.trim() || !when || loading} onClick={submit}
          className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
          {loading ? '创建中...' : '创建预约'}
        </button>
      </div>
    </div>
  )
}

function OpenTicketModal({ appt, onSubmit, onClose, error, loading }: {
  appt: any; onSubmit: (body: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [serviceId, setServiceId] = useState(appt.service_id || '')
  const [roomId, setRoomId] = useState(appt.room_id || '')
  const [techId, setTechId] = useState(appt.technician_id || '')
  const [autoStart, setAutoStart] = useState(true)

  const { data: services = [] } = useQuery({ queryKey: ['services', { active: 1, pageSize: 200 }], queryFn: () => get('/api/services?active=1&pageSize=200') })
  const { data: rooms = [] } = useQuery({ queryKey: ['rooms', { pageSize: 200 }], queryFn: () => get('/api/rooms?pageSize=200') })
  const { data: techs = [] } = useQuery({ queryKey: ['technicians', { active: 1, pageSize: 200 }], queryFn: () => get('/api/technicians?active=1&pageSize=200') })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">由预约开钟</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <div className="text-xs text-white/40 space-y-1">
          <div>{fmt(appt.scheduled_at)} · {appt.customer_name}</div>
          {appt.notes && <div className="text-white/30">备注：{appt.notes}</div>}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1">项目</label>
            <select value={serviceId} onChange={e => setServiceId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">选择项目</option>
              {(services as any[]).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} · {formatMoney(s.price_cents)}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/40 mb-1">房间</label>
              <select value={roomId} onChange={e => setRoomId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="">不限</option>
                {(rooms as any[]).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.number}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">技师</label>
              <select value={techId} onChange={e => setTechId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="">不限</option>
                {(techs as any[]).map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input type="checkbox" checked={autoStart} onChange={e => setAutoStart(e.target.checked)} />
            立即上钟（取消则创建待开钟单）
          </label>
        </div>
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <button disabled={!serviceId || loading} onClick={() => onSubmit({
          service_id: serviceId || undefined,
          room_id: roomId || undefined,
          technician_id: techId || undefined,
          auto_start: autoStart,
        })}
          className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
          {loading ? '开钟中...' : '确认开钟'}
        </button>
      </div>
    </div>
  )
}
