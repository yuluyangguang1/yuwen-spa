import { useMutation, useQueryClient } from '@tanstack/react-query'
import { put } from '@/lib/api'
import { Edit2, QrCode } from 'lucide-react'
import { statusLabel } from '@/lib/utils'
import { memo } from 'react'

interface RoomCardProps {
  room: any
  onEdit: (room: any) => void
  onQR: (roomId: string) => void
}

export const RoomCard = memo(function RoomCard({ room, onEdit, onQR }: RoomCardProps) {
  const qc = useQueryClient()

  const statusMut = useMutation({
    mutationFn: ({ id, status }: any) => put(`/api/rooms/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  })

  return (
    <div className={`glass-card p-4 ${room.status === 'occupied' ? 'border-tan/20' : ''}`}>
      <div className="text-2xl font-bold text-center">{room.number}</div>
      <div className="text-xs text-white/40 text-center mt-1">{room.type}</div>
      <div className="text-center mt-2">
        <button
          onClick={() => statusMut.mutate({ id: room.id, status: room.status === 'occupied' ? 'idle' : 'occupied' })}
          className={`text-[10px] px-2 py-0.5 rounded ${room.status === 'occupied' ? 'bg-tan/15 text-tan' : 'bg-white/5 text-white/30'}`}
        >
          {statusLabel(room.status)}
        </button>
      </div>
      <div className="flex gap-1 mt-2">
        <button onClick={() => onEdit(room)} className="flex-1 flex items-center justify-center gap-1 text-xs text-white/30 hover:text-tan py-1.5 rounded border border-white/5 hover:border-tan/20">
          <Edit2 size={10} /> 编辑
        </button>
        <button onClick={() => onQR(room.id)} className="flex-1 flex items-center justify-center gap-1 text-xs text-white/30 hover:text-tan py-1.5 rounded border border-white/5 hover:border-tan/20">
          <QrCode size={10} /> 二维码
        </button>
      </div>
    </div>
  )
})
