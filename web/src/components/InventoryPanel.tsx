import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { PackagePlus, PackageMinus, SlidersHorizontal, X, Download } from 'lucide-react'
import { Field } from '@/components/Field'

// 库存面板（已合并入商品页 Tab）：概览瓦片 + 出入库操作 + 流水

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  in: { label: '入库', cls: 'bg-moss/15 text-moss' },
  out: { label: '出库', cls: 'bg-red-500/15 text-red-300' },
  adjust: { label: '盘点', cls: 'bg-sky-500/15 text-sky-300' },
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function InventoryPanel() {
  const qc = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showForm, setShowForm] = useState<null | 'in' | 'out' | 'adjust'>(null)

  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => get('/api/inventory/summary?low=10'),
  })

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['inventory', 'movements', typeFilter, productFilter, dateFrom, dateTo],
    queryFn: () => get(
      `/api/inventory/movements?pageSize=100${typeFilter ? `&type=${typeFilter}` : ''}${
        productFilter ? `&product_id=${productFilter}` : ''}${
        fromMs != null ? `&date_from=${fromMs}` : ''}${
        toMs != null ? `&date_to=${toMs}` : ''}`
    ),
  })

  function exportCsv() {
    const header = ['时间', '商品', '类型', '变动', '结余', '来源', '备注']
    const typeLabel = (t: string) => TYPE_LABEL[t]?.label || t
    const rows = (movements as any[]).map(m => [
      new Date(m.created_at).toLocaleString('zh-CN'),
      m.product_name || '',
      typeLabel(m.type),
      String(m.qty),
      m.stock_after ?? '',
      m.ref_type || '',
      (m.notes || '').replace(/"/g, '""'),
    ])
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `库存流水-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const moveMut = useMutation({
    mutationFn: (body: any) => post('/api/inventory/movements', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      setShowForm(null)
    },
  })

  const products: any[] = summary?.products || []
  const lowStock: any[] = summary?.low_stock || []

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="glass-card p-3">
          <div className="text-[10px] text-white/40">商品总数</div>
          <div className="text-lg font-medium">{sumLoading ? '—' : products.length}</div>
        </div>
        <div className="glass-card p-3">
          <div className="text-[10px] text-white/40">跟踪库存</div>
          <div className="text-lg font-medium">{summary?.tracked_count ?? '—'}</div>
        </div>
        <div className="glass-card p-3">
          <div className="text-[10px] text-white/40">低库存 (≤{summary?.low_threshold ?? 10})</div>
          <div className={`text-lg font-medium ${lowStock.length ? 'text-amber-300' : ''}`}>
            {lowStock.length}
          </div>
        </div>
        <div className="glass-card p-3">
          <div className="text-[10px] text-white/40">缺货</div>
          <div className={`text-lg font-medium ${(summary?.out_of_stock || []).length ? 'text-red-400' : ''}`}>
            {(summary?.out_of_stock || []).length}
          </div>
        </div>
      </div>

      {/* 出入库操作 */}
      <div className="flex justify-end gap-1.5">
        <button onClick={() => setShowForm('in')}
          className="flex items-center gap-1 bg-moss/20 text-moss border border-moss/30 px-3 py-1.5 rounded-lg text-xs">
          <PackagePlus size={14} /> 入库
        </button>
        <button onClick={() => setShowForm('out')}
          className="flex items-center gap-1 bg-red-500/15 text-red-300 border border-red-500/30 px-3 py-1.5 rounded-lg text-xs">
          <PackageMinus size={14} /> 出库
        </button>
        <button onClick={() => setShowForm('adjust')}
          className="flex items-center gap-1 bg-sky-500/15 text-sky-300 border border-sky-500/30 px-3 py-1.5 rounded-lg text-xs">
          <SlidersHorizontal size={14} /> 盘点
        </button>
      </div>

      {/* 流水 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm text-white/50">出入库流水 ({movements.length})</h2>
          <div className="flex gap-1.5 flex-wrap">
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="类型"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs">
              <option value="">全部类型</option>
              <option value="in">入库</option>
              <option value="out">出库</option>
              <option value="adjust">盘点</option>
            </select>
            <select value={productFilter} onChange={e => setProductFilter(e.target.value)} aria-label="商品"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs max-w-[160px]">
              <option value="">全部商品</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="开始日期"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/60" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="结束日期"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/60" />
            <button onClick={exportCsv} disabled={!movements.length}
              className="flex items-center gap-1 border border-white/10 text-white/50 hover:text-tan px-2 py-1 rounded text-xs disabled:opacity-30">
              <Download size={12} /> 导出CSV
            </button>
          </div>
        </div>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="text-left p-3">时间</th>
                <th className="text-left p-3">商品</th>
                <th className="text-center p-3">类型</th>
                <th className="text-right p-3">变动</th>
                <th className="text-right p-3">结余</th>
                <th className="text-left p-3">来源</th>
                <th className="text-left p-3">备注</th>
              </tr>
            </thead>
            <tbody>
              {(movements as any[]).map(m => {
                const t = TYPE_LABEL[m.type] || { label: m.type, cls: 'bg-white/5 text-white/40' }
                return (
                  <tr key={m.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="p-3 text-white/40 text-xs whitespace-nowrap">{fmt(m.created_at)}</td>
                    <td className="p-3">{m.product_name || '—'}</td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                    </td>
                    <td className={`p-3 text-right font-mono ${m.qty > 0 ? 'text-moss' : 'text-red-300'}`}>
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </td>
                    <td className="p-3 text-right text-white/50 font-mono">{m.stock_after ?? '—'}</td>
                    <td className="p-3 text-xs text-white/40">{m.ref_type || '—'}</td>
                    <td className="p-3 text-xs text-white/40 truncate max-w-[160px]">{m.notes || ''}</td>
                  </tr>
                )
              })}
              {!isLoading && !movements.length && (
                <tr><td colSpan={7} className="p-6 text-center text-white/30 text-sm">暂无流水</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <MoveForm
          type={showForm}
          products={products}
          onSubmit={d => moveMut.mutate(d)}
          onClose={() => setShowForm(null)}
          error={moveMut.error?.message}
          loading={moveMut.isPending}
        />
      )}
    </div>
  )
}

function MoveForm({ type, products, onSubmit, onClose, error, loading }: {
  type: 'in' | 'out' | 'adjust'
  products: any[]
  onSubmit: (d: any) => void
  onClose: () => void
  error?: string
  loading?: boolean
}) {
  const tracked = products.filter(p => p.stock != null || type === 'adjust')
  const [productId, setProductId] = useState(tracked[0]?.id || '')
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const selected = products.find(p => p.id === productId)

  const title = type === 'in' ? '入库' : type === 'out' ? '出库' : '盘点调整'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(qty)
    if (!productId || !Number.isInteger(n) || n === 0) return
    // 盘点：qty 填目标结余 → 转为差值；入库/出库填数量（绝对值）
    if (type === 'adjust') {
      const before = selected?.stock
      if (before == null) {
        onSubmit({ product_id: productId, type: 'adjust', qty: Math.abs(n), notes })
      } else {
        onSubmit({ product_id: productId, type: 'adjust', qty: n - before, notes })
      }
    } else {
      onSubmit({ product_id: productId, type, qty: Math.abs(n), notes })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1">商品</label>
            <select value={productId} onChange={e => setProductId(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">选择商品</option>
              {tracked.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.stock != null ? `（当前 ${p.stock}）` : '（不限）'}
                </option>
              ))}
            </select>
          </div>
          <Field
            label={type === 'adjust' ? '盘点后结余' : '数量'}
            type="number"
            value={qty}
            onChange={setQty}
            required
            placeholder={type === 'adjust' ? '实际清点数量' : '正整数'}
          />
          <Field label="备注" value={notes} onChange={setNotes} placeholder="可选" />
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <button type="submit" disabled={loading || !productId || !qty}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
            {loading ? '提交中...' : '确认'}
          </button>
        </form>
      </div>
    </div>
  )
}
