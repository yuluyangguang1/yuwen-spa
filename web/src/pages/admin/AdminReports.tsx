// 经营报表：日营收 / 技师绩效 / 项目维度 / 支付方式 / 营收预测
// 后端 /api/reports/* 此前无前端消费方，本页为唯一入口。

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { Download, BarChart3, TrendingUp } from 'lucide-react'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { TrendChart, BarList, DonutChart } from '@/components/MiniCharts'

type Tab = 'daily' | 'tech' | 'service' | 'payment' | 'forecast' | 'topup'

const TABS: { key: Tab; label: string }[] = [
  { key: 'daily', label: '日营收' },
  { key: 'tech', label: '技师绩效' },
  { key: 'service', label: '项目维度' },
  { key: 'payment', label: '支付方式' },
  { key: 'topup', label: '充值提成' },
  { key: 'forecast', label: '营收预测' },
]

// 本地时区日期工具（toISOString 会漂到 UTC 日界，凌晨打开「今天」会变成昨天）
function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
function parseYmd(s: string) {
  const [y, m, dd] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, dd || 1)
}
function toDateStart(s: string) { return parseYmd(s).setHours(0, 0, 0, 0) }
function toDateEnd(s: string) { return parseYmd(s).setHours(23, 59, 59, 999) }

const PAYMENT_LABEL: Record<string, string> = {
  cash: '现金', wechat: '微信', alipay: '支付宝', balance: '余额', card: '银行卡', unknown: '未知',
}

