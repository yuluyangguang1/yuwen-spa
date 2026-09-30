import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Plus, Edit2, Wallet, X, History, Undo2, Users, UserSearch } from 'lucide-react'
import { Field } from '@/components/Field'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SearchInput } from '@/components/SearchInput'
import { EmptyState } from '@/components/EmptyState'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { toast } from '@/lib/toast'

export default function AdminCustomers() {
  const qc = useQueryClient()
  // SearchInput 内置防抖：search 即查询值
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [topupItem, setTopupItem] = useState<any>(null)
  const [historyItem, setHistoryItem] = useState<any>(null)
  const [refundTxn, setRefundTxn] = useState<any | null>(null)
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    onConfirm: () => void
    message: string
  }>({ open: false, onConfirm: () => {}, message: '' })

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => get(`/api/customers?pageSize=500${search ? `&q=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (prev: any) => prev,
  })
  const shop_id = customers[0]?.shop_id

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['wallet'] })
  }

  const createMut = useMutation({
    mutationFn: (data: any) => post('/api/customers', data),
    onSuccess: () => { invalidate(); setShowForm(false); toast.success('会员已创建') },
    onError: (e: any) => toast.error(e.message || '创建失败'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/customers/${id}`, data),
    onSuccess: () => { invalidate(); setEditItem(null); toast.success('已保存') },
    onError: (e: any) => toast.error(e.message || '保存失败'),
  })

  const topupMut = useMutation({
    mutationFn: ({ id, amount }: any) => post(`/api/customers/${id}/topup`, { amount_cents: amount }),
    onSuccess: (data: any) => {
      invalidate(); setTopupItem(null)
      if (data?.commission_cents > 0) toast.success(`充值成功，提成 ${formatMoney(data.commission_cents)}`)
      else toast.success('充值成功')
    },
    onError: (e: any) => toast.error(e.message || '充值失败'),
  })
  const topupRefundMut = useMutation({
    mutationFn: ({ id, wallet_txn_id }: any) => post(`/api/customers/${id}/topup-refund`, { wallet_txn_id, reason: '前台退卡' }),
    onSuccess: (data: any) => {
      invalidate(); setRefundTxn(null)
      if (data?.commission_reversed_cents > 0) toast.success(`退卡成功，冲销提成 ${formatMoney(data.commission_reversed_cents)}`)
      else toast.success('退卡成功')
    },
    onError: (e: any) => toast.error(e.message || '退卡失败'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium">会员管理</h1>
        <div className="flex items-center gap-2">
          <SearchInput placeholder="搜手机号/姓名" label="搜索会员"
            onSearch={setSearch} className="w-36 sm:w-48" />
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 min-h-[40px] rounded-lg text-sm active:scale-[0.97]">
            <Plus size={14} /> 新增会员
          </button>
        </div>
      </div>

      {isLoading && !customers.length ? (
        <div className="glass-card p-4"><TableSkeleton rows={6} /></div>
      ) : customers.length === 0 ? (
        search ? (
          <EmptyState icon={UserSearch} title="未找到匹配的会员" hint={`没有姓名或手机号包含「${search}」的会员`} />
        ) : (
          <EmptyState icon={Users} title="暂无会员"
            hint="在收银端结账时可快速创建，或点右上角手动新增"
            action={{ label: '新增会员', onClick: () => setShowForm(true) }} />
        )
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="text-left p-3">姓名</th>
                <th className="text-left p-3">手机</th>
                <th className="text-left p-3">归属人</th>
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
                  <td className="p-3 text-white/50">{c.owner_name || c.owner_username || <span className="text-white/25">公海</span>}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(c.balance_cents)}</td>
                  <td className="p-3 text-right text-white/50">{formatMoney(c.total_spent_cents)}</td>
                  <td className="p-3 text-right">{c.visit_count}次</td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setEditItem(c)} className="p-1.5 text-white/50 hover:text-tan rounded"><Edit2 size={14} /></button>
                      <button onClick={() => setTopupItem(c)} className="p-1.5 text-white/50 hover:text-moss rounded"><Wallet size={14} /></button>
                      <button onClick={() => setHistoryItem(c)} title="余额流水" className="p-1.5 text-white/50 hover:text-tan rounded"><History size={14} /></button>
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

      {historyItem && <WalletHistoryModal customer={historyItem} onClose={() => setHistoryItem(null)}
        onRefund={(txn) => setRefundTxn(txn)} />}

      <ConfirmDialog
        open={!!refundTxn}
        title="退卡"
        message={refundTxn
          ? `确认退还该笔充值 ${formatMoney(refundTxn.amount_cents)}？余额将扣回，报表提成同步冲销。`
          : ''}
        confirmLabel="确认退卡"
        variant="danger"
        loading={topupRefundMut.isPending}
        onConfirm={() => refundTxn && topupRefundMut.mutate({
          id: refundTxn.customer_id,
          wallet_txn_id: refundTxn.id,
        })}
        onCancel={() => setRefundTxn(null)}
      />

      {/* 自定义确认弹窗 */}
      <ConfirmDialog
        open={confirmState.open}
        message={confirmState.message}
        variant="info"
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState({ open: false, onConfirm: () => {}, message: '' })}
      />
    </div>
  )
}

function CustomerForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const usersData = useQuery({
    queryKey: ['users'],
    queryFn: () => get<any>('/api/users?pageSize=500'),
    staleTime: 60000,
    retry: false,
  }).data
  const users: any[] = Array.isArray(usersData) ? usersData : ((usersData as any)?.data || [])
  const isEdit = !!initial?.id

  const [f, setF] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    gender: initial?.gender || '',
    birthday: initial?.birthday || '',
    member_no: initial?.member_no || '',
    notes: initial?.notes || '',
    source: initial?.source || '',
    // 建档：auto=当前操作人（服务器默认）; 编辑/公海: none=null
    owner: isEdit ? (initial?.owner_user_id || 'none') : 'auto',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: any = {
      shop_id: shop_id || initial?.shop_id,
      name: f.name || null,
      phone: f.phone || null,
      gender: f.gender || null,
      birthday: f.birthday || null,
      member_no: f.member_no || null,
      notes: f.notes || null,
      source: f.source || null,
    }
    if (isEdit) {
      payload.owner_user_id = f.owner === 'none' ? null : f.owner
    } else if (f.owner !== 'auto') {
      payload.owner_user_id = f.owner === 'none' ? null : f.owner
    }
    onSubmit(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
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
                    className={`flex-1 py-1.5 rounded-lg text-xs border ${f.gender === g ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>{g}</button>
                ))}
              </div>
            </div>
            <Field label="生日" type="date" value={f.birthday} onChange={v => setF({ ...f, birthday: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="会员卡号" value={f.member_no} onChange={v => setF({ ...f, member_no: v })} />
            <Field label="来源(可选)" value={f.source} onChange={v => setF({ ...f, source: v })} placeholder="如 referral" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">归属人（拉新）</label>
            <select value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-tan/50">
              {!isEdit && <option value="auto">默认（当前操作人）</option>}
              <option value="none">公海（无归属）</option>
              {users.filter(u => u.active).map(u => (
                <option key={u.id} value={u.id}>{u.display_name || u.username}{u.tech_name ? ` (${u.tech_name})` : ''}</option>
              ))}
            </select>
            <div className="text-[10px] text-white/25 mt-1">谁拉来的客户算谁的：充值提成按归属人结算</div>
          </div>
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

function WalletHistoryModal({ customer, onClose, onRefund }: {
  customer: any; onClose: () => void; onRefund: (txn: any) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['wallet', customer.id],
    queryFn: () => get(`/api/customers/${customer.id}/wallet`),
  })
  const rows: any[] = Array.isArray(data) ? data : (data as any)?.data || []

  const typeLabel = (t: string) => t === 'topup' ? '充值' : t === 'topup_refund' ? '退卡' : t === 'consume' ? '消费' : t === 'refund' ? '退款' : t === 'adjust' ? '调整' : t

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-card w-full max-w-lg max-h-[80vh] flex flex-col p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">余额流水</h2>
            <p className="text-xs text-white/40 mt-0.5">
              {customer.name || '未命名'} · 当前余额 <span className="text-tan">{formatMoney(customer.balance_cents)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>

        {isLoading ? (
          <div className="text-center text-white/30 text-sm py-8">加载中...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-white/30 text-sm py-8">暂无流水记录</div>
        ) : (
          <div className="overflow-y-auto -mx-1 space-y-1.5">
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-1 py-2 rounded-lg hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className={r.amount_cents >= 0 ? 'text-moss' : 'text-cinnabar'}>{typeLabel(r.type)}</span>
                    {r.service_name && <span className="text-white/40 text-xs ml-2">{r.service_name}</span>}
                    {r.type === 'topup' && r.commission_cents > 0 && (
                      <span className="text-[10px] text-moss/80 border border-moss/30 rounded px-1 ml-2">提成 {formatMoney(r.commission_cents)}</span>
                    )}
                    {r.type === 'topup_refund' && r.commission_cents < 0 && (
                      <span className="text-[10px] text-cinnabar/80 border border-cinnabar/30 rounded px-1 ml-2">冲销 {formatMoney(r.commission_cents)}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/30">
                    {new Date(r.created_at).toLocaleString('zh-CN')}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-sm font-medium ${r.amount_cents >= 0 ? 'text-moss' : 'text-cinnabar'}`}>
                    {r.amount_cents >= 0 ? '+' : ''}{formatMoney(r.amount_cents)}
                  </div>
                  <div className="text-[10px] text-white/30">余 {formatMoney(r.balance_after)}</div>
                  {r.type === 'topup' && (
                    <button onClick={() => onRefund({ ...r, customer_id: customer.id })}
                      title="退卡" className="mt-0.5 p-0.5 text-white/25 hover:text-cinnabar rounded">
                      <Undo2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TopupForm({ customer, onSubmit, onClose, error, loading }: {
  customer: any; onSubmit: (amount: number) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [yuan, setYuan] = useState('')
  const presets = [100, 200, 500, 1000]
  const rulesData = useQuery({
    queryKey: ['topup-rules'],
    queryFn: () => get<any>('/api/topup-commission-rules'),
    staleTime: 30000,
    retry: false,
  }).data
  const rules: any[] = Array.isArray(rulesData) ? rulesData : ((rulesData as any)?.data || [])
  const amountCents = Math.round(Number(yuan || 0) * 100)
  const matched = amountCents > 0
    ? rules
        .filter(r => r.active && amountCents >= r.min_cents && (r.max_cents == null || amountCents <= r.max_cents))
        .sort((a, b) => b.min_cents - a.min_cents)[0]
    : null
  const previewCommission = matched
    ? (matched.commission_type === 'fixed' ? matched.commission_value : Math.round(amountCents * matched.commission_value / 10000))
    : 0
  const ownerLabel = customer.owner_name || customer.owner_username || '当次操作人'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
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
        <div className="text-xs text-white/40">
          提成归属：<span className="text-white/70">{ownerLabel}</span>
          {!customer.owner_user_id && <span className="text-white/25">（无归属，归当次操作人）</span>}
        </div>
        <div className="flex gap-2">
          {presets.map(p => (
            <button key={p} type="button" onClick={() => setYuan(String(p))}
              className={`flex-1 py-2 rounded-lg text-sm border ${yuan === String(p) ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>{p}</button>
          ))}
        </div>
        <div>
          <label className="block text-xs text-white/40 mb-1">金额(元)</label>
          <input type="number" value={yuan} onChange={e => setYuan(e.target.value)} placeholder="输入金额"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-tan/50" />
        </div>
        {amountCents > 0 && (
          <div className="text-xs rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center justify-between">
            <span className="text-white/40">预计提成</span>
            <span className={previewCommission > 0 ? 'text-moss' : 'text-white/30'}>
              {previewCommission > 0 ? `${formatMoney(previewCommission)} → ${ownerLabel}` : '无（未命中规则）'}
            </span>
          </div>
        )}
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <button onClick={() => onSubmit(Math.round(Number(yuan) * 100))} disabled={loading || !yuan || Number(yuan) <= 0}
          className="w-full bg-moss/80 hover:bg-moss disabled:opacity-30 text-white rounded-lg py-2.5 text-sm">
          {loading ? '充值中...' : `确认充值 ¥${yuan || 0}`}
        </button>
      </div>
    </div>
  )
}