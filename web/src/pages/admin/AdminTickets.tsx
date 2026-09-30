import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { get, post } from '@/lib/api'
import { formatMoney, statusLabel, statusColor } from '@/lib/utils'
import { Download, Filter, Printer, Undo2, ClipboardList } from 'lucide-react'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { EmptyState } from '@/components/EmptyState'
import { openPrintReceipt } from '@/components/Receipt'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/lib/toast'

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function today() { return ymd(new Date()) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
// "YYYY-MM-DD" → 本地零点时间戳（new Date(str) 会按 UTC 解析，凌晨区间会错一天）
function localYmdTs(s: string, endOfDay = false) {
  const [y, m, dd] = s.split('-').map(Number)
  const d = new Date(y, (m || 1) - 1, dd || 1)
  if (endOfDay) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d.getTime()
}

type SortKey = 'time' | 'service' | 'technician' | 'room' | 'customer' | 'price' | 'commission' | 'status' | 'payment'
type SortDir = 'asc' | 'desc'

// 固定行高虚拟滚动：500+ 行只渲染视口附近
const ROW_H = 44
const OVERSCAN = 8

function useVirtualRange(count: number) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight || 600))
    setViewportH(el.clientHeight || 600)
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(count, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const padTop = start * ROW_H
  const padBottom = Math.max(0, (count - end) * ROW_H)

  return { scrollRef, start, end, padTop, padBottom }
}

