import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Check, User, MapPin, Scissors } from 'lucide-react'

// 收银端：开钟/派单界面
// 流程：选项目 → 选技师 → 选房间 → 确认开钟
export default function PosNewTicket() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'service' | 'tech' | 'room' | 'confirm'>('service')
  const [serviceId, setServiceId] = useState('')
  const [techId, setTechId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [success, setSuccess] = useState(false)

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => get('/api/services?active=1'),
  })
  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?active=1'),
  })
  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms'],
    queryFn: () => get('/api/rooms?active=1'),
  })
  const { data: shop } = useQuery({
    queryKey: ['shop'],
    queryFn: () => get('/api/shops/current'),
  })

  const createTicket = useMutation({
    mutationFn: () => post('/api/tickets', {
      shop_id: shop?.id,
      service_id: serviceId,
      technician_id: techId || undefined,
      room_id: roomId || undefined,
      auto_start: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setStep('service')
        setServiceId('')
        setTechId('')
        setRoomId('')
      }, 2000)
    },
  })

  const selectedService = services.find((s: any) => s.id === serviceId)
  const selectedTech = technicians.find((t: any) => t.id === techId)
  const selectedRoom = rooms.find((r: any) => r.id === roomId)
  const idleTechs = technicians.filter((t: any) => t.status === 'idle')
  const idleRooms = rooms.filter((r: any) => r.status === 'idle')

  if (success) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-moss/20 flex items-center justify-center">
            <Check size={32} className="text-moss" />
          </div>
          <p className="text-lg text-moss">开钟成功</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* 步骤指示 */}
      <div className="flex items-center gap-2 text-xs text-white/40">
        <StepDot active={step === 'service'} done={!!serviceId} label="选项目" />
        <div className="flex-1 h-px bg-white/10" />
        <StepDot active={step === 'tech'} done={!!techId} label="选技师" />
        <div className="flex-1 h-px bg-white/10" />
        <StepDot active={step === 'room'} done={!!roomId} label="选房间" />
        <div className="flex-1 h-px bg-white/10" />
        <StepDot active={step === 'confirm'} done={false} label="确认" />
      </div>

      {/* 已选摘要 */}
      {(serviceId || techId || roomId) && (
        <div className="glass-card p-3 flex flex-wrap gap-3 text-xs">
          {selectedService && (
            <span className="flex items-center gap-1 text-tan">
              <Scissors size={12} /> {selectedService.name} {formatMoney(selectedService.price_cents)}
            </span>
          )}
          {selectedTech && (
            <span className="flex items-center gap-1 text-moss">
              <User size={12} /> {selectedTech.number}号 {selectedTech.name}
            </span>
          )}
          {selectedRoom && (
            <span className="flex items-center gap-1 text-white/60">
              <MapPin size={12} /> {selectedRoom.number}号{selectedRoom.type}
            </span>
          )}
        </div>
      )}

      {/* Step 1: 选项目 */}
      {step === 'service' && (
        <div className="space-y-2">
          <h2 className="text-sm text-white/60">选择服务项目</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {services.map((s: any) => (
              <button
                key={s.id}
                onClick={() => { setServiceId(s.id); setStep('tech') }}
                className={`glass-card p-4 text-left transition-all active:scale-[0.97] ${
                  serviceId === s.id ? 'border-tan/40 bg-tan/10' : 'hover:border-white/15'
                }`}
              >
                <div className="font-medium text-sm">{s.name}</div>
                <div className="text-[10px] text-white/40 mt-1">{s.duration}分钟 · {s.category}</div>
                <div className="text-tan text-sm mt-2">{formatMoney(s.price_cents)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: 选技师 */}
      {step === 'tech' && (
        <div className="space-y-2">
          <h2 className="text-sm text-white/60">选择技师（可跳过）</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {idleTechs.map((t: any) => (
              <button
                key={t.id}
                onClick={() => { setTechId(t.id); setStep('room') }}
                className={`glass-card p-3 text-center transition-all active:scale-[0.97] ${
                  techId === t.id ? 'border-tan/40 bg-tan/10' : 'hover:border-white/15'
                }`}
              >
                <div className="w-10 h-10 mx-auto rounded-full bg-white/5 flex items-center justify-center text-sm font-bold">
                  {t.number}
                </div>
                <div className="text-xs mt-1.5 truncate">{t.name}</div>
                <div className="text-[10px] text-white/30">{t.level}</div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep('room')}
            className="w-full glass-card p-3 text-center text-xs text-white/40 hover:text-white/60"
          >
            跳过，不指定技师
          </button>
        </div>
      )}

      {/* Step 3: 选房间 */}
      {step === 'room' && (
        <div className="space-y-2">
          <h2 className="text-sm text-white/60">选择房间（可跳过）</h2>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {idleRooms.map((r: any) => (
              <button
                key={r.id}
                onClick={() => { setRoomId(r.id); setStep('confirm') }}
                className={`glass-card p-3 text-center transition-all active:scale-[0.97] ${
                  roomId === r.id ? 'border-tan/40 bg-tan/10' : 'hover:border-white/15'
                }`}
              >
                <div className="text-lg font-bold">{r.number}</div>
                <div className="text-[10px] text-white/30">{r.type}</div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep('confirm')}
            className="w-full glass-card p-3 text-center text-xs text-white/40 hover:text-white/60"
          >
            跳过，不指定房间
          </button>
        </div>
      )}

      {/* Step 4: 确认 */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="text-sm text-white/60">确认开钟</h2>
          <div className="glass-card p-5 space-y-3">
            <div className="flex justify-between">
              <span className="text-white/50">项目</span>
              <span>{selectedService?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">价格</span>
              <span className="text-tan text-lg">{selectedService && formatMoney(selectedService.price_cents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">技师</span>
              <span>{selectedTech ? `${selectedTech.number}号 ${selectedTech.name}` : '未指定'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">房间</span>
              <span>{selectedRoom ? `${selectedRoom.number}号 ${selectedRoom.type}` : '未指定'}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('service')}
              className="flex-1 glass-card py-3 text-center text-sm text-white/50 hover:text-white/80"
            >
              重新选择
            </button>
            <button
              onClick={() => createTicket.mutate()}
              disabled={createTicket.isPending}
              className="flex-1 bg-tan text-white py-3 rounded-xl text-sm font-medium active:scale-[0.97] disabled:opacity-50"
            >
              {createTicket.isPending ? '开钟中...' : '确认开钟'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
        done ? 'bg-tan/20 text-tan' : active ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/20'
      }`}>
        {done ? <Check size={10} /> : ''}
      </div>
      <span className={active ? 'text-white/70' : 'text-white/30'}>{label}</span>
    </div>
  )
}
