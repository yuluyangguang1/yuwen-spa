import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, formatElapsed } from '@/lib/utils'
import { Banknote, CreditCard, Wallet, QrCode, ShoppingBasket, Printer, CheckCircle, Receipt } from 'lucide-react'
import { useState } from 'react'
import { openPrintReceipt } from '@/components/Receipt'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { toast } from '@/lib/toast'

// 收银端：结账界面
// 显示所有"已完成"或"进行中"的钟，点击结账
// include_orders=true 时同房间今日未收款点单一并结清
export default function PosCashier() {
  const queryClient = useQueryClient()
  const [payingId, setPayingId] = useState<string | null>(null)
  const [couponCode, setCouponCode] = useState('')
  const [lastPaidId, setLastPaidId] = useState<string | null>(null)
  const [receiptErr, setReceiptErr] = useState('')
  const [completeId, setCompleteId] = useState<string | null>(null)

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today?pageSize=500'),
    refetchInterval: 10000,
  })

  const { data: productOrders = [] } = useQuery({
    queryKey: ['product-orders', 'unpaid'],
    queryFn: () => get('/api/product-orders?paid=0&pageSize=500'),
    refetchInterval: 10000,
  })

  const unpaid = tickets.filter((t: any) => t.status === 'active' || t.status === 'completed')

  // 每房未收款点单合计
  const unpaidByRoom = new Map<string, number>()
  for (const o of productOrders as any[]) {
    if (!o.room_id || o.paid_at || o.status === 'canceled') continue
    unpaidByRoom.set(o.room_id, (unpaidByRoom.get(o.room_id) || 0) + o.total_cents)
  }

  const payMutation = useMutation({
    mutationFn: ({ id, method, includeOrders, coupon }: {
      id: string; method: string; includeOrders: boolean; coupon?: string
    }) =>
      post(`/api/tickets/${id}/pay`, {
        payment_method: method,
        ...(includeOrders ? { include_orders: true } : {}),
        ...(coupon ? { coupon_code: coupon } : {}),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      queryClient.invalidateQueries({ queryKey: ['product-orders'] })
      queryClient.invalidateQueries({ queryKey: ['reports', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['coupons'] })
      setPayingId(null)
      setCouponCode('')
      if (res?.id) setLastPaidId(res.id)
      else toast.success('收款成功')
    },
    onError: (e: any) => {
      toast.error(e?.message || '支付失败')
    },
  })

  const printPaid = async () => {
    if (!lastPaidId) return
    setReceiptErr('')
    try {
      const data = await get(`/api/tickets/${lastPaidId}/receipt`)
      openPrintReceipt(data)
    } catch (e: any) {
      setReceiptErr(e.message || '获取收据失败')
    }
  }

  const completeMutation = useMutation({
    mutationFn: (id: string) => post(`/api/tickets/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets-today'] })
      queryClient.invalidateQueries({ queryKey: ['ticket-queue'] })
      setCompleteId(null)
    },
    onError: (e: any) => toast.error(e?.message || '标记完成失败'),
  })

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-white/50">待结账 ({unpaid.length})</h2>
        {lastPaidId && (
          <div className="flex items-center gap-3">
            <span key={lastPaidId} className="pay-ok inline-flex items-center gap-1 text-xs text-moss" role="status">
              <CheckCircle size={13} /> 收款成功
            </span>
            <button onClick={printPaid}
              className="flex items-center gap-1 text-xs text-tan hover:underline">
              <Printer size={13} /> 打印最近收据
            </button>
          </div>
        )}
      </div>
      {receiptErr && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {receiptErr}
        </div>
      )}

      {ticketsLoading && !unpaid.length && (
        <div className="glass-card p-4"><TableSkeleton rows={4} /></div>
      )}

      {!ticketsLoading && unpaid.length === 0 && (
        <EmptyState icon={Receipt} title="暂无待结账钟单" hint="服务完成的钟会自动出现在这里" />
      )}

      {unpaid.map((t: any) => {
        const ordersCents = t.room_id ? (unpaidByRoom.get(t.room_id) || 0) : 0
        const totalDue = t.price_cents + ordersCents
        const includeOrders = ordersCents > 0
        return (
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
              {includeOrders && (
                <div className="text-[11px] text-white/40 mt-0.5 flex items-center justify-end gap-1">
                  <ShoppingBasket size={10} className="text-tan" />
                  点单 {formatMoney(ordersCents)}
                </div>
              )}
            </div>
          </div>

          {includeOrders && (
            <div className="flex justify-between text-xs px-2 py-1.5 rounded-lg bg-tan/5 border border-tan/15 text-tan">
              <span>含本房未收款点单</span>
              <span>应收合计 {formatMoney(totalDue)}</span>
            </div>
          )}

          {/* 操作按钮 */}
          {t.status === 'active' && (
            <button
              onClick={() => setCompleteId(t.id)}
              disabled={completeMutation.isPending}
              className="w-full glass-card py-2.5 min-h-[40px] text-center text-xs text-white/60 hover:text-white/90 disabled:opacity-40"
            >
              标记完成（服务结束）
            </button>
          )}

          {payingId === t.id ? (
            <div className="space-y-2">
              <div className="text-xs text-white/50">
                选择支付方式
                {includeOrders && (
                  <span className="text-tan ml-1">（钟单 + 点单共 {formatMoney(totalDue)}）</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="优惠券码（可选）"
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-tan/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PayBtn icon={Banknote} label="现金" disabled={payMutation.isPending} onClick={() => payMutation.mutate({ id: t.id, method: 'cash', includeOrders, coupon: couponCode.trim() || undefined })} />
                <PayBtn icon={QrCode} label="微信" disabled={payMutation.isPending} onClick={() => payMutation.mutate({ id: t.id, method: 'wechat', includeOrders, coupon: couponCode.trim() || undefined })} />
                <PayBtn icon={CreditCard} label="支付宝" disabled={payMutation.isPending} onClick={() => payMutation.mutate({ id: t.id, method: 'alipay', includeOrders, coupon: couponCode.trim() || undefined })} />
                <PayBtn icon={Wallet} label="余额" disabled={payMutation.isPending} onClick={() => payMutation.mutate({ id: t.id, method: 'balance', includeOrders, coupon: couponCode.trim() || undefined })} />
              </div>
              <button onClick={() => { setPayingId(null); setCouponCode('') }} disabled={payMutation.isPending}
                className="w-full text-xs text-white/30 py-1 disabled:opacity-40">取消</button>
              {payMutation.isPending && <div className="text-xs text-tan text-center">支付处理中...</div>}
              {payMutation.isError && <div className="text-xs text-red-400 text-center">{payMutation.error?.message || '支付失败'}</div>}
            </div>
          ) : (
            <button
              onClick={() => setPayingId(t.id)}
              className="w-full bg-tan text-white py-2.5 rounded-lg text-sm font-medium active:scale-[0.97]"
            >
              结账 {formatMoney(totalDue)}
              {includeOrders && <span className="text-[10px] font-normal opacity-80">（含点单）</span>}
            </button>
          )}
        </div>
        )
      })}
      <ConfirmDialog
        open={!!completeId}
        title="标记完成"
        message="确认该服务已结束？完成后可在结账列表收款。"
        variant="warning"
        loading={completeMutation.isPending}
        onConfirm={() => completeId && completeMutation.mutate(completeId)}
        onCancel={() => { if (!completeMutation.isPending) setCompleteId(null) }}
      />
    </div>
  )
}

function PayBtn({ icon: Icon, label, onClick, disabled }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="glass-card py-3 flex flex-col items-center gap-1 text-xs hover:border-tan/30 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
    >
      <Icon size={18} className="text-white/60" />
      {label}
    </button>
  )
}
