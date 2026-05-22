import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney, statusLabel, statusColor } from '@/lib/utils'

export default function AdminTickets() {
  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-all'],
    queryFn: () => get('/api/tickets?limit=200'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg font-medium">钟单记录</h1>
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
