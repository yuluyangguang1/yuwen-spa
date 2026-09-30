// 点单订单队列：收银端台面 / 客服端点单页共用
//
// 拉取今日订单 → 接单/送达/收款/取消 → WebSocket 实时刷新
// 收款与履约解耦：paid_at 非空 = 已收款

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, orderStatusLabel, paymentMethodLabel } from '@/lib/utils'
import { useRealtime } from '@/lib/realtime'
import { openPrintOrderReceipt, type OrderReceiptData } from '@/components/Receipt'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ShoppingBasket, Clock, Banknote, CreditCard, Wallet, QrCode, Printer } from 'lucide-react'
import { toast } from '@/lib/toast'

const STATUS_STYLE: Record<string, string> = {
  pending: 'border-tan/30 bg-tan/5',
  accepted: 'border-blue-400/20 bg-blue-500/5',
  delivered: 'border-white/5 opacity-60',
  canceled: 'border-white/5 opacity-40',
}

const PAY_METHODS = [
  { method: 'cash', label: '现金', icon: Banknote },
  { method: 'wechat', label: '微信', icon: QrCode },
  { method: 'alipay', label: '支付宝', icon: CreditCard },
  { method: 'balance', label: '余额', icon: Wallet },
] as const

export function OrderQueue({ showDone = false, limit = 30 }: { showDone?: boolean; limit?: number }) {
  const qc = useQueryClient()
  const [payingId, setPayingId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

  useRealtime({
    'product_order:created': () => qc.invalidateQueries({ queryKey: ['product-orders'] }),
    'product_order:updated': () => qc.invalidateQueries({ queryKey: ['product-orders'] }),
  })

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['product-orders', { limit }],
    queryFn: () => get(`/api/product-orders?pageSize=${limit}`),
    refetchInterval: 5000,
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      post(`/api/product-orders/${id}/status`, { status }),
    onSuccess: (_: any, vars: any) => {
      qc.invalidateQueries({ queryKey: ['product-orders'] })
      if (vars?.status === 'canceled') setCancelId(null)
    },
    onError: (e: any) => toast.error(e?.message || '操作失败'),
  })

  const payMut = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) =>
      post(`/api/product-orders/${id}/pay`, { payment_method: method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-orders'] })
      qc.invalidateQueries({ queryKey: ['reports', 'summary'] })
      setPayingId(null)
    },
    onError: (e: any) => toast.error(e?.message || '收款失败'),
  })

  const [printErr, setPrintErr] = useState<string | null>(null)
  async function printOrder(id: string) {
    setPrintErr(null)
    try {
      const data = await get<OrderReceiptData>(`/api/product-orders/${id}/receipt`)
      openPrintOrderReceipt(data)
    } catch (e: any) {
      setPrintErr(e?.message || '打印失败')
    }
  }

  // 活跃队列：待履约 或 已送达但未收款（已收款的隐藏到"全部"）
  const visible = showDone
    ? orders
    : orders.filter((o: any) =>
        o.status === 'pending' ||
        o.status === 'accepted' ||
        (o.status === 'delivered' && !o.paid_at)
      )

  if (isLoading && !orders.length) {
    return (
      <div className="glass-card p-4 text-center text-xs text-white/40">
        加载中…
      </div>
    )
  }

  if (!visible.length) {
    return (
      <div className="glass-card p-4 text-center text-xs text-white/50">
        暂无点单
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((o: any) => {
        const canPay = !o.paid_at && o.status !== 'canceled'
        return (
        <div key={o.id} className={`glass-card p-3 border ${STATUS_STYLE[o.status] || ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-white/50">
                <ShoppingBasket size={12} className="text-tan shrink-0" />
                <span className="font-medium text-white/70">
                  {o.room_number ? `${o.room_number}号${o.room_type || ''}` : '到店'}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {new Date(o.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-sm mt-1.5">
                {(o.items || []).map((it: any, i: number) => (
                  <span key={it.id || i} className="mr-2">
                    {it.product_name}<span className="text-tan">×{it.qty}</span>
                  </span>
                ))}
              </div>
              {o.notes && <div className="text-[10px] text-white/30 mt-0.5">备注：{o.notes}</div>}
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className="text-sm text-tan">{formatMoney(o.total_cents)}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                o.status === 'pending' ? 'bg-tan/15 text-tan' :
                o.status === 'accepted' ? 'bg-blue-500/15 text-blue-400' :
                o.status === 'delivered' ? 'bg-moss/15 text-moss' : 'bg-white/5 text-white/30'
              }`}>{orderStatusLabel(o.status)}</span>
              {o.paid_at ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-moss/15 text-moss">
                  已收款 · {paymentMethodLabel(o.payment_method)}
                </span>
              ) : o.status !== 'canceled' ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cinnabar/15 text-cinnabar">待收款</span>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-white/5">
            {(o.status === 'pending' || o.status === 'accepted') && (
              <>
                {o.status === 'pending' && (
                  <button
                    onClick={() => statusMut.mutate({ id: o.id, status: 'accepted' })}
                    disabled={statusMut.isPending}
                    className="flex-1 bg-tan text-white py-1.5 rounded-lg text-xs disabled:opacity-40"
                  >接单</button>
                )}
                {o.status === 'accepted' && (
                  <button
                    onClick={() => statusMut.mutate({ id: o.id, status: 'delivered' })}
                    disabled={statusMut.isPending}
                    className="flex-1 bg-moss/80 text-white py-1.5 rounded-lg text-xs disabled:opacity-40"
                  >送达</button>
                )}
                {!o.paid_at && (
                  <button
                    onClick={() => setPayingId(payingId === o.id ? null : o.id)}
                    className="px-4 bg-blue-500/20 text-blue-300 py-1.5 rounded-lg text-xs"
                  >收款</button>
                )}
                {!o.paid_at && (
                  <button
                    onClick={() => setCancelId(o.id)}
                    disabled={statusMut.isPending}
                    className="px-4 min-h-[32px] bg-white/5 text-white/60 py-1.5 rounded-lg text-xs disabled:opacity-40"
                  >取消</button>
                )}
              </>
            )}
            {o.status === 'delivered' && canPay && payingId !== o.id && (
              <button
                onClick={() => setPayingId(o.id)}
                className="flex-1 bg-tan text-white py-1.5 rounded-lg text-xs"
              >收款 {formatMoney(o.total_cents)}</button>
            )}
            {o.paid_at && (
              <button
                onClick={() => printOrder(o.id)}
                className="flex-1 glass-card py-1.5 text-xs text-white/50 hover:text-tan flex items-center justify-center gap-1 border border-white/10"
              >
                <Printer size={12} /> 收据
              </button>
            )}
          </div>

          {printErr && (
            <div className="mt-2 text-xs text-red-400">{printErr}</div>
          )}

          {payingId === o.id && canPay && (
            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/5">
              {PAY_METHODS.map(({ method, label, icon: Icon }) => (
                <button
                  key={method}
                  onClick={() => payMut.mutate({ id: o.id, method })}
                  disabled={payMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:border-tan/40 hover:text-tan disabled:opacity-40"
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
              <button
                onClick={() => setPayingId(null)}
                disabled={payMut.isPending}
                className="px-3 py-1.5 rounded-lg text-xs text-white/30"
              >取消</button>
              {payMut.isError && (
                <div className="w-full text-xs text-red-400">{payMut.error?.message || '收款失败'}</div>
              )}
            </div>
          )}
        </div>
        )
      })}
      <ConfirmDialog
        open={!!cancelId}
        title="取消点单"
        message="确认取消该点单订单？已收款的订单请走退款流程。"
        variant="danger"
        loading={statusMut.isPending}
        onConfirm={() => cancelId && statusMut.mutate({ id: cancelId, status: 'canceled' })}
        onCancel={() => { if (!statusMut.isPending) setCancelId(null) }}
      />
    </div>
  )
}
