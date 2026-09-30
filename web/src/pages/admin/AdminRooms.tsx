import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/lib/api'
import { Plus, X, Printer, DoorOpen } from 'lucide-react'
import QRCode from 'qrcode'
import { Field } from '@/components/Field'
import { RoomCard } from '@/components/RoomCard'
import { EmptyState } from '@/components/EmptyState'
import { RoomCardSkeleton } from '@/components/LoadingSkeleton'
import { useShopName } from '@/hooks/useShopName'

export default function AdminRooms() {
  const qc = useQueryClient()
  const shopName = useShopName()
  const [showQR, setShowQR] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)

  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms?pageSize=500'),
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
    // 非本机访问：直接用当前 host（含端口）
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return window.location.host
    }
    // 本机开发/管理：用局域网 IP + 实际服务端口，禁止回退到 5173
    const ip = system?.lanIPs?.find((ip: string) => ip.startsWith('192.168') || ip.startsWith('10.'))
      || system?.lanIPs?.[0]
    if (!ip) return window.location.host
    const port = window.location.port || system?.port
    return port ? `${ip}:${port}` : ip
  }

  const getGuestUrl = (roomId: string) => {
    if (!system) return ''
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      // 非本机访问：沿用当前 origin 协议（https 页面不能生成 http 码）
      return `${window.location.origin}/guest/room/${roomId}`
    }
    // 本机开发：局域网 IP 只能 http
    return `http://${getLanHost()}/guest/room/${roomId}`
  }

  // 本地生成二维码（无外网依赖），data URL 可直接打印
  useEffect(() => {
    let cancelled = false
    setQrDataUrl('')
    if (!showQR) return
    const url = getGuestUrl(showQR)
    if (!url) return
    QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#1a1a18', light: '#ffffff' } })
      .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [showQR, system])

  const printLabel = () => {
    const url = getGuestUrl(showQR || '')
    const room = rooms.find((r: any) => r.id === showQR)
    if (!qrDataUrl || !url) return
    const win = window.open('', '_blank', 'width=380,height=520')
    if (!win) return
    win.document.write(`<!doctype html><html><head><title>${room?.number || ''}号房</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff;color:#111}
  .label{border:1px dashed #999;padding:24px 32px;text-align:center;max-width:280px}
  .room{font-size:28px;font-weight:700;margin-bottom:4px}
  .type{font-size:14px;color:#666;margin-bottom:16px}
  img{width:220px;height:220px;display:block;margin:0 auto}
  .hint{font-size:11px;color:#888;margin-top:12px;word-break:break-all}
  .brand{font-size:12px;color:#999;margin-top:6px;letter-spacing:4px}
</style></head><body>
<div class="label">
  <div class="room">${room?.number || ''}号房</div>
  <div class="type">${room?.type || ''} · 顾客扫码自助下单</div>
  <img src="${qrDataUrl}" alt="QR"/>
  <div class="hint">扫码选技师 / 选项目</div>
  <div class="brand">${shopName.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</div>
</div>
<script>window.onload=function(){window.print();window.close()}</script>
</body></html>`)
    win.document.close()
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
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR Code" width={192} height={192} decoding="async" className="w-48 h-48 rounded-lg bg-white p-2" />
              ) : (
                <div className="w-48 h-48 rounded-lg bg-white/5 flex items-center justify-center text-xs text-white/40">
                  正在生成二维码...
                </div>
              )}
            </div>
            <div className="text-center text-[10px] text-white/30 break-all">{getGuestUrl(showQR)}</div>
            <button onClick={printLabel} disabled={!qrDataUrl}
              className="w-full flex items-center justify-center gap-1.5 bg-tan text-white py-2.5 rounded-lg text-sm disabled:opacity-40">
              <Printer size={14} /> 打印二维码标签
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {roomsLoading && !rooms.length
          ? Array.from({ length: 8 }).map((_, i) => <RoomCardSkeleton key={i} />)
          : rooms.map((r: any) => (
              <RoomCard
                key={r.id}
                room={r}
                onEdit={(room) => setEditItem(room)}
                onQR={(id) => setShowQR(id)}
              />
            ))}
        {!roomsLoading && !rooms.length && (
          <div className="col-span-full">
            <EmptyState icon={DoorOpen} title="暂无房间" hint="点右上角「新增房间」创建第一个房间" />
          </div>
        )}
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
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
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
                  className={`flex-1 py-1.5 rounded-lg text-xs border ${f.type === t ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>{t}</button>
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