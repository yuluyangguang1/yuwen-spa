import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { TableSkeleton } from '@/components/LoadingSkeleton'

export default function TechHistory() {
  const { user } = useAuth()
  const { data: technicians = [], isLoading: techsLoading } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
  })
  // 不做 technicians[0] 回退 —— 否则会看到/算到别人的提成
  const currentTech = user?.technician_id
    ? technicians.find((t: any) => t.id === user.technician_id)
    : undefined

  const { data, isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets-all', 'tech-history', currentTech?.id || ''],
    queryFn: () => get(`/api/tickets?technician_id=${currentTech?.id}&pageSize=50`),
    enabled: !!currentTech,
    placeholderData: (prev: any) => prev,
  })
  const tickets: any[] = Array.isArray(data) ? data : []

  if (techsLoading || (currentTech && ticketsLoading && !tickets.length)) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-14 animate-pulse bg-[#2a2a29] rounded-lg w-48" />
        <TableSkeleton rows={5} />
      </div>
    )
  }

  if (!currentTech) {
    return (
      <div className="p-4">
        <div className="glass-card p-6 text-center space-y-2">
          <p className="text-white/70 text-sm">当前账号未关联技师</p>
          <p className="text-white/40 text-xs">
            {user?.technician_id ? '未找到对应技师资料' : '请使用技师账号登录，或在管理后台关联技师'}
          </p>
        </div>
      </div>
    )
  }

  const paidTickets = tickets.filter((t: any) => t.status === 'paid')
  const totalCommission = paidTickets.reduce((s: number, t: any) => s + (t.commission_cents || 0), 0)
  const truncated = tickets.length >= 50

  return (
    <div className="p-4 space-y-4">
      <div className="glass-card p-4 flex justify-between items-center">
        <span className="text-sm text-white/60">
          近 50 单提成
          {truncated && <span className="text-white/40 text-xs">（更早记录未计入）</span>}
        </span>
        <span className="text-xl text-moss font-medium">{formatMoney(totalCommission)}</span>
      </div>

      <div className="space-y-2">
        {paidTickets.map((t: any) => (
          <div key={t.id} className="glass-card p-3 flex justify-between items-center">
            <div>
              <div className="text-sm">{t.service_name}</div>
              <div className="text-xs text-white/50">
                {new Date(t.paid_at).toLocaleDateString('zh-CN')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-white/60">{formatMoney(t.price_cents)}</div>
              <div className="text-xs text-moss">+{formatMoney(t.commission_cents)}</div>
            </div>
          </div>
        ))}
        {paidTickets.length === 0 && !ticketsLoading && (
          <div className="text-center text-white/50 text-sm py-8">暂无历史记录</div>
        )}
      </div>
    </div>
  )
}
