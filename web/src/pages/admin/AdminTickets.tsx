import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { get } from '@/lib/api'
import { formatMoney, statusLabel, statusColor } from '@/lib/utils'
import { Download, Filter } from 'lucide-react'
import { TableSkeleton } from '@/components/LoadingSkeleton'

function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

type SortKey = 'time' | 'service' | 'technician' | 'room' | 'customer' | 'price' | 'commission' | 'status' | 'payment'
type SortDir = 'asc' | 'desc'

export default function AdminTickets() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Read filters from URL, default to last 7 days
  const dateFrom = searchParams.get('dateFrom') || daysAgo(7)
  const dateTo = searchParams.get('dateTo') || today()
  const status = searchParams.get('status') || ''
  const techId = searchParams.get('techId') || ''

  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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
    queryFn: () => get('/api/technicians'),
  })

  const fromTs = new Date(dateFrom).getTime()
  const toTs = new Date(dateTo).getTime() + 86400000

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['tickets-all', dateFrom, dateTo, status, techId],
    queryFn: () => get(`/api/tickets?limit=500&date_from=${fromTs}&date_to=${toTs}${status ? `&status=${status}` : ''}${techId ? `&technician_id=${techId}` : ''}`),
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

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

  // 统计
  const stats = useMemo(() => {
    const paid = tickets.filter((t: any) => t.status === 'paid')
    return {
      total: tickets.length,
      revenue: paid.reduce((s: number, t: any) => s + t.price_cents, 0),
      commission: paid.reduce((s: number, t: any) => s + t.commission_cents, 0),
      paid: paid.length,
    }
  }, [tickets])

  // 导出 CSV
  const exportCSV = () => {
    const headers = ['时间', '项目', '技师', '房间', '顾客', '金额', '提成', '状态', '支付方式']
    const rows = tickets.map((t: any) => [
      new Date(t.created_at).toLocaleString('zh-CN'),
      t.service_name || '',
      t.technician_name || '',
      t.room_number || '',
      t.customer_name || '散客',
      (t.price_cents / 100).toFixed(2),
      (t.commission_cents / 100).toFixed(2),
      statusLabel(t.status),
      t.payment_method || '',
    ])
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n')
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

      {/* 筛选栏 */}
      <div className="glass-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-white/30" />
          <input type="date" value={dateFrom} onChange={e => setFilters({ dateFrom: e.target.value })}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
          <span className="text-white/30 text-xs">至</span>
          <input type="date" value={dateTo} onChange={e => setFilters({ dateTo: e.target.value })}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
        </div>
        <select value={status} onChange={e => setFilters({ status: e.target.value })}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
          <option value="">全部状态</option>
          <option value="active">进行中</option>
          <option value="completed">待结账</option>
          <option value="paid">已结账</option>
          <option value="canceled">已取消</option>
        </select>
        <select value={techId} onChange={e => setFilters({ techId: e.target.value })}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
          <option value="">全部技师</option>
          {technicians.map((t: any) => (
            <option key={t.id} value={t.id}>{t.number} {t.name}</option>
          ))}
        </select>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-2">
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/40">钟数</div>
          <div className="text-lg font-medium">{stats.total}</div>
        </div>
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/40">已结</div>
          <div className="text-lg font-medium text-moss">{stats.paid}</div>
        </div>
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/40">营收</div>
          <div className="text-lg font-medium text-tan">{formatMoney(stats.revenue)}</div>
        </div>
        <div className="glass-card p-2 text-center">
          <div className="text-[10px] text-white/40">提成</div>
          <div className="text-lg font-medium text-moss">{formatMoney(stats.commission)}</div>
        </div>
      </div>

      {/* 列表 */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
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
            {sortedTickets.map((t: any) => (
              <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="p-3 text-white/40 text-xs whitespace-nowrap">
                  {new Date(t.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="p-3">{t.service_name}</td>
                <td className="p-3 text-white/60">{t.technician_name || '-'}</td>
                <td className="p-3 text-white/40">{t.room_number || '-'}</td>
                <td className="p-3 text-white/40">{t.customer_name || '散客'}</td>
                <td className="p-3 text-right text-tan">{formatMoney(t.price_cents)}</td>
                <td className="p-3 text-right text-moss">{formatMoney(t.commission_cents)}</td>
                <td className="p-3 text-center">
                  <span className={`text-xs ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
                </td>
                <td className="p-3 text-white/40 text-xs">{t.payment_method || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
