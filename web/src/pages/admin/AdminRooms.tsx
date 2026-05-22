import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { statusLabel } from '@/lib/utils'
import { QrCode } from 'lucide-react'
import { useState } from 'react'

export default function AdminRooms() {
  const [showQR, setShowQR] = useState<string | null>(null)

  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms'),
  })

  // 生成二维码 URL：必须用局域网 IP，不能用 localhost
  // 否则手机扫码打不开（localhost 指向手机自己）
  const { data: system } = useQuery({
    queryKey: ['system'],
    queryFn: () => get('/api/system'),
  })

  const getLanHost = () => {
    // 如果用户已经通过 IP 访问后台，直接用当前 host
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return window.location.host
    }
    // 否则从后端获取局域网 IP
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
        <button className="bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          新增房间
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
            <div className="text-center text-[10px] text-white/30 break-all">
              {getGuestUrl(showQR)}
            </div>
            <button
              onClick={() => window.print()}
              className="w-full bg-tan text-white py-2.5 rounded-lg text-sm"
            >
              打印二维码
            </button>
          </div>
        </div>
      )}

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
            <button
              onClick={() => setShowQR(r.id)}
              className="w-full mt-3 flex items-center justify-center gap-1 text-xs text-white/30 hover:text-tan py-1.5 rounded border border-white/5 hover:border-tan/20"
            >
              <QrCode size={12} />
              二维码
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
