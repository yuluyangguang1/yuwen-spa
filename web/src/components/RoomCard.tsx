import { useMutation, useQueryClient } from '@tanstack/react-query'
import { put } from '@/lib/api'
import { Edit2, QrCode } from 'lucide-react'
import { statusLabel } from '@/lib/utils'
import { memo, useState } from 'react'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'

interface RoomCardProps {
  room: any
  onEdit: (room: any) => void
  onQR: (roomId: string) => void
}

export const RoomCard = memo(function RoomCard({ room, onEdit, onQR }: RoomCardProps) {
  const qc = useQueryClient()
  const [confirmToggle, setConfirmToggle] = useState(false)

  const statusMut = useMutation({
    mutationFn: ({ id, status }: any) => put(`/api/rooms/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rooms'] }); setConfirmToggle(false) },
    onError: (e: any) => toast.error(e?.message || '房间状态更新失败'),
  })

  const nextStatus = room.status === 'occupied' ? 'idle' : 'occupied'

  return (
    <div className={`glass-card p-4 ${room.status === 'occupied' ? 'border-tan/20' : ''}`}>
      <div className="text-2xl font-bold text-center">{room.number}</div>
      <div className="text-xs text-white/50 text-center mt-1">{room.type}</div>
      <div className="text-center mt-2">
        <button
          onClick={() => setConfirmToggle(true)}
          aria-label={`${room.number}号房 ${statusLabel(room.status)}，点击切换状态`}
          className={`text-[10px] px-2 py-1 min-h-[28px] rounded ${room.status === 'occupied' ? 'bg-tan/15 text-tan' : 'bg-white/5 text-white/50'}`}
        >
          {statusLabel(room.status)}
        </button>
      </div>
      <div className="flex gap-1 mt-2">
        <button onClick={() => onEdit(room)} className="flex-1 flex items-center justify-center gap-1 text-xs text-white/50 hover:text-tan py-2 rounded border border-white/5 hover:border-tan/20 min-h-[36px]">
          <Edit2 size={10} /> 编辑
        </button>
        <button onClick={() => onQR(room.id)} className="flex-1 flex items-center justify-center gap-1 text-xs text-white/50 hover:text-tan py-2 rounded border border-white/5 hover:border-tan/20 min-h-[36px]">
          <QrCode size={10} /> 二维码
        </button>
      </div>
      <ConfirmDialog
        open={confirmToggle}
        title="切换房间状态"
        message={`${room.number}号房将从「${statusLabel(room.status)}」变为「${statusLabel(nextStatus)}」？若房间有进行中的钟单，请先在台面处理。`}
        variant={nextStatus === 'idle' ? 'danger' : 'info'}
        loading={statusMut.isPending}
        onConfirm={() => statusMut.mutate({ id: room.id, status: nextStatus })}
        onCancel={() => !statusMut.isPending && setConfirmToggle(false)}
      />
    </div>
  )
})
