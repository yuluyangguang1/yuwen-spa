import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSimpleCRUD } from '@/hooks/useCRUD'
import { get, post, put, del } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Plus, Edit2, Trash2, X, Package } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Field } from '@/components/Field'
import { EmptyState } from '@/components/EmptyState'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { InventoryPanel } from '@/components/InventoryPanel'

const CATEGORIES = ['饮品', '食品', '用品', '其他']

type Tab = 'products' | 'inventory'

export default function AdminProducts() {
  const [tab, setTab] = useState<Tab>('products')
  const {
    data: products = [],
    isLoading,
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
    queryKey: ['products'],
    queryFn: () => get('/api/products?pageSize=500'),
    createFn: (data: any) => post('/api/products', data),
    updateFn: (id: string, data: any) => put(`/api/products/${id}`, data),
    deleteFn: (id: string) => del(`/api/products/${id}`),
  })

  const { data: invSummary } = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => get('/api/inventory/summary?low=10'),
  })
  const lowThreshold = invSummary?.low_threshold ?? 10

  const tabs: { id: Tab; label: string }[] = [
    { id: 'products', label: '商品' },
    { id: 'inventory', label: '库存流水' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-medium">食物用品管理</h1>
          <div role="tablist" aria-label="商品管理视图" className="flex gap-1 bg-white/5 border border-white/10 p-1 rounded-lg">
            {tabs.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${
                  tab === t.id ? 'bg-tan/15 text-tan' : 'text-white/50 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'products' && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
            <Plus size={14} /> 新增商品
          </button>
        )}
      </div>

      {tab === 'inventory' ? (
        <InventoryPanel />
      ) : isLoading && !products.length ? (
        <div className="glass-card p-4"><TableSkeleton rows={6} /></div>
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="暂无商品"
          hint="上架食物与用品后，顾客可在房间扫码点单"
          action={{ label: '新增商品', onClick: () => setShowForm(true) }} />
      ) : (
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">名称</th>
              <th className="text-left p-3">分类</th>
              <th className="text-right p-3">价格</th>
              <th className="text-right p-3">库存</th>
              <th className="text-center p-3">状态</th>
              <th className="text-center p-3 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p: any) => (
              <tr key={p.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 text-white/50">{p.category}</td>
                <td className="p-3 text-right text-tan">{formatMoney(p.price_cents)}</td>
                <td className={`p-3 text-right ${
                  p.stock === 0 ? 'text-red-400' :
                  p.stock != null && p.stock <= lowThreshold ? 'text-amber-300' : 'text-white/50'
                }`}>
                  {p.stock == null ? '不限' : p.stock}
                </td>
                <td className="p-3 text-center">
                  <button onClick={() => updateMut.mutate({ id: p.id, active: p.active ? 0 : 1 })}
                    className={`text-xs px-2 py-0.5 rounded cursor-pointer ${p.active ? 'bg-moss/15 text-moss' : 'bg-white/5 text-white/30'}`}>{
                    p.active ? '上架' : '下架'
                  }</button>
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setEditItem(p)} className="p-1.5 text-white/50 hover:text-tan rounded"><Edit2 size={14} /></button>
                    <button onClick={() => requestDelete(`下架「${p.name}」？`, () => deleteMut.mutate(p.id))} className="p-1.5 text-white/50 hover:text-red-400 rounded"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {showForm && <ProductForm title="新增商品" shop_id={products[0]?.shop_id}
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editItem && <ProductForm title="编辑商品" initial={editItem}
        onSubmit={(d) => updateMut.mutate({ id: editItem.id, ...d })} onClose={() => setEditItem(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}

      <ConfirmDialog
        open={confirmState.open}
        title="下架商品"
        message={confirmState.message}
        variant="danger"
        onConfirm={() => { confirmState.onConfirm(); closeConfirm() }}
        onCancel={closeConfirm}
      />
    </div>
  )
}

function ProductForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    name: initial?.name || '',
    category: initial?.category || '饮品',
    price_yuan: initial ? (initial.price_cents / 100).toString() : '',
    stock: initial?.stock?.toString() ?? '',
    sort_order: initial?.sort_order ?? 0,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      shop_id: shop_id || initial?.shop_id,
      name: f.name,
      category: f.category,
      price_cents: Math.round(Number(f.price_yuan) * 100),
      stock: f.stock === '' ? null : Number(f.stock),
      sort_order: Number(f.sort_order) || 0,
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
          <Field label="商品名称" value={f.name} onChange={v => setF({ ...f, name: v })} required />
          <div>
            <label className="block text-xs text-white/40 mb-1">分类</label>
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => setF({ ...f, category: c })}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${f.category === c ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="价格(元)" type="number" value={f.price_yuan} onChange={v => setF({ ...f, price_yuan: v })} required />
            <Field label="库存(空=不限)" type="number" value={f.stock} onChange={v => setF({ ...f, stock: v })} />
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
