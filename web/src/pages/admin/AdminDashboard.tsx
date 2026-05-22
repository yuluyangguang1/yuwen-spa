import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Activity, Users, DollarSign, TrendingUp, Clock, CreditCard } from 'lucide-react'

// 总后台看板：老板一眼看清今天的经营状况
export default function AdminDashboard() {
  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today'),
    refetchInterval: 10000,
  })
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })

  const active = tickets.filter((t: any) => t.status === 'active')
  const paid = tickets.filter((t: any) => t.status === 'paid')
  const revenue = paid.reduce((s: number, t: any) => s + t.price_cents, 0)
  const commission = paid.reduce((s: number, t: any) => s + (t.commission_cents || 0), 0)
  const avgTicket = paid.length > 0 ? Math.round(revenue / paid.length) : 0
  const busyTechs = technicians.filter((t: any) => t.status === 'working')

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-lg font-medium">今日经营</h1>

      {/* Bento Grid 统计 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat icon={DollarSign} label="营收" value={formatMoney(revenue)} color="text-tan" />
        <Stat icon={TrendingUp} label="净利润" value={formatMoney(revenue - commission)} sub="扣除提成" color="text-moss" />
        <Stat icon={CreditCard} label="客单价" value={formatMoney(avgTicket)} color="text-tan-light" />
        <Stat icon={Activity} label="进行中" value={`${active.length}`} sub="钟" color="text-tan" />
        <Stat icon={Clock} label="已完成" value={`${paid.length}`} sub="单" color="text-white/60" />
        <Stat icon={Users} label="在岗" value={`${busyTechs.length}/${technicians.length}`} color="text-moss" />
      </div>

      {/* 技师业绩排行 */}
      <section>
        <h2 className="text-sm text-white/50 mb-3">技师业绩排行</h2>
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="text-left p-3">技师</th>
                <th className="text-right p-3">钟数</th>
                <th className="text-right p-3">营收</th>
                <th className="text-right p-3">提成</th>
              </tr>
            </thead>
            <tbody>
              {technicians.map((tech: any) => {
                const techTickets = paid.filter((t: any) => t.technician_id === tech.id)
                const techRevenue = techTickets.reduce((s: number, t: any) => s + t.price_cents, 0)
                const techComm = techTickets.reduce((s: number, t: any) => s + (t.commission_cents || 0), 0)
                return (
                  <tr key={tech.id} className="border-b border-white/5 last:border-0">
                    <td className="p-3">
                      <span className="text-white/40 mr-2">{tech.number}</span>
                      {tech.name}
                    </td>
                    <td className="p-3 text-right">{techTickets.length}</td>
                    <td className="p-3 text-right text-tan">{formatMoney(techRevenue)}</td>
                    <td className="p-3 text-right text-moss">{formatMoney(techComm)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 最近钟单 */}
      <section>
        <h2 className="text-sm text-white/50 mb-3">最近钟单</h2>
        <div className="space-y-2">
          {tickets.slice(0, 10).map((t: any) => (
            <div key={t.id} className="glass-card p-3 flex items-center justify-between">
              <div>
                <div className="text-sm">{t.service_name}</div>
                <div className="text-[10px] text-white/30">
                  {t.technician_name && `${t.technician_number}号${t.technician_name}`}
                  {t.room_number && ` · ${t.room_number}号房`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-tan">{formatMoney(t.price_cents)}</div>
                <div className={`text-[10px] ${
                  t.status === 'active' ? 'text-tan' : t.status === 'paid' ? 'text-moss' : 'text-white/30'
                }`}>
                  {t.status === 'active' ? '进行中' : t.status === 'paid' ? '已结' : t.status === 'completed' ? '待结' : t.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub, color }: any) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={14} className={color} />
        <span className="text-[10px] text-white/40">{label}</span>
      </div>
      <div className={`text-lg font-medium ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-white/20">{sub}</div>}
    </div>
  )
}
