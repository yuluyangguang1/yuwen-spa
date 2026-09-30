// 客服端点单页：顾客食物用品订单队列（实时推送）

import { OrderQueue } from '@/components/OrderQueue'
import { ShoppingBasket } from 'lucide-react'

export default function CsOrders() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <ShoppingBasket size={18} className="text-tan" />
          顾客点单
        </h1>
        <span className="text-xs text-white/30">今日订单 · 实时刷新</span>
      </div>
      <OrderQueue showDone limit={100} />
    </div>
  )
}
