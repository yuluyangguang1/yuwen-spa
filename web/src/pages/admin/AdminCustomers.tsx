import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Plus, Edit2, Search, Wallet, X } from 'lucide-react'

export default function AdminCustomers() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [topupItem, setTopupItem] = useState<any>(null)

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => get(`/api/customers${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  })
  const shop_id = customers[0]?.shop_id

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customers'] })

  const createMut = useMutation({
    mutationFn: (data: any) => post('/api/customers', data),
    onSuccess: () => { invalidate(); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/customers/${id}`, data),
    onSuccess: () => { invalidate(); setEditItem(null) },
  })

  const topupMut = useMutation({
    mutationFn: ({ id, amount }: any) => post(`/api/customers/${id}/topup`, { amount_cents: amount }),
    onSuccess: () => { invalidate(); setTopupItem(null) },
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium">会员管理</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜手机号/姓名"
              className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-tan/50 w-36" />
          </div>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
            <Plus size={14} /> 新增会员
          </button>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/30 text-sm">
          {search ? '未找到匹配的会员' : '暂无会员，在收银端结账时可快速创建'}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="text-left p-3">姓名</th>
                <th className="text-left p-3">手机</th>
                <th className="text-right p-3">余额</th>
                <th className="text-right p-3">累计消费</th>
                <th className="text-right p-3">来访</th>
                <th className="text-center p-3 w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: any) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3">{c.name || '未命名'}</td>
                  <td className="p-3 text-white/50">{c.phone || '-'}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(c.balance_cents)}</td>
                  <td className="p-3 text-right text-white/50">{formatMoney(c.total_spent_cents)}</td>
                  <td className="p-3 text-right">{c.visit_count}次</td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setEditItem(c)} className="p-1.5 text-white/30 hover:text-tan rounded"><Edit2 size={14} /></button>
                      <button onClick={() => setTopupItem(c)} className="p-1.5 text-white/30 hover:text-moss rounded"><Wallet size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <CustomerForm title="新增会员" shop_id={shop_id}
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editItem && <CustomerForm title="编辑会员" initial={editItem}
        onSubmit={(d) => updateMut.mutate({ id: editItem.id, ...d })} onClose={() => setEditItem(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}

      {topupItem && <TopupForm customer={topupItem}
        onSubmit={(amount) => topupMut.mutate({ id: topupItem.id, amount })}
        onClose={() => setTopupItem(null)} error={topupMut.error?.message} loading={topupMut.isPending} />}
    </div>
  )
}

function CustomerForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    gender: initial?.gender || '',
    birthday: initial?.birthday || '',
    member_no: initial?.member_no || '',
    notes: initial?.notes || '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      shop_id: shop_id || initial?.shop_id,
      name: f.name || null,
      phone: f.phone || null,
      gender: f.gender || null,
      birthday: f.birthday || null,
      member_no: f.member_no || null,
      notes: f.notes || null,
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" value={f.name} onChange={v => setF({ ...f, name: v })} />
            <Field label="手机号" value={f.phone} onChange={v => setF({ ...f, phone: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/40 mb-1">性别</label>
              <div className="flex gap-1.5">
                {['男', '女'].map(g => (
                  <button key={g} type="button" onClick={() => setF({ ...f, gender: g })}
                    className={`flex-1 py-1.5 rounded-lg text-xs border ${f.gender === g ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <Field label="生日" type="date" value={f.birthday} onChange={v => setF({ ...f, birthday: v })} />
          </div>
          <Field label="会员卡号" value={f.member_no} onChange={v => setF({ ...f, member_no: v })} />
          <div>
            <label className="block text-xs text-white/40 mb-1">备注</label>
            <textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} rows={2} placeholder="忌口、偏好等"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50 resize-none" />
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

function TopupForm({ customer, onSubmit, onClose, error, loading }: {
  customer: any; onSubmit: (amount: number) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [yuan, setYuan] = useState('')
  const presets = [100, 200, 500, 1000]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">充值</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <div className="text-sm text-white/50">
          会员：<span className="text-white">{customer.name || '未命名'}</span>
          {customer.phone && <span className="text-white/30 ml-1">({customer.phone})</span>}
        </div>
        <div className="text-sm text-white/50">
          当前余额：<span className="text-tan">{formatMoney(customer.balance_cents)}</span>
        </div>
        <div className="flex gap-2">
          {presets.map(p => (
            <button key={p} type="button" onClick={() => setYuan(String(p))}
              className={`flex-1 py-2 rounded-lg text-sm border ${yuan === String(p) ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
              {p}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-xs text-white/40 mb-1">金额(元)</label>
          <input type="number" value={yuan} onChange={e => setYuan(e.target.value)} placeholder="输入金额"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-tan/50" />
        </div>
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <button onClick={() => onSubmit(Math.round(Number(yuan) * 100))} disabled={loading || !yuan || Number(yuan) <= 0}
          className="w-full bg-moss/80 hover:bg-moss disabled:opacity-30 text-white rounded-lg py-2.5 text-sm">
          {loading ? '充值中...' : `确认充值 ¥${yuan || 0}`}
        </button>
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
