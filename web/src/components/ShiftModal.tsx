// 交接班弹窗：开班 / 实时汇总 / 交班对账
// GET /api/shifts/current · POST open · POST close

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { X, LogIn, LogOut, AlertTriangle } from 'lucide-react'

type Summary = {
  cash_cents?: number
  wechat_cents?: number
  alipay_cents?: number
  balance_cents?: number
  card_cents?: number
  topup_cents?: number
  revenue_cents?: number
  ticket_count?: number
  product_count?: number
  unpaid_orders?: number
}

export function ShiftModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [closing, setClosing] = useState(false)
  const [result, setResult] = useState<{ shift: any; summary: Summary; diff: number } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'current'],
    queryFn: () => get('/api/shifts/current'),
    refetchInterval: 15000,
  })

  const openMut = useMutation({
    mutationFn: () => post('/api/shifts/open', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts', 'current'] }),
  })

  const closeMut = useMutation({
    mutationFn: () =>
      post('/api/shifts/close', {
        actual_cash_cents: Math.round(Number(actualCash || 0) * 100),
        notes: notes.trim() || undefined,
      }),
    onSuccess: (res: any) => {
      setResult(res)
      qc.invalidateQueries({ queryKey: ['shifts', 'current'] })
      qc.invalidateQueries({ queryKey: ['shifts', 'history'] })
    },
  })

  const shift = data?.shift
  const summary: Summary = data?.summary || {}

  const rows: { label: string; value: number }[] = [
    { label: '现金', value: summary.cash_cents || 0 },
    { label: '微信', value: summary.wechat_cents || 0 },
    { label: '支付宝', value: summary.alipay_cents || 0 },
    { label: '余额', value: summary.balance_cents || 0 },
    { label: '银行卡', value: summary.card_cents || 0 },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-md glass-card p-5 space-y-4 rounded-t-2xl sm:rounded-2xl border border-white/10 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="font-medium">交接班</div>
          <button onClick={onClose} aria-label="关闭"
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white/70">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-6 text-center text-sm text-white/40 animate-pulse">加载中...</div>
        ) : result ? (
          /* 交班完成 */
          <div className="space-y-3 text-center py-2">
            <div className="w-14 h-14 mx-auto rounded-full bg-moss/15 flex items-center justify-center">
              <LogOut size={26} className="text-moss" />
            </div>
            <div className="text-moss">交班完成</div>
            <div className="glass-card p-3 space-y-1.5 text-left text-sm">
              <Row label="系统现金" value={formatMoney(result.summary.cash_cents || 0)} />
              <Row label="实际现金" value={formatMoney(result.shift?.actual_cash_cents || 0)} />
              <Row
                label="差额"
                value={formatMoney(result.diff)}
                valueClass={result.diff === 0 ? 'text-moss' : 'text-cinnabar'}
              />
              <Row label="班次营收" value={formatMoney(result.summary.revenue_cents || 0)} valueClass="text-tan" />
            </div>
            <button onClick={onClose}
              className="w-full bg-tan text-white py-2.5 rounded-xl text-sm font-medium">知道了</button>
          </div>
        ) : !shift ? (
          /* 未开班 */
          <div className="space-y-4 py-2 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-tan/15 flex items-center justify-center">
              <LogIn size={26} className="text-tan" />
            </div>
            <div>
              <div className="text-sm text-white/70">当前没有进行中的班次</div>
              <div className="text-xs text-white/35 mt-1">开班后系统开始统计本班收款与对账</div>
            </div>
            <button onClick={() => openMut.mutate()} disabled={openMut.isPending}
              className="w-full bg-tan text-white py-3 rounded-xl text-sm font-medium active:scale-[0.97] disabled:opacity-50">
              {openMut.isPending ? '开班中...' : '开始上班'}
            </button>
            {openMut.isError && (
              <div className="text-xs text-red-400">{openMut.error?.message || '开班失败'}</div>
            )}
          </div>
        ) : (
          /* 进行中班次 */
          <div className="space-y-3">
            <div className="glass-card p-3 text-sm space-y-1">
              <div className="flex justify-between text-white/50 text-xs">
                <span>开班</span>
                <span>{new Date(shift.opened_at).toLocaleString('zh-CN', { hour12: false })}</span>
              </div>
              <div className="flex justify-between text-white/50 text-xs">
                <span>操作人</span>
                <span>{shift.username || shift.user_id}</span>
              </div>
            </div>

            <div className="glass-card p-3 space-y-2">
              <div className="text-xs text-white/40 mb-1">本班实时汇总</div>
              {rows.map(r => (
                <Row key={r.label} label={r.label} value={formatMoney(r.value)} />
              ))}
              <div className="flex justify-between text-sm pt-1.5 border-t border-white/5">
                <span className="text-white/60">营收合计（钟单+点单）</span>
                <span className="text-tan font-medium">{formatMoney(summary.revenue_cents || 0)}</span>
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>钟单 {summary.ticket_count || 0} · 点单 {summary.product_count || 0} 笔</span>
                {summary.unpaid_orders ? (
                  <span className="text-gold">{summary.unpaid_orders} 单待收款</span>
                ) : null}
              </div>
              {summary.topup_cents ? (
                <div className="flex justify-between text-xs text-white/40">
                  <span>本班充值流入</span>
                  <span>{formatMoney(summary.topup_cents)}</span>
                </div>
              ) : null}
            </div>

            {!closing ? (
              <div className="flex gap-2">
                <button onClick={() => onClose()}
                  className="flex-1 glass-card py-2.5 text-sm text-white/50 rounded-xl">继续上班</button>
                <button onClick={() => {
                  setActualCash(String((summary.cash_cents || 0) / 100))
                  setClosing(true)
                }}
                  className="flex-1 bg-tan text-white py-2.5 rounded-xl text-sm font-medium">交班</button>
              </div>
            ) : (
              <div className="space-y-3 pt-1 border-t border-white/5">
                <div className="flex items-center gap-1.5 text-xs text-gold">
                  <AlertTriangle size={12} />
                  请清点钱箱后输入实际现金金额
                </div>
                <label className="block text-xs text-white/40">
                  实际现金（元）
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={actualCash}
                    onChange={e => setActualCash(e.target.value)}
                    className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-tan/40"
                    placeholder="0.00"
                  />
                </label>
                <div className="flex justify-between text-xs text-white/50 px-1">
                  <span>系统现金 {formatMoney(summary.cash_cents || 0)}</span>
                  <span>
                    差额{' '}
                    <span className={
                      Math.round(Number(actualCash || 0) * 100) - (summary.cash_cents || 0) === 0
                        ? 'text-moss' : 'text-cinnabar'
                    }>
                      {formatMoney(Math.round(Number(actualCash || 0) * 100) - (summary.cash_cents || 0))}
                    </span>
                  </span>
                </div>
                <label className="block text-xs text-white/40">
                  备注（选填）
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    maxLength={500}
                    className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-tan/40"
                    placeholder="如：少 20 元待核对"
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setClosing(false)} disabled={closeMut.isPending}
                    className="flex-1 glass-card py-2.5 text-sm text-white/50 rounded-xl disabled:opacity-40">返回</button>
                  <button onClick={() => closeMut.mutate()} disabled={closeMut.isPending}
                    className="flex-1 bg-tan text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
                    {closeMut.isPending ? '交班中...' : '确认交班'}
                  </button>
                </div>
                {closeMut.isError && (
                  <div className="text-xs text-red-400 text-center">{closeMut.error?.message || '交班失败'}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-white/50">{label}</span>
      <span className={valueClass || 'text-white/80'}>{value}</span>
    </div>
  )
}
