import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Plus, Edit2, Trash2, X } from 'lucide-react'

export default function AdminServices() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => get('/api/services'),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['services'] })

  const createMut = useMutation({
    mutationFn: (data: any) => post('/api/services', data),
    onSuccess: () => { invalidate(); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/services/${id}`, data),
    onSuccess: () => { invalidate(); setEditItem(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/services/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">服务项目管理</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          <Plus size={14} /> 新增项目
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">名称</th>
              <th className="text-left p-3">分类</th>
              <th className="text-right p-3">时长</th>
              <th className="text-right p-3">价格</th>
              <th className="text-right p-3">提成</th>
              <th className="text-center p-3">状态</th>
              <th className="text-center p-3 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s: any) => (
              <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 text-white/50">{s.category}</td>
                <td className="p-3 text-right">{s.duration}分钟</td>
                <td className="p-3 text-right text-tan">{formatMoney(s.price_cents)}</td>
                <td className="p-3 text-right text-white/50">
                  {s.commission_type === 'percent' ? `${s.commission_value / 100}%` : formatMoney(s.commission_value)}
                </td>
                <td className="p-3 text-center">
                  <button onClick={() => updateMut.mutate({ id: s.id, active: s.active ? 0 : 1 })}
                    className={`text-xs px-2 py-0.5 rounded cursor-pointer ${s.active ? 'bg-moss/15 text-moss' : 'bg-white/5 text-white/30'}`}>
                    {s.active ? '启用' : '停用'}
                  </button>
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setEditItem(s)} className="p-1.5 text-white/30 hover:text-tan rounded"><Edit2 size={14} /></button>
                    <button onClick={() => { if (confirm(`停用「${s.name}」？`)) deleteMut.mutate(s.id) }}
                      className="p-1.5 text-white/30 hover:text-red-400 rounded"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <ServiceForm title="新增项目" shop_id={services[0]?.shop_id}
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editItem && <ServiceForm title="编辑项目" initial={editItem}
        onSubmit={(d) => updateMut.mutate({ id: editItem.id, ...d })} onClose={() => setEditItem(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}
    </div>
  )
}

function ServiceForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    name: initial?.name || '',
    category: initial?.category || '足疗',
    duration: initial?.duration || 60,
    price_yuan: initial ? (initial.price_cents / 100).toString() : '',
    commission_type: initial?.commission_type || 'percent',
    commission_value: initial ? (initial.commission_type === 'percent' ? (initial.commission_value / 100).toString() : (initial.commission_value / 100).toString()) : '20',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      shop_id: shop_id || initial?.shop_id,
      name: f.name,
      category: f.category,
      duration: Number(f.duration),
      price_cents: Math.round(Number(f.price_yuan) * 100),
      commission_type: f.commission_type,
      commission_value: f.commission_type === 'percent' ? Math.round(Number(f.commission_value) * 100) : Math.round(Number(f.commission_value) * 100),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="项目名称" value={f.name} onChange={v => setF({ ...f, name: v })} required />
          <div>
            <label className="block text-xs text-white/40 mb-1">分类</label>
            <div className="flex gap-1.5 flex-wrap">
              {['足疗', '推拿', '采耳', '其他'].map(c => (
                <button key={c} type="button" onClick={() => setF({ ...f, category: c })}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${f.category === c ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="时长(分钟)" type="number" value={String(f.duration)} onChange={v => setF({ ...f, duration: Number(v) })} required />
            <Field label="价格(元)" type="number" value={f.price_yuan} onChange={v => setF({ ...f, price_yuan: v })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/40 mb-1">提成方式</label>
              <div className="flex gap-1.5">
                {['percent', 'fixed'].map(t => (
                  <button key={t} type="button" onClick={() => setF({ ...f, commission_type: t })}
                    className={`flex-1 py-1.5 rounded-lg text-xs border ${f.commission_type === t ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
                    {t === 'percent' ? '百分比' : '固定金额'}
                  </button>
                ))}
              </div>
            </div>
            <Field label={f.commission_type === 'percent' ? '提成(%)' : '提成(元)'} type="number"
              value={f.commission_value} onChange={v => setF({ ...f, commission_value: v })} />
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
