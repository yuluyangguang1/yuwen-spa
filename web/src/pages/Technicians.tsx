import { useQuery } from '@tanstack/react-query'

export default function Technicians() {
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => fetch('/api/technicians').then(r => r.json()),
  })

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-medium mb-4">技师管理</h1>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {technicians.map((t: any) => (
          <div key={t.id} className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                t.status === 'working' ? 'bg-tan/20 text-tan' : 'bg-white/5 text-white/50'
              }`}>
                {t.number}
              </div>
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-white/40">{t.level || '未设级别'}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className={`px-2 py-0.5 rounded-full ${
                t.status === 'working' ? 'bg-tan/15 text-tan' :
                t.status === 'break' ? 'bg-gold/15 text-gold' :
                t.status === 'off' ? 'bg-cinnabar/15 text-cinnabar' :
                'bg-white/5 text-white/40'
              }`}>
                {t.status === 'working' ? '服务中' :
                 t.status === 'break' ? '休息中' :
                 t.status === 'off' ? '已下班' : '空闲'}
              </span>
              <span className="text-white/30">{t.phone || ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