export default function AdminReports() {
  const [tab, setTab] = useState<Tab>('daily')
  const [dateFrom, setDateFrom] = useState(daysAgo(29))
  const [dateTo, setDateTo] = useState(ymd(new Date()))

  const range = `date_from=${toDateStart(dateFrom)}&date_to=${toDateEnd(dateTo)}`

  const dailyQ = useQuery({
    queryKey: ['reports', 'daily', dateFrom, dateTo],
    queryFn: () => get(`/api/reports/daily?pageSize=500&${range}`),
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
  const topupQ = useQuery({
    queryKey: ['reports', 'topup-commission', dateFrom, dateTo],
    queryFn: () => get(`/api/reports/topup-commission?${range}`),
    enabled: tab === 'topup',
  })
  const forecastQ = useQuery({
    queryKey: ['ai-forecast'],
    queryFn: () => get('/api/ai/forecast?days=30&horizon=7'),
    enabled: tab === 'forecast',
  })
  const summaryQ = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: () => get('/api/reports/summary'),
  })

  const active = tab === 'daily' ? dailyQ
    : tab === 'tech' ? techQ
    : tab === 'service' ? serviceQ
    : tab === 'payment' ? paymentQ
    : tab === 'topup' ? topupQ
    : forecastQ
  const rows: any[] = Array.isArray(active.data) ? active.data : (active.data as any)?.data || []
  const summary = summaryQ.data
  const fc = (forecastQ.data as any)?.forecast
  const fcCommentary = (forecastQ.data as any)?.commentary

  const exportUrl = () =>
    `/api/reports/export?type=${tab === 'forecast' ? 'daily' : tab}&format=csv&date_from=${toDateStart(dateFrom)}&date_to=${toDateEnd(dateTo)}`

  const download = async () => {
    try {
      const token = localStorage.getItem('yuwen_token')
      const res = await fetch(exportUrl(), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `报表_${tab}_${dateFrom}_${dateTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(`导出失败：${e?.message || '未知错误'}`)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <BarChart3 size={18} className="text-tan" /> 经营报表
        </h1>
        {tab !== 'topup' && (
          <button onClick={download}
            className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/60 hover:text-tan px-3 py-1.5 rounded-lg text-xs">
            <Download size={14} /> 导出 CSV
          </button>
        )}
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
            {summary.today?.product_revenue > 0 && (
              <div className="text-[10px] text-white/40 mt-0.5">
                含点单 {formatMoney(summary.today.product_revenue)} · 合计 {formatMoney(summary.today.total_revenue || 0)}
              </div>
            )}
          </div>
          <div className="glass-card p-3 text-center">
            <div className="text-xs text-white/40">本月营收</div>
            <div className="text-xl font-medium text-moss mt-1">{formatMoney(summary.month?.revenue || 0)}</div>
            {summary.month?.product_revenue > 0 && (
              <div className="text-[10px] text-white/40 mt-0.5">
                含点单 {formatMoney(summary.month.product_revenue)}
              </div>
            )}
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
        <div className="flex gap-1 ml-auto flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                tab === t.key ? 'bg-tan/15 text-tan border border-tan/30' : 'text-white/50 border border-transparent hover:text-white/80'
              }`}>{t.label}</button>
          ))}
        </div>
      </div>

      {active.isLoading ? (
        <TableSkeleton rows={6} />
      ) : tab === 'forecast' ? (
        <div className="glass-card p-4 space-y-4">
          {!fc ? (
            <div className="text-sm text-white/30 text-center py-6">暂无预测数据</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/40">日均营收</div>
                  <div className="text-lg text-tan mt-0.5">{formatMoney(fc.avgDaily)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/40">未来 7 日合计</div>
                  <div className="text-lg text-moss mt-0.5">{formatMoney(fc.next7Total)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/40">趋势 · {fc.method}</div>
                  <div className="text-lg mt-0.5">{fc.trend}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-white/40 mb-2 flex items-center gap-1">
                  <TrendingUp size={12} className="text-tan" /> 未来 {fc.horizon} 日预测
                </div>
                <div className="flex items-end gap-1.5 h-28" aria-label="营收预测柱状图">
                  {fc.daily?.map((d: any) => {
                    const max = Math.max(...fc.daily.map((x: any) => x.predicted), 1)
                    const h = Math.max(6, Math.round((d.predicted / max) * 100))
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date} ${formatMoney(d.predicted)}`}>
                        <div className="text-[9px] text-tan/80">{Math.round(d.predicted / 100)}</div>
                        <div className="w-full bg-gradient-to-t from-tan/20 to-tan/60 rounded-t" style={{ height: `${h}%` }} />
                        <div className="text-[9px] text-white/30">{d.date.slice(5)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
              {fcCommentary && (
                <div className="text-xs text-white/55 border-t border-white/5 pt-3 whitespace-pre-wrap">{fcCommentary}</div>
              )}
            </>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/30 text-sm">该时间段暂无数据</div>
      ) : (
        <>
          {tab === 'daily' && (
            <div className="glass-card p-4 space-y-2">
              <div className="text-xs text-white/40">营收趋势 · 合计/日</div>
              <TrendChart
                ariaLabel="日营收趋势"
                points={[...rows]
                  .sort((a: any, b: any) => String(a.report_date).localeCompare(String(b.report_date)))
                  .map((r: any) => ({ label: r.report_date, value: r.total_revenue ?? r.revenue }))}
              />
            </div>
          )}
          {tab === 'tech' && (
            <div className="glass-card p-4 space-y-3">
              <div className="text-xs text-white/40">营收 Top 8</div>
              <BarList
                ariaLabel="技师营收排行"
                items={[...rows]
                  .sort((a: any, b: any) => (b.total_revenue || 0) - (a.total_revenue || 0))
                  .slice(0, 8)
                  .map((r: any) => ({
                    label: `${r.number}号 ${r.name}`,
                    value: r.total_revenue || 0,
                    display: formatMoney(r.total_revenue || 0),
                  }))}
              />
            </div>
          )}
          {tab === 'service' && (
            <div className="glass-card p-4 space-y-3">
              <div className="text-xs text-white/40">营收 Top 8</div>
              <BarList
                ariaLabel="项目营收排行"
                items={[...rows]
                  .sort((a: any, b: any) => (b.total_revenue || 0) - (a.total_revenue || 0))
                  .slice(0, 8)
                  .map((r: any) => ({
                    label: r.name,
                    value: r.total_revenue || 0,
                    display: formatMoney(r.total_revenue || 0),
                  }))}
              />
            </div>
          )}
          {tab === 'payment' && (
            <div className="glass-card p-4 space-y-3">
              <div className="text-xs text-white/40">营收占比</div>
              <DonutChart
                ariaLabel="支付方式营收占比"
                items={rows
                  .filter((r: any) => (r.total_revenue || 0) > 0)
                  .map((r: any) => ({
                    label: PAYMENT_LABEL[r.payment_method] || r.payment_method,
                    value: r.total_revenue,
                    display: formatMoney(r.total_revenue),
                  }))}
              />
            </div>
          )}
          <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                {tab === 'daily' && (
                  <>
                    <th className="text-left p-3">日期</th>
                    <th className="text-right p-3">总单</th>
                    <th className="text-right p-3">已结</th>
                    <th className="text-right p-3">钟单营收</th>
                    <th className="text-right p-3">点单营收</th>
                    <th className="text-right p-3">合计</th>
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
                {tab === 'topup' && (
                  <>
                    <th className="text-left p-3">员工</th>
                    <th className="text-right p-3">充值笔数</th>
                    <th className="text-right p-3">充值额</th>
                    <th className="text-right p-3">提成</th>
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
                  <td className="p-3 text-right text-white/60">{formatMoney(r.product_revenue || 0)}</td>
                  <td className="p-3 text-right text-tan font-medium">{formatMoney(r.total_revenue ?? r.revenue)}</td>
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
              {tab === 'payment' && (() => {
                // 最大余数法：占比合计恰好 100%，避免 33/33/33→99
                const totalRev = rows.reduce((s: number, x: any) => s + (x.total_revenue || 0), 0) || 1
                const raw = rows.map((r: any) => ({
                  r,
                  exact: ((r.total_revenue || 0) / totalRev) * 100,
                }))
                const floors = raw.map(x => Math.floor(x.exact))
                const remain = 100 - floors.reduce((s, n) => s + n, 0)
                const order = raw
                  .map((x, i) => ({ i, frac: x.exact - floors[i] }))
                  .sort((a, b) => b.frac - a.frac)
                const pctArr = [...floors]
                for (let k = 0; k < remain && k < order.length; k++) pctArr[order[k].i] += 1
                return rows.map((r: any, i: number) => {
                  const pct = pctArr[i]
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
                          <span className="text-white/60 text-xs w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              })()}
              {tab === 'topup' && rows.map((r: any) => (
                <tr key={r.user_id || 'none'} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3">{r.user_id ? (r.display_name || r.username || r.user_id) : <span className="text-white/30">未记录</span>}</td>
                  <td className="p-3 text-right">{r.topup_count}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(r.topup_amount_cents)}</td>
                  <td className="p-3 text-right text-moss">{formatMoney(r.commission_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  )
}
