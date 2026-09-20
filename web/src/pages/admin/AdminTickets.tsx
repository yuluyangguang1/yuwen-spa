import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney, statusLabel, statusColor } from '@/lib/utils'
import { Download, Filter } from 'lucide-react'

function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function AdminTickets() {
  const [dateFrom, setDateFrom] = useState(daysAgo(7))
  const [dateTo, setDateTo] = useState(today())
  const [status, setStatus] = useState('')
  const [techId, setTechId] = useState('')

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })

  const fromTs = new Date(dateFrom).getTime()
  const toTs = new Date(dateTo).getTime() + 86400000

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-all', dateFrom, dateTo, status, techId],
    queryFn: () => get(`/api/tickets?limit=500&date_from=${fromTs}&date_to=${toTs}${status ? `&status=${status}` : ''}${techId ? `&technician_id=${techId}` : ''}`),
  })

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
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
          <span className="text-white/30 text-xs">至</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
          <option value="">全部状态</option>
          <option value="active">进行中</option>
          <option value="completed">待结账</option>
          <option value="paid">已结账</option>
          <option value="canceled">已取消</option>
        </select>
        <select value={techId} onChange={e => setTechId(e.target.value)}
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
              <th className="text-left p-3">时间</th>
              <th className="text-left p-3">项目</th>
              <th className="text-left p-3">技师</th>
              <th className="text-left p-3">房间</th>
              <th className="text-left p-3">顾客</th>
              <th className="text-right p-3">金额</th>
              <th className="text-right p-3">提成</th>
              <th className="text-center p-3">状态</th>
              <th className="text-left p-3">支付</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t: any) => (
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
