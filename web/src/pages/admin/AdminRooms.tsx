import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/lib/api'
import { statusLabel } from '@/lib/utils'
import { QrCode, Plus, Edit2, X } from 'lucide-react'

export default function AdminRooms() {
  const qc = useQueryClient()
  const [showQR, setShowQR] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)

  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms'),
  })
  const shop_id = rooms[0]?.shop_id

  const { data: system } = useQuery({
    queryKey: ['system'],
    queryFn: () => get('/api/system'),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['rooms'] })

  const createMut = useMutation({
    mutationFn: (data: any) => post('/api/rooms', data),
    onSuccess: () => { invalidate(); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/rooms/${id}`, data),
    onSuccess: () => { invalidate(); setEditItem(null) },
  })

  const getLanHost = () => {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return window.location.host
    }
    const ip = system?.lanIPs?.find((ip: string) => ip.startsWith('192.168') || ip.startsWith('10.'))
      || system?.lanIPs?.[0]
    if (ip) return `${ip}:${window.location.port || system?.port || 5173}`
    return window.location.host
  }

  const getGuestUrl = (roomId: string) => `http://${getLanHost()}/guest/room/${roomId}`
  const getQRUrl = (roomId: string) => {
    const url = getGuestUrl(roomId)
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">房间管理</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          <Plus size={14} /> 新增房间
        </button>
      </div>

      {/* 二维码弹窗 */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowQR(null)}>
          <div className="bg-[#1a1a18] rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <h3 className="font-medium text-lg">房间二维码</h3>
              <p className="text-xs text-white/40 mt-1">
                {rooms.find((r: any) => r.id === showQR)?.number}号房 · 顾客扫码选技师
              </p>
            </div>
            <div className="flex justify-center">
              <img src={getQRUrl(showQR)} alt="QR Code" className="w-48 h-48 rounded-lg bg-white p-2" />
            </div>
            <div className="text-center text-[10px] text-white/30 break-all">{getGuestUrl(showQR)}</div>
            <button onClick={() => window.print()} className="w-full bg-tan text-white py-2.5 rounded-lg text-sm">打印二维码</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {rooms.map((r: any) => (
          <div key={r.id} className={`glass-card p-4 ${r.status === 'occupied' ? 'border-tan/20' : ''}`}>
            <div className="text-2xl font-bold text-center">{r.number}</div>
            <div className="text-xs text-white/40 text-center mt-1">{r.type}</div>
            <div className="text-center mt-2">
              <button onClick={() => updateMut.mutate({ id: r.id, status: r.status === 'occupied' ? 'idle' : 'occupied' })}
                className={`text-[10px] px-2 py-0.5 rounded ${r.status === 'occupied' ? 'bg-tan/15 text-tan' : 'bg-white/5 text-white/30'}`}>
                {statusLabel(r.status)}
              </button>
            </div>
            <div className="flex gap-1 mt-2">
              <button onClick={() => setEditItem(r)}
                className="flex-1 flex items-center justify-center gap-1 text-xs text-white/30 hover:text-tan py-1.5 rounded border border-white/5 hover:border-tan/20">
                <Edit2 size={10} /> 编辑
              </button>
              <button onClick={() => setShowQR(r.id)}
                className="flex-1 flex items-center justify-center gap-1 text-xs text-white/30 hover:text-tan py-1.5 rounded border border-white/5 hover:border-tan/20">
                <QrCode size={10} /> 二维码
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <RoomForm title="新增房间" shop_id={shop_id}
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editItem && <RoomForm title="编辑房间" initial={editItem}
        onSubmit={(d) => updateMut.mutate({ id: editItem.id, ...d })} onClose={() => setEditItem(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}
    </div>
  )
}

function RoomForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    number: initial?.number || '',
    type: initial?.type || '大厅',
    capacity: initial?.capacity?.toString() || '1',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      shop_id: shop_id || initial?.shop_id,
      number: f.number,
      type: f.type,
      capacity: Number(f.capacity),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="房号" value={f.number} onChange={v => setF({ ...f, number: v })} required />
          <div>
            <label className="block text-xs text-white/40 mb-1">类型</label>
            <div className="flex gap-1.5">
              {['大厅', '包间', 'VIP'].map(t => (
                <button key={t} type="button" onClick={() => setF({ ...f, type: t })}
                  className={`flex-1 py-1.5 rounded-lg text-xs border ${f.type === t ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <Field label="容量(床位数)" type="number" value={f.capacity} onChange={v => setF({ ...f, capacity: v })} />
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
            {loading ? '保存中...' : '保存'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-white/40 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50" />
    </div>
  )
}
