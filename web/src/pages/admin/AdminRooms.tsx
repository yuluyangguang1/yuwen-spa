import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { statusLabel } from '@/lib/utils'

export default function AdminRooms() {
  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms'),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">房间管理</h1>
        <button className="bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          新增房间
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {rooms.map((r: any) => (
          <div key={r.id} className={`glass-card p-4 ${r.status === 'occupied' ? 'border-tan/20' : ''}`}>
            <div className="text-2xl font-bold text-center">{r.number}</div>
            <div className="text-xs text-white/40 text-center mt-1">{r.type}</div>
            <div className="text-center mt-2">
              <span className={`text-[10px] px-2 py-0.5 rounded ${
                r.status === 'occupied' ? 'bg-tan/15 text-tan' : 'bg-white/5 text-white/30'
              }`}>
                {statusLabel(r.status)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
