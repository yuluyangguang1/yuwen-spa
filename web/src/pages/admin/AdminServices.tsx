import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { formatMoney } from '@/lib/utils'

export default function AdminServices() {
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => get('/api/services'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">服务项目管理</h1>
        <button className="bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          新增项目
        </button>
      </div>
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">名称</th>
              <th className="text-left p-3">分类</th>
              <th className="text-right p-3">时长</th>
              <th className="text-right p-3">价格</th>
              <th className="text-right p-3">提成</th>
              <th className="text-center p-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s: any) => (
              <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 text-white/50">{s.category}</td>
                <td className="p-3 text-right">{s.duration}分钟</td>
                <td className="p-3 text-right text-tan">{formatMoney(s.price_cents)}</td>
                <td className="p-3 text-right text-white/50">
                  {s.commission_type === 'percent' ? `${s.commission_value / 100}%` : formatMoney(s.commission_value)}
                </td>
                <td className="p-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.active ? 'bg-moss/15 text-moss' : 'bg-white/5 text-white/30'}`}>
                    {s.active ? '启用' : '停用'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
