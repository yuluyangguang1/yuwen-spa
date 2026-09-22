// 经营报表：日营收 / 技师绩效 / 项目维度 / 支付方式
// 后端 /api/reports/* 此前无前端消费方，本页为唯一入口。

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Download, BarChart3 } from 'lucide-react'
import { TableSkeleton } from '@/components/LoadingSkeleton'

type Tab = 'daily' | 'tech' | 'service' | 'payment'

const TABS: { key: Tab; label: string }[] = [
  { key: 'daily', label: '日营收' },
  { key: 'tech', label: '技师绩效' },
  { key: 'service', label: '项目维度' },
  { key: 'payment', label: '支付方式' },
]

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
function toDateStart(s: string) { return new Date(s).setHours(0, 0, 0, 0) }
function toDateEnd(s: string) { return new Date(s).setHours(23, 59, 59, 999) }

const PAYMENT_LABEL: Record<string, string> = {
  cash: '现金', wechat: '微信', alipay: '支付宝', balance: '余额', card: '银行卡', unknown: '未知',
}

export default function AdminReports() {
  const [tab, setTab] = useState<Tab>('daily')
  const [dateFrom, setDateFrom] = useState(daysAgo(29))
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))

  const range = `date_from=${toDateStart(dateFrom)}&date_to=${toDateEnd(dateTo)}`
  const days = Math.max(1, Math.round((toDateEnd(dateTo) - toDateStart(dateFrom)) / 86400000) + 1)

  const dailyQ = useQuery({
    queryKey: ['reports', 'daily', dateFrom, dateTo],
    queryFn: () => get(`/api/reports/daily?pageSize=500&days=${days}`),
    enabled: tab === 'daily',
  })
  const techQ = useQuery({
    queryKey: ['reports', 'tech', dateFrom, dateTo],
    queryFn: () => get(`/api/reports/tech?pageSize=500&${range}`),
    enabled: tab === 'tech',
  })
  const serviceQ = useQuery({
    queryKey: ['reports', 'service', dateFrom, dateTo],
    queryFn: () => get(`/api/reports/service?pageSize=500&${range}`),
    enabled: tab === 'service',
  })
  const paymentQ = useQuery({
    queryKey: ['reports', 'payment', dateFrom, dateTo],
    queryFn: () => get(`/api/reports/payment?pageSize=500&${range}`),
    enabled: tab === 'payment',
  })
  const summaryQ = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: () => get('/api/reports/summary'),
  })

  const active = tab === 'daily' ? dailyQ : tab === 'tech' ? techQ : tab === 'service' ? serviceQ : paymentQ
  const rows: any[] = Array.isArray(active.data) ? active.data : (active.data as any)?.data || []
  const summary = summaryQ.data

  const exportUrl = () =>
    `/api/reports/export?type=${tab}&format=csv&date_from=${toDateStart(dateFrom)}`

  const download = async () => {
    const token = localStorage.getItem('yuwen_token')
    const res = await fetch(exportUrl(), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `报表_${tab}_${dateFrom}_${dateTo}.${tab === 'daily' || tab === 'tech' ? 'csv' : 'csv'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <BarChart3 size={18} className="text-tan" /> 经营报表
        </h1>
        <button onClick={download}
          className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/60 hover:text-tan px-3 py-1.5 rounded-lg text-xs">
          <Download size={14} /> 导出 CSV
        </button>
      </div>

      {/* 摘要 */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="glass-card p-3 text-center">
            <div className="text-xs text-white/40">今日单数</div>
            <div className="text-xl font-medium mt-1">{summary.today?.tickets ?? 0}</div>
          </div>
          <div className="glass-card p-3 text-center">
            <div className="text-xs text-white/40">今日营收</div>
            <div className="text-xl font-medium text-tan mt-1">{formatMoney(summary.today?.revenue || 0)}</div>
          </div>
          <div className="glass-card p-3 text-center">
            <div className="text-xs text-white/40">本月营收</div>
            <div className="text-xl font-medium text-moss mt-1">{formatMoney(summary.month?.revenue || 0)}</div>
          </div>
          <div className="glass-card p-3 text-center">
            <div className="text-xs text-white/40">在岗 / 房间</div>
            <div className="text-xl font-medium mt-1">
              {summary.counts?.technicians ?? 0} / {summary.counts?.rooms ?? 0}
            </div>
          </div>
        </div>
      )}

      {/* 日期范围 */}
      <div className="glass-card p-3 flex flex-wrap items-center gap-3">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
        <span className="text-white/30 text-xs">至</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-tan/50" />
        <div className="flex gap-1 ml-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                tab === t.key ? 'bg-tan/15 text-tan border border-tan/30' : 'text-white/40 border border-transparent hover:text-white/70'
              }`}>{t.label}</button>
          ))}
        </div>
      </div>

      {active.isLoading ? (
        <TableSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/30 text-sm">该时间段暂无数据</div>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                {tab === 'daily' && (
                  <>
                    <th className="text-left p-3">日期</th>
                    <th className="text-right p-3">总单</th>
                    <th className="text-right p-3">已结</th>
                    <th className="text-right p-3">营收</th>
                    <th className="text-right p-3">客单价</th>
                  </>
                )}
                {tab === 'tech' && (
                  <>
                    <th className="text-left p-3">技师</th>
                    <th className="text-right p-3">单数</th>
                    <th className="text-right p-3">已结</th>
                    <th className="text-right p-3">营收</th>
                    <th className="text-right p-3">提成</th>
                  </>
                )}
                {tab === 'service' && (
                  <>
                    <th className="text-left p-3">项目</th>
                    <th className="text-left p-3">分类</th>
                    <th className="text-right p-3">单数</th>
                    <th className="text-right p-3">已结</th>
                    <th className="text-right p-3">营收</th>
                    <th className="text-right p-3">客单价</th>
                  </>
                )}
                {tab === 'payment' && (
                  <>
                    <th className="text-left p-3">支付方式</th>
                    <th className="text-right p-3">笔数</th>
                    <th className="text-right p-3">营收</th>
                    <th className="text-right p-3">占比</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {tab === 'daily' && rows.map((r: any) => (
                <tr key={r.report_date} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3 text-white/60">{r.report_date}</td>
                  <td className="p-3 text-right">{r.total_tickets}</td>
                  <td className="p-3 text-right text-moss">{r.paid_tickets}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(r.revenue)}</td>
                  <td className="p-3 text-right text-white/50">{formatMoney(Math.round(r.avg_revenue || 0))}</td>
                </tr>
              ))}
              {tab === 'tech' && rows.map((r: any) => (
                <tr key={r.technician_id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3">{r.number} {r.name}</td>
                  <td className="p-3 text-right">{r.ticket_count}</td>
                  <td className="p-3 text-right text-moss">{r.paid_count}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(r.total_revenue)}</td>
                  <td className="p-3 text-right text-moss">{formatMoney(r.total_commission)}</td>
                </tr>
              ))}
              {tab === 'service' && rows.map((r: any) => (
                <tr key={r.service_id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 text-white/40 text-xs">{r.category || '-'}</td>
                  <td className="p-3 text-right">{r.ticket_count}</td>
                  <td className="p-3 text-right text-moss">{r.paid_count}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(r.total_revenue)}</td>
                  <td className="p-3 text-right text-white/50">{formatMoney(Math.round(r.avg_ticket || 0))}</td>
                </tr>
              ))}
              {tab === 'payment' && rows.map((r: any) => {
                const totalRev = rows.reduce((s: number, x: any) => s + (x.total_revenue || 0), 0) || 1
                const pct = Math.round(((r.total_revenue || 0) / totalRev) * 100)
                return (
                  <tr key={r.payment_method} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="p-3">{PAYMENT_LABEL[r.payment_method] || r.payment_method}</td>
                    <td className="p-3 text-right">{r.paid_count}</td>
                    <td className="p-3 text-right text-tan">{formatMoney(r.total_revenue)}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-tan/60 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-white/50 text-xs w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
