import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'

export default function TechHistory() {
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })
  const currentTech = technicians[0]

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-all'],
    queryFn: () => get(`/api/tickets?technician_id=${currentTech?.id}&limit=50`),
    enabled: !!currentTech,
  })

  const paidTickets = tickets.filter((t: any) => t.status === 'paid')
  const totalCommission = paidTickets.reduce((s: number, t: any) => s + (t.commission_cents || 0), 0)

  return (
    <div className="p-4 space-y-4">
      <div className="glass-card p-4 flex justify-between items-center">
        <span className="text-sm text-white/50">累计提成</span>
        <span className="text-xl text-moss font-medium">{formatMoney(totalCommission)}</span>
      </div>

      <div className="space-y-2">
        {paidTickets.map((t: any) => (
          <div key={t.id} className="glass-card p-3 flex justify-between items-center">
            <div>
              <div className="text-sm">{t.service_name}</div>
              <div className="text-[10px] text-white/30">
                {new Date(t.paid_at).toLocaleDateString('zh-CN')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-white/50">{formatMoney(t.price_cents)}</div>
              <div className="text-xs text-moss">+{formatMoney(t.commission_cents)}</div>
            </div>
          </div>
        ))}
        {paidTickets.length === 0 && (
          <div className="text-center text-white/30 text-sm py-8">暂无历史记录</div>
        )}
      </div>
    </div>
  )
}
