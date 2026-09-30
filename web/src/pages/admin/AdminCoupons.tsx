import { useState } from 'react'
import { useSimpleCRUD } from '@/hooks/useCRUD'
import { get, post, put, del } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Plus, Edit2, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Field } from '@/components/Field'

function fmtTime(ts?: number | null) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function valueLabel(c: any) {
  if (c.type === 'fixed') return `立减 ${formatMoney(c.value)}`
  return `${100 - c.value}%（减 ${c.value}%）`
}

export default function AdminCoupons() {
  const {
    data: coupons = [],
    showForm,
    editItem,
    setShowForm,
    setEditItem,
    confirmState,
    createMut,
    updateMut,
    deleteMut,
    requestDelete,
    closeConfirm,
  } = useSimpleCRUD({
    queryKey: ['coupons'],
    queryFn: () => get('/api/coupons?pageSize=200'),
    createFn: (data: any) => post('/api/coupons', data),
    updateFn: (id: string, data: any) => put(`/api/coupons/${id}`, data),
    deleteFn: (id: string) => del(`/api/coupons/${id}`),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">优惠券</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          <Plus size={14} /> 新建券
        </button>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">码</th>
              <th className="text-left p-3">名称</th>
              <th className="text-left p-3">优惠</th>
              <th className="text-right p-3">门槛</th>
              <th className="text-right p-3">已用</th>
              <th className="text-left p-3">有效期</th>
              <th className="text-center p-3">状态</th>
              <th className="text-center p-3 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c: any) => (
              <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="p-3 font-mono text-tan">{c.code}</td>
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-white/50">{valueLabel(c)}</td>
                <td className="p-3 text-right text-white/50">{c.min_spend_cents ? formatMoney(c.min_spend_cents) : '-'}</td>
                <td className="p-3 text-right text-white/50">
                  {c.used_count}{c.max_uses != null ? `/${c.max_uses}` : ''}
                </td>
                <td className="p-3 text-white/40 text-xs">{fmtTime(c.starts_at)} ~ {fmtTime(c.ends_at) || '永久'}</td>
                <td className="p-3 text-center">
                  <button onClick={() => updateMut.mutate({ id: c.id, active: c.active ? 0 : 1 })}
                    className={`text-xs px-2 py-0.5 rounded cursor-pointer ${c.active ? 'bg-moss/15 text-moss' : 'bg-white/5 text-white/30'}`}>
                    {c.active ? '启用' : '停用'}
                  </button>
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setEditItem(c)} className="p-1.5 text-white/50 hover:text-tan rounded"><Edit2 size={14} /></button>
                    <button onClick={() => requestDelete(`删除券「${c.code}」？`, () => deleteMut.mutate(c.id))} className="p-1.5 text-white/50 hover:text-red-400 rounded"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!coupons.length && (
              <tr><td colSpan={8} className="p-6 text-center text-white/30 text-sm">暂无优惠券</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && <CouponForm title="新建优惠券"
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editItem && <CouponForm title="编辑优惠券" initial={editItem}
        onSubmit={(d) => updateMut.mutate({ id: editItem.id, ...d })} onClose={() => setEditItem(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}

      <ConfirmDialog
        open={confirmState.open}
        title="删除优惠券"
        message={confirmState.message}
        variant="danger"
        onConfirm={() => { confirmState.onConfirm(); closeConfirm() }}
        onCancel={closeConfirm}
      />
    </div>
  )
}

function CouponForm({ title, initial, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    code: initial?.code || '',
    name: initial?.name || '',
    type: initial?.type || 'percent',
    value: initial?.value?.toString() || '',
    min_spend_yuan: initial ? (initial.min_spend_cents / 100).toString() : '0',
    max_uses: initial?.max_uses?.toString() || '',
    ends_at: initial?.ends_at
      ? new Date(initial.ends_at - new Date(initial.ends_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const ends_at = f.ends_at ? new Date(f.ends_at).getTime() : null
    onSubmit({
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      type: f.type,
      value: Number(f.value),
      min_spend_cents: Math.round(Number(f.min_spend_yuan || 0) * 100),
      max_uses: f.max_uses === '' ? null : Number(f.max_uses),
      ends_at,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="券码" value={f.code} onChange={v => setF({ ...f, code: v.toUpperCase() })} required placeholder="WELCOME20" />
          <Field label="名称" value={f.name} onChange={v => setF({ ...f, name: v })} required placeholder="新客立减" />
          <div>
            <label className="block text-xs text-white/40 mb-1">类型</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setF({ ...f, type: 'percent' })}
                className={`px-3 py-1.5 rounded-lg text-xs border ${f.type === 'percent' ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>折扣</button>
              <button type="button" onClick={() => setF({ ...f, type: 'fixed' })}
                className={`px-3 py-1.5 rounded-lg text-xs border ${f.type === 'fixed' ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>立减</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={f.type === 'percent' ? '折扣%（20=减20%）' : '立减(元)'} type="number" value={f.value} onChange={v => setF({ ...f, value: v })} required />
            <Field label="满减门槛(元)" type="number" value={f.min_spend_yuan} onChange={v => setF({ ...f, min_spend_yuan: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="总次数(空=不限)" type="number" value={f.max_uses} onChange={v => setF({ ...f, max_uses: v })} />
            <Field label="截止时间" type="datetime-local" value={f.ends_at} onChange={v => setF({ ...f, ends_at: v })} />
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
