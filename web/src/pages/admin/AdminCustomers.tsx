import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'

export default function AdminCustomers() {
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => get('/api/customers'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">会员管理</h1>
        <button className="bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          新增会员
        </button>
      </div>
      {customers.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/30 text-sm">
          暂无会员，在收银端结账时可快速创建
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="text-left p-3">姓名</th>
                <th className="text-left p-3">手机</th>
                <th className="text-right p-3">余额</th>
                <th className="text-right p-3">累计消费</th>
                <th className="text-right p-3">来访</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: any) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="p-3">{c.name || '未命名'}</td>
                  <td className="p-3 text-white/50">{c.phone || '-'}</td>
                  <td className="p-3 text-right text-tan">{formatMoney(c.balance_cents)}</td>
                  <td className="p-3 text-right text-white/50">{formatMoney(c.total_spent_cents)}</td>
                  <td className="p-3 text-right">{c.visit_count}次</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
