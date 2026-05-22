import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, formatElapsed } from '@/lib/utils'
import { Banknote, CreditCard, Wallet, QrCode } from 'lucide-react'
import { useState } from 'react'

// 收银端：结账界面
// 显示所有"已完成"或"进行中"的钟，点击结账
export default function PosCashier() {
  const queryClient = useQueryClient()
  const [payingId, setPayingId] = useState<string | null>(null)

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today'),
    refetchInterval: 5000,
  })

  const unpaid = tickets.filter((t: any) => t.status === 'active' || t.status === 'completed')

  const payMutation = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) =>
      post(`/api/tickets/${id}/pay`, { payment_method: method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      setPayingId(null)
    },
  })

  const completeMutation = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/complete`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tickets-today'] }),
  })

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm text-white/50">待结账 ({unpaid.length})</h2>

      {unpaid.length === 0 && (
        <div className="glass-card p-8 text-center text-white/30 text-sm">
          暂无待结账钟单
        </div>
      )}

      {unpaid.map((t: any) => (
        <div key={t.id} className="glass-card p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium">{t.service_name}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {t.technician_number ? `${t.technician_number}号 ${t.technician_name}` : '未派技师'}
                {t.room_number && ` · ${t.room_number}号房`}
              </div>
              <div className="text-xs text-white/30 mt-0.5">
                {t.status === 'active' ? `进行中 · ${formatElapsed(t.started_at)}` : '已完成'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg text-tan font-medium">{formatMoney(t.price_cents)}</div>
            </div>
          </div>

          {/* 操作按钮 */}
          {t.status === 'active' && (
            <button
              onClick={() => completeMutation.mutate(t.id)}
              className="w-full glass-card py-2 text-center text-xs text-white/50 hover:text-white/80"
            >
              标记完成（服务结束）
            </button>
          )}

          {payingId === t.id ? (
            <div className="space-y-2">
              <div className="text-xs text-white/50">选择支付方式</div>
              <div className="grid grid-cols-2 gap-2">
                <PayBtn icon={Banknote} label="现金" onClick={() => payMutation.mutate({ id: t.id, method: 'cash' })} />
                <PayBtn icon={QrCode} label="微信" onClick={() => payMutation.mutate({ id: t.id, method: 'wechat' })} />
                <PayBtn icon={CreditCard} label="支付宝" onClick={() => payMutation.mutate({ id: t.id, method: 'alipay' })} />
                <PayBtn icon={Wallet} label="余额" onClick={() => payMutation.mutate({ id: t.id, method: 'balance' })} />
              </div>
              <button onClick={() => setPayingId(null)} className="w-full text-xs text-white/30 py-1">取消</button>
            </div>
          ) : (
            <button
              onClick={() => setPayingId(t.id)}
              className="w-full bg-tan text-white py-2.5 rounded-lg text-sm font-medium active:scale-[0.97]"
            >
              结账 {formatMoney(t.price_cents)}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function PayBtn({ icon: Icon, label, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="glass-card py-3 flex flex-col items-center gap-1 text-xs hover:border-tan/30 active:scale-[0.97]"
    >
      <Icon size={18} className="text-white/60" />
      {label}
    </button>
  )
}
