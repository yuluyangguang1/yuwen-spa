import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/lib/api'
import { statusLabel } from '@/lib/utils'
import { Plus, X, Bell } from 'lucide-react'

export default function AdminTechnicians() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTech, setEditTech] = useState<any>(null)

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })
  const shop_id = technicians[0]?.shop_id

  const invalidate = () => qc.invalidateQueries({ queryKey: ['technicians'] })

  const createMut = useMutation({
    mutationFn: (data: any) => post('/api/technicians', data),
    onSuccess: () => { invalidate(); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/technicians/${id}`, data),
    onSuccess: () => { invalidate(); setEditTech(null) },
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">技师管理</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          <Plus size={14} /> 新增技师
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">工号</th>
              <th className="text-left p-3">姓名</th>
              <th className="text-left p-3">级别</th>
              <th className="text-left p-3">电话</th>
              <th className="text-center p-3">通知</th>
              <th className="text-center p-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((t: any) => (
              <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] cursor-pointer"
                onClick={() => setEditTech(t)}>
                <td className="p-3 font-bold text-white/60">{t.number}</td>
                <td className="p-3">{t.name}</td>
                <td className="p-3 text-white/50">{t.level || '-'}</td>
                <td className="p-3 text-white/40">{t.phone || '-'}</td>
                <td className="p-3 text-center">
                  {t.webhook_url ? <Bell size={14} className="text-tan mx-auto" /> : <span className="text-white/20 text-xs">-</span>}
                </td>
                <td className="p-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    t.status === 'working' ? 'bg-tan/15 text-tan' :
                    t.status === 'idle' ? 'bg-moss/15 text-moss' :
                    'bg-white/5 text-white/30'
                  }`}>{statusLabel(t.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <TechForm title="新增技师" shop_id={shop_id}
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editTech && <TechForm title="编辑技师" initial={editTech}
        onSubmit={(d) => updateMut.mutate({ id: editTech.id, ...d })} onClose={() => setEditTech(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}
    </div>
  )
}

function TechForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    number: initial?.number || '',
    name: initial?.name || '',
    level: initial?.level || '初级',
    phone: initial?.phone || '',
    bio: initial?.bio || '',
    years: initial?.years?.toString() || '',
    webhook_url: initial?.webhook_url || '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      shop_id: shop_id || initial?.shop_id,
      number: f.number,
      name: f.name,
      level: f.level,
      phone: f.phone || null,
      bio: f.bio || null,
      years: f.years ? Number(f.years) : null,
      webhook_url: f.webhook_url || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="工号" value={f.number} onChange={v => setF({ ...f, number: v })} required />
            <Field label="姓名" value={f.name} onChange={v => setF({ ...f, name: v })} required />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">级别</label>
            <div className="flex gap-1.5 flex-wrap">
              {['初级', '中级', '高级', '技师长'].map(l => (
                <button key={l} type="button" onClick={() => setF({ ...f, level: l })}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${f.level === l ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="电话" value={f.phone} onChange={v => setF({ ...f, phone: v })} />
            <Field label="从业年限" type="number" value={f.years} onChange={v => setF({ ...f, years: v })} />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">简介</label>
            <textarea value={f.bio} onChange={e => setF({ ...f, bio: e.target.value })} rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 flex items-center gap-1">
              <Bell size={12} /> 个人 Webhook（企业微信）
            </label>
            <input value={f.webhook_url} onChange={e => setF({ ...f, webhook_url: e.target.value })}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-tan/50" />
          </div>
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
            {loading ? '保存中...' : '保存'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-white/40 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50" />
    </div>
  )
}
