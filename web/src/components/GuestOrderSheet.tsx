// 顾客端点单弹层：食物用品菜单 + 购物车 + 本房订单进度
//
// 从 GuestView 任意状态（空闲/服务中）都可打开。
// 下单后订单实时推送收银端/客服端（WebSocket），顾客端 5s 轮询看状态。

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney, orderStatusLabel } from '@/lib/utils'
import { matchItemByName } from '@/lib/voice'
import { X, Minus, Plus, Check, Clock } from 'lucide-react'
import { VoiceInput } from '@/components/VoiceInput'

export function GuestOrderSheet({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [qty, setQty] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [err, setErr] = useState('')

  const { data: products = [] } = useQuery({
    queryKey: ['guest-products'],
    queryFn: () => get('/api/guest/products?active=1&pageSize=500'),
  })

  const { data: orders = [] } = useQuery({
    queryKey: ['guest-product-orders', roomId],
    queryFn: () => get(`/api/guest/product-orders?room_id=${roomId}`),
    refetchInterval: 10000,
    enabled: !!roomId,
  })

  const categories = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const p of products) {
      const c = p.category || '其他'
      if (!map.has(c)) map.set(c, [])
      map.get(c)!.push(p)
    }
    return [...map.entries()]
  }, [products])

  const cartItems = products
    .filter((p: any) => (qty[p.id] || 0) > 0)
    .map((p: any) => ({ product: p, n: qty[p.id] }))
  const totalCents = cartItems.reduce((s: number, x: any) => s + x.product.price_cents * x.n, 0)

  const createOrder = useMutation({
    mutationFn: () => post('/api/guest/product-orders', {
      room_id: roomId,
      items: cartItems.map((x: any) => ({ product_id: x.product.id, qty: x.n })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-product-orders', roomId] })
      setQty({})
      setErr('')
      setSubmitted(true)
    },
    onError: (e: any) => setErr(e?.message || '下单失败'),
  })

  const bump = (id: string, delta: number) => {
    setErr('')
    setQty(q => {
      const next = Math.max(0, Math.min(99, (q[id] || 0) + delta))
      const copy = { ...q }
      if (next === 0) delete copy[id]
      else copy[id] = next
      return copy
    })
  }

  const onVoiceProduct = (text: string) => {
    const available = products.filter((p: any) => !(p.stock != null && p.stock <= 0))
    const hit = matchItemByName(text, available as any[])
    if (hit) {
      bump(hit.id, 1)
      setErr('')
    } else {
      setErr(`未匹配到商品「${text}」`)
    }
  }

  const activeOrders = orders.filter((o: any) => o.status === 'pending' || o.status === 'accepted')
  const doneOrders = orders.filter((o: any) => o.status === 'delivered' || o.status === 'canceled')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-label="食物用品点单">
      <div className="glass-card w-full sm:max-w-md max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h2 className="font-medium">🧺 食物用品</h2>
            <p className="text-[11px] text-white/30 mt-0.5">下单后前台将为您送达</p>
          </div>
          <div className="flex items-center gap-2">
            <VoiceInput onText={onVoiceProduct} onError={setErr} label="语音点单" />
            <button onClick={onClose} aria-label="关闭点单" className="text-white/30 hover:text-white"><X size={20} /></button>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {submitted && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-moss/10 border border-moss/20 text-moss text-xs">
              <Check size={14} /> 下单成功，等待前台接单
              <button onClick={() => setSubmitted(false)} className="ml-auto text-white/40 hover:text-white">继续点</button>
            </div>
          )}

          {/* 本房进行中的订单 */}
          {activeOrders.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs text-white/40">进行中</h3>
              {activeOrders.map((o: any) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </section>
          )}

          {/* 菜单按分类分组 */}
          {categories.length === 0 && (
            <div className="text-center text-sm text-white/30 py-10">暂无商品</div>
          )}
          {categories.map(([cat, list]) => (
            <section key={cat} className="space-y-2">
              <h3 className="text-xs text-white/40">{cat}</h3>
              {(list as any[]).map(p => {
                const n = qty[p.id] || 0
                const soldOut = p.stock != null && p.stock <= 0
                return (
                  <div key={p.id} className={`glass-card p-3 flex items-center justify-between gap-3 ${soldOut ? 'opacity-40' : ''}`}>
                    <div className="min-w-0">
                      <div className="text-sm">{p.name}</div>
                      <div className="text-xs text-tan mt-0.5">{formatMoney(p.price_cents)}</div>
                      {p.stock != null && p.stock > 0 && p.stock <= 10 && (
                        <div className="text-[10px] text-cinnabar/80 mt-0.5">仅剩 {p.stock}</div>
                      )}
                      {soldOut && <div className="text-[10px] text-white/30 mt-0.5">已售罄</div>}
                    </div>
                    {!soldOut && (
                      <div className="flex items-center gap-2 shrink-0">
                        {n > 0 && (
                          <>
                            <button onClick={() => bump(p.id, -1)} aria-label={`减少${p.name}`}
                              className="w-8 h-8 rounded-lg bg-white/5 text-white/60 flex items-center justify-center active:scale-95">
                              <Minus size={14} />
                            </button>
                            <span className="w-5 text-center text-sm font-medium">{n}</span>
                          </>
                        )}
                        <button onClick={() => bump(p.id, 1)} aria-label={`增加${p.name}`}
                          className="w-8 h-8 rounded-lg bg-tan/20 text-tan flex items-center justify-center active:scale-95">
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          ))}

          {/* 历史订单 */}
          {doneOrders.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs text-white/30">今日已完成</h3>
              {doneOrders.map((o: any) => <OrderCard key={o.id} order={o} />)}
            </section>
          )}

          {err && <p className="text-red-400 text-xs text-center">{err}</p>}
        </div>

        {/* 底部结算栏 */}
        <div className="border-t border-white/5 px-5 py-3 flex items-center gap-3 safe-area-pb">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-white/40">合计 {cartItems.length} 种</div>
            <div className="text-lg text-tan font-medium">{formatMoney(totalCents)}</div>
          </div>
          <button
            onClick={() => createOrder.mutate()}
            disabled={!cartItems.length || createOrder.isPending}
            className="bg-tan text-white px-6 py-3 rounded-xl text-sm font-medium active:scale-[0.97] disabled:opacity-30"
          >
            {createOrder.isPending ? '下单中...' : '下单'}
          </button>
        </div>
      </div>
    </div>
  )
}

function OrderCard({ order }: { order: any }) {
  const color =
    order.status === 'pending' ? 'border-tan/20' :
    order.status === 'accepted' ? 'border-blue-400/20' :
    order.status === 'delivered' ? 'border-moss/20' : 'border-white/5'
  return (
    <div className={`glass-card p-3 ${color}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-white/50 flex items-center gap-1">
          <Clock size={11} />
          {orderStatusLabel(order.status)}
        </span>
        <span className="text-sm text-tan">{formatMoney(order.total_cents)}</span>
      </div>
      <div className="text-xs text-white/60 mt-1.5">
        {(order.items || []).map((it: any) => `${it.product_name}×${it.qty}`).join('、')}
      </div>
      {order.notes && <div className="text-[10px] text-white/30 mt-0.5">备注：{order.notes}</div>}
    </div>
  )
}
