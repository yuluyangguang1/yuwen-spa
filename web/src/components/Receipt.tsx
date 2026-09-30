// 收据/发票打印（浏览器打印 → 可存 PDF）
// 用法：fetch /api/tickets/:id/receipt 后 openPrintReceipt(data)
//       fetch /api/product-orders/:id/receipt 后 openPrintOrderReceipt(data)

import { formatMoney, paymentMethodLabel, orderStatusLabel } from '@/lib/utils'

export type ReceiptData = {
  shop: { name: string; address?: string | null; phone?: string | null }
  ticket: any
  orders: any[]
  coupon: { code: string; discount_cents: number; list_price_cents?: number } | null
  service_cents: number
  orders_cents: number
  total_cents: number | null
  payment_method: string | null
  paid_at: number | null
  receipt_no: string
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function fmtTime(ts?: number | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function openPrintWindow(title: string, bodyHtml: string) {
  const win = window.open('', '_blank', 'width=420,height=640')
  if (!win) return
  win.document.write(`<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC", "Helvetica Neue", system-ui, sans-serif; background: #f5f5f4; color: #111; padding: 16px; }
  .receipt { background: #fff; max-width: 360px; margin: 0 auto; padding: 24px 20px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .brand { text-align: center; font-size: 18px; font-weight: 700; letter-spacing: 4px; margin-bottom: 4px; }
  .sub { text-align: center; font-size: 12px; color: #666; margin-bottom: 2px; }
  .title { text-align: center; font-size: 14px; font-weight: 600; margin: 12px 0 8px; letter-spacing: 6px; }
  .meta { font-size: 11px; color: #444; line-height: 1.7; border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 8px 0; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px 0; text-align: left; vertical-align: top; }
  th { color: #666; font-weight: 500; border-bottom: 1px solid #eee; }
  td.num, th.num { text-align: right; width: 48px; }
  .totals { margin-top: 8px; font-size: 12px; border-top: 1px dashed #999; padding-top: 8px; }
  .totals div { display: flex; justify-content: space-between; padding: 2px 0; }
  .totals .grand { font-weight: 700; font-size: 14px; margin-top: 4px; }
  .muted { color: #888; font-size: 10px; }
  .foot { text-align: center; font-size: 10px; color: #888; margin-top: 16px; letter-spacing: 1px; }
  .no { font-size: 10px; color: #999; text-align: center; margin-top: 4px; word-break: break-all; }
  .btns { max-width: 360px; margin: 16px auto 0; display: flex; gap: 8px; }
  .btns button { flex: 1; padding: 10px; border: 1px solid #ccc; background: #fff; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .btns .primary { background: #111; color: #fff; border-color: #111; }
  @media print {
    body { background: #fff; padding: 0; }
    .receipt { box-shadow: none; max-width: none; }
    .btns { display: none !important; }
  }
</style></head><body>
${bodyHtml}
<div class="btns">
  <button onclick="window.close()">关闭</button>
  <button class="primary" onclick="window.print()">打印 / 存 PDF</button>
</div>
</body></html>`)
  win.document.close()
}

export function openPrintReceipt(data: ReceiptData) {
  const t = data.ticket
  const orderRows = data.orders.flatMap((o: any) =>
    (o.items || []).map((it: any) => `
      <tr>
        <td>${esc(it.product_name)}${o.room_number ? ` <span class="muted">(${esc(o.room_number)}房)</span>` : ''}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${formatMoney(it.price_cents * it.qty)}</td>
      </tr>`)
  ).join('')

  const couponRow = data.coupon && data.coupon.discount_cents > 0 ? `
    <tr>
      <td>优惠券 ${esc(data.coupon.code)}</td>
      <td class="num"></td>
      <td class="num">-${formatMoney(data.coupon.discount_cents)}</td>
    </tr>` : ''

  openPrintWindow(`收据 ${data.receipt_no}`, `
<div class="receipt">
  <div class="brand">${esc(data.shop.name || '足韵')}</div>
  ${data.shop.address ? `<div class="sub">${esc(data.shop.address)}</div>` : ''}
  ${data.shop.phone ? `<div class="sub">电话 ${esc(data.shop.phone)}</div>` : ''}
  <div class="title">收 据</div>
  <div class="meta">
    单号：${esc(data.receipt_no)}<br/>
    时间：${fmtTime(data.paid_at || t.created_at)}<br/>
    项目：${esc(t.service_name || '—')}${t.technician_name ? `<br/>技师：${esc(t.technician_number || '')} ${esc(t.technician_name)}` : ''}${t.room_number ? ` · ${esc(t.room_number)}号房` : ''}<br/>
    顾客：${esc(t.customer_name || '散客')}${t.customer_phone ? ` (${esc(t.customer_phone)})` : ''}<br/>
    状态：${t.status === 'paid' ? '已结账' : t.status}${data.payment_method ? ` · ${paymentMethodLabel(data.payment_method)}` : ''}
  </div>
  <table>
    <thead><tr><th>项目</th><th class="num">数量</th><th class="num">金额</th></tr></thead>
    <tbody>
      <tr>
        <td>${esc(t.service_name || '服务')}</td>
        <td class="num">1</td>
        <td class="num">${formatMoney(data.coupon?.list_price_cents ?? data.service_cents)}</td>
      </tr>
      ${orderRows}
      ${couponRow}
    </tbody>
  </table>
  <div class="totals">
    <div><span>服务费</span><span>${formatMoney(data.service_cents)}</span></div>
    <div><span>点单</span><span>${formatMoney(data.orders_cents)}</span></div>
    ${data.coupon && data.coupon.discount_cents > 0 ? `<div><span>券抵扣</span><span>-${formatMoney(data.coupon.discount_cents)}</span></div>` : ''}
    <div class="grand"><span>合计</span><span>${data.total_cents != null ? formatMoney(data.total_cents) : '—'}</span></div>
    <div><span>支付方式</span><span>${paymentMethodLabel(data.payment_method)}</span></div>
  </div>
  <div class="foot">谢谢惠顾 · 欢迎再次光临</div>
  <div class="no">${esc(data.receipt_no)}</div>
</div>`)
}

export type OrderReceiptData = {
  shop: { name: string; address?: string | null; phone?: string | null }
  order: any
  total_cents: number
  payment_method: string | null
  paid_at: number | null
  receipt_no: string
}

export function openPrintOrderReceipt(data: OrderReceiptData) {
  const o = data.order
  const rows = (o.items || []).map((it: any) => `
    <tr>
      <td>${esc(it.product_name)}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${formatMoney(it.price_cents * it.qty)}</td>
    </tr>`).join('')

  openPrintWindow(`点单收据 ${data.receipt_no}`, `
<div class="receipt">
  <div class="brand">${esc(data.shop.name || '足韵')}</div>
  ${data.shop.address ? `<div class="sub">${esc(data.shop.address)}</div>` : ''}
  ${data.shop.phone ? `<div class="sub">电话 ${esc(data.shop.phone)}</div>` : ''}
  <div class="title">点单收据</div>
  <div class="meta">
    单号：${esc(data.receipt_no)}<br/>
    时间：${fmtTime(data.paid_at || o.created_at)}<br/>
    房间：${esc(o.room_number || '到店')}${o.room_type || ''}<br/>
    状态：${orderStatusLabel(o.status)}${data.payment_method ? ` · ${paymentMethodLabel(data.payment_method)}` : ''}
    ${o.notes ? `<br/>备注：${esc(o.notes)}` : ''}
  </div>
  <table>
    <thead><tr><th>商品</th><th class="num">数量</th><th class="num">金额</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="grand"><span>合计</span><span>${formatMoney(data.total_cents)}</span></div>
    <div><span>支付方式</span><span>${paymentMethodLabel(data.payment_method)}</span></div>
  </div>
  <div class="foot">谢谢惠顾 · 欢迎再次光临</div>
  <div class="no">${esc(data.receipt_no)}</div>
</div>`)
}
