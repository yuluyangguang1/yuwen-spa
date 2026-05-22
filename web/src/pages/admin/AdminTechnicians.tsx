import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { statusLabel } from '@/lib/utils'

export default function AdminTechnicians() {
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">技师管理</h1>
        <button className="bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          新增技师
        </button>
      </div>
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">工号</th>
              <th className="text-left p-3">姓名</th>
              <th className="text-left p-3">级别</th>
              <th className="text-left p-3">电话</th>
              <th className="text-center p-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((t: any) => (
              <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="p-3 font-bold text-white/60">{t.number}</td>
                <td className="p-3">{t.name}</td>
                <td className="p-3 text-white/50">{t.level || '-'}</td>
                <td className="p-3 text-white/40">{t.phone || '-'}</td>
                <td className="p-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    t.status === 'working' ? 'bg-tan/15 text-tan' :
                    t.status === 'idle' ? 'bg-moss/15 text-moss' :
                    'bg-white/5 text-white/30'
                  }`}>
                    {statusLabel(t.status)}
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
