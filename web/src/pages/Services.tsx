import { useQuery } from '@tanstack/react-query'

export default function Services() {
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => fetch('/api/services').then(r => r.json()),
  })

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-medium mb-4">服务项目</h1>
      <div className="grid gap-3">
        {services.map((s: any) => (
          <div key={s.id} className="glass-card p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {s.category} · {s.duration}分钟 · 提成{s.commission_type === 'percent' ? `${s.commission_value / 100}%` : `¥${s.commission_value / 100}`}
              </div>
            </div>
            <div className="text-lg text-tan font-medium">
              ¥{(s.price_cents / 100).toFixed(0)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