export default function AdminTickets() {
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const [refundTarget, setRefundTarget] = useState<any | null>(null)

  // Read filters from URL, default to last 7 days
  const dateFrom = searchParams.get('dateFrom') || daysAgo(7)
  const dateTo = searchParams.get('dateTo') || today()
  const status = searchParams.get('status') || ''
  const techId = searchParams.get('techId') || ''

  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [printErr, setPrintErr] = useState('')
  const [printing, setPrinting] = useState(false)

  const refundMut = useMutation({
    mutationFn: ({ id, reason }: any) => post(`/api/tickets/${id}/refund`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets-all'] })
      qc.invalidateQueries({ queryKey: ['tickets-today'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['live'] })
      toast.success('退款成功')
      setRefundTarget(null)
    },
    onError: (e: any) => toast.error(e.message || '退款失败'),
  })

  // Set URL params whenever filters change
  const setFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([k, v]) => {
      if (v === '' || v === daysAgo(7) || v === today()) params.delete(k)
      else params.set(k, v)
    })
    setSearchParams(params, { replace: true })
  }

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })

  const fromTs = localYmdTs(dateFrom)
  const toTs = localYmdTs(dateTo, true)

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['tickets-all', dateFrom, dateTo, status, techId],
    queryFn: () => get(`/api/tickets?pageSize=500&date_from=${fromTs}&date_to=${toTs}${status ? `&status=${status}` : ''}${techId ? `&technician_id=${techId}` : ''}`),
    // 筛选切换时保留旧数据，避免整页骨架闪烁
    placeholderData: (prev: any) => prev,
  })

  const sortedTickets = useMemo(() => {
    const sorted = [...tickets]
    sorted.sort((a: any, b: any) => {
      let av: any, bv: any
      switch (sortKey) {
        case 'time': av = new Date(a.created_at).getTime(); bv = new Date(b.created_at).getTime(); break
        case 'service': av = a.service_name || ''; bv = b.service_name || ''; break
        case 'technician': av = a.technician_name || ''; bv = b.technician_name || ''; break
        case 'room': av = a.room_number || ''; bv = b.room_number || ''; break
        case 'customer': av = a.customer_name || ''; bv = b.customer_name || ''; break
        case 'price': av = a.price_cents; bv = b.price_cents; break
        case 'commission': av = a.commission_cents; bv = b.commission_cents; break
        case 'status': av = a.status; bv = b.status; break
        case 'payment': av = a.payment_method || ''; bv = b.payment_method || ''; break
        default: av = 0; bv = 0
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return sorted
  }, [tickets, sortKey, sortDir])

  const { scrollRef, start, end, padTop, padBottom } = useVirtualRange(sortedTickets.length)
  const visibleRows = sortedTickets.slice(start, end)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const printReceipt = async (id: string) => {
    setPrinting(true)
    setPrintErr('')
    try {
      const data = await get(`/api/tickets/${id}/receipt`)
      openPrintReceipt(data)
    } catch (e: any) {
      setPrintErr(e.message || '获取收据失败')
      toast.error(e.message || '获取收据失败')
    } finally {
      setPrinting(false)
    }
  }

  // 统计（必须在 isLoading 早退之前调用，避免 Hooks 顺序不一致）
  const stats = useMemo(() => {
    const paid = tickets.filter((t: any) => t.status === 'paid')
    return {
      total: tickets.length,
      revenue: paid.reduce((s: number, t: any) => s + t.price_cents, 0),
      commission: paid.reduce((s: number, t: any) => s + t.commission_cents, 0),
      paid: paid.length,
    }
  }, [tickets])

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-8 bg-[#2a2a29] animate-pulse rounded-lg w-48" />
        <div className="glass-card p-3 flex flex-wrap items-center gap-3">
          <div className="h-6 w-32 animate-pulse bg-[#2a2a29] rounded" />
          <div className="h-6 w-24 animate-pulse bg-[#2a2a29] rounded" />
          <div className="h-6 w-24 animate-pulse bg-[#2a2a29] rounded" />
        </div>
        <TableSkeleton rows={8} />
      </div>
    )
  }

  // 导出 CSV（字段转义：含逗号/引号/换行时包双引号）
  const csvCell = (v: string) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const exportCSV = () => {
    const headers = ['时间', '项目', '技师', '房间', '顾客', '金额', '提成', '状态', '履约', '支付方式']
    const rows = tickets.map((t: any) => [
      new Date(t.created_at).toLocaleString('zh-CN'),
      t.service_name || '',
      t.technician_name || '',
      t.room_number || '',
      t.customer_name || '散客',
      (t.price_cents / 100).toFixed(2),
      (t.commission_cents / 100).toFixed(2),
      statusLabel(t.status),
      t.fulfillment === 'self' ? '自提' : '到店',
      t.payment_method || '',
    ])
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `钟单_${dateFrom}_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">钟单记录</h1>
        <button onClick={exportCSV} disabled={tickets.length === 0}
          className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/60 hover:text-tan px-3 py-1.5 rounded-lg text-xs disabled:opacity-30">
          <Download size={14} /> 导出 CSV
        </button>
      </div>

      {printErr && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {printErr}
        </div>
      )}

      {/* 筛选栏 */}
      <div className="glass-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-white/30" aria-label="筛选" />
          <input type="date" aria-label="开始日期" value={dateFrom} onChange={e => setFilters({ dateFrom: e.target.value })}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
          <span className="text-white/30 text-xs">至</span>
          <input type="date" aria-label="结束日期" value={dateTo} onChange={e => setFilters({ dateTo: e.target.value })}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
        </div>
        <select aria-label="状态筛选" value={status} onChange={e => setFilters({ status: e.target.value })}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
          <option value="">全部状态</option>
          <option value="pending">待开钟/待派</option>
          <option value="active">进行中</option>
          <option value="completed">待结账</option>
          <option value="paid">已结账</option>
          <option value="refunded">已退款</option>
          <option value="canceled">已取消</option>
        </select>
        <select aria-label="技师筛选" value={techId} onChange={e => setFilters({ techId: e.target.value })}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
          <option value="">全部技师</option>
          {technicians.map((t: any) => (
            <option key={t.id} value={t.id}>{t.number} {t.name}</option>
          ))}
        </select>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/50">钟数</div>
          <div className="text-lg font-medium">{stats.total}</div>
        </div>
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/50">已结</div>
          <div className="text-lg font-medium text-moss">{stats.paid}</div>
        </div>
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/50">营收</div>
          <div className="text-lg font-medium text-tan">{formatMoney(stats.revenue)}</div>
        </div>
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/50">提成</div>
          <div className="text-lg font-medium text-moss">{formatMoney(stats.commission)}</div>
        </div>
      </div>
      {tickets.length >= 500 && (
        <div className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          所选区间条数已达列表上限 500，统计与导出仅覆盖前 500 条 —— 请缩小日期区间。
        </div>
      )}

      {/* 列表：固定行高虚拟滚动（>80 行才启用视口裁剪） */}
      {!tickets.length && (
        <EmptyState icon={ClipboardList} title="该区间暂无钟单" hint="调整日期区间，或等待开钟后自动出现" />
      )}
      {tickets.length > 0 && (
      <div className="glass-card overflow-x-auto">
        <div
          ref={scrollRef}
          className="max-h-[min(70vh,720px)] overflow-y-auto"
          role="region"
          aria-label="钟单列表"
        >
          <table className="w-full text-sm min-w-[700px]">
            <thead className="sticky top-0 z-10 bg-[#1a1a18]">
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="text-left p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('time')}>时间{sortIcon('time')}</th>
                <th className="text-left p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('service')}>项目{sortIcon('service')}</th>
                <th className="text-left p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('technician')}>技师{sortIcon('technician')}</th>
                <th className="text-left p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('room')}>房间{sortIcon('room')}</th>
                <th className="text-left p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('customer')}>顾客{sortIcon('customer')}</th>
                <th className="text-right p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('price')}>金额{sortIcon('price')}</th>
                <th className="text-right p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('commission')}>提成{sortIcon('commission')}</th>
                <th className="text-center p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('status')}>状态{sortIcon('status')}</th>
                <th className="text-left p-3 cursor-pointer hover:text-white/70 select-none" onClick={() => handleSort('payment')}>支付{sortIcon('payment')}</th>
              </tr>
            </thead>
            <tbody>
              {padTop > 0 && (
                <tr aria-hidden="true" style={{ height: padTop }}>
                  <td colSpan={9} className="p-0 border-0" />
                </tr>
              )}
              {visibleRows.map((t: any) => (
                <tr key={t.id} style={{ height: ROW_H }} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-3 text-white/40 text-xs whitespace-nowrap">
                    {new Date(t.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-3">{t.service_name}</td>
                  <td className="px-3 text-white/60">{t.technician_name || '-'}</td>
                  <td className="px-3 text-white/40">{t.room_number || '-'}</td>
                  <td className="px-3 text-white/40">{t.customer_name || '散客'}</td>
                  <td className="px-3 text-right text-tan">{formatMoney(t.price_cents)}</td>
                  <td className="px-3 text-right text-moss">{formatMoney(t.commission_cents)}</td>
                  <td className="px-3 text-center">
                    <span className={`text-xs ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
                  </td>
                  <td className="px-3 text-white/40 text-xs">
                    {t.fulfillment === 'self' && (
                      <span className="mr-1 px-1 py-0.5 rounded bg-tan/15 text-tan text-[10px]">自提</span>
                    )}
                    {t.payment_method || '-'}
                    {t.status === 'paid' && (
                      <>
                        <button
                          onClick={() => printReceipt(t.id)}
                          disabled={printing}
                          title="打印收据 / 存 PDF"
                          aria-label="打印收据"
                          className="ml-1.5 p-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center align-middle text-white/50 hover:text-tan rounded disabled:opacity-40"
                        >
                          <Printer size={14} />
                        </button>
                        <button
                          onClick={() => setRefundTarget(t)}
                          title="退款 / 反结账"
                          aria-label="退款"
                          className="ml-0.5 p-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center align-middle text-white/50 hover:text-cinnabar rounded"
                        >
                          <Undo2 size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: padBottom }}>
                  <td colSpan={9} className="p-0 border-0" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
      {sortedTickets.length > 0 && (
        <div className="text-[11px] text-white/40 text-right">
          共 {sortedTickets.length} 条
        </div>
      )}

      <ConfirmDialog
        open={!!refundTarget}
        title="退款 / 反结账"
        message={refundTarget
          ? `确认退还「${refundTarget.service_name}」${formatMoney(refundTarget.price_cents)}（${refundTarget.payment_method || '原路'}）？状态将变为已退款，报表不再计入营收。`
          : ''}
        confirmLabel="确认退款"
        variant="danger"
        loading={refundMut.isPending}
        onConfirm={() => refundTarget && refundMut.mutate({ id: refundTarget.id, reason: '前台反结账' })}
        onCancel={() => setRefundTarget(null)}
      />
    </div>
  )
}
