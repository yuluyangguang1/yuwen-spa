// 大堂码入口：顾客进店扫码（不绑房间）
//
// URL: /guest
//
// 与房间码的区别：
//   房间码 /guest/room/:roomId  → 已入座，看进度/点单/加钟/评价
//   大堂码 /guest               → 进店等位，选项目/选技师/下单
//
// 三种状态：
//   1. 无会话        → 显示选技师 + 选项目（GuestSelectView，无 room）
//   2. 有会话+未分配  → 显示「等待客服安排房间」+ 排队信息
//   3. 有会话+已分配  → 显示服务进度（复用房间码的服务中视图）
//
// 会话来源（按优先级）：
//   a. URL 参数 ?tid=&t=（客服转发的链接）
//   b. localStorage（顾客自己下过单）

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { GuestSelectView } from './GuestView'
import { BrandTitle } from '@/components/BrandTitle'
import { ReviewSheet } from '@/components/ReviewSheet'
import { Clock, MapPin, Moon, Star } from 'lucide-react'
import {
  loadGuestSession, saveGuestSession, sessionFromUrl, clearGuestSession,
  type GuestSession,
} from '@/lib/guest-session'

export default function GuestLobby() {
  const [params] = useSearchParams()
  const [session, setSession] = useState<GuestSession | null>(null)
  const [ready, setReady] = useState(false)

  // 初始化会话：URL 优先，其次 localStorage
  useEffect(() => {
    const fromUrl = sessionFromUrl()
    setSession(fromUrl || loadGuestSession())
    setReady(true)
  }, [params])

  // 轮询自己的单（15 秒；客服派单后靠这里感知，无需重扫）
  const { data: ticket, error } = useQuery({
    queryKey: ['guest-my-ticket', session?.ticketId],
    queryFn: () => get(`/api/guest/tickets/${session!.ticketId}?t=${encodeURIComponent(session!.token)}`),
    enabled: !!session,
    refetchInterval: 15000,
    retry: false,
  })

  // 凭证失效（过期/订单已清理）→ 清掉本地会话，回到下单页。
  // 403 = token 无效/过期；404 = 订单不存在（服务端数据被清理）。
  const errStatus = (error as any)?.status
  const deadSession = errStatus === 403 || errStatus === 404

  useEffect(() => {
    if (deadSession) {
      clearGuestSession()
      setSession(null)
    }
  }, [deadSession])

  if (!ready) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="text-center text-white/40 animate-pulse text-sm">加载中...</div>
      </div>
    )
  }

  // ── 状态 1：无会话 → 选技师 + 选项目 ──────────────
  if (!session) {
    return <GuestSelectView onCreated={(t) => {
      if (t?.id && t?.guest_token) setSession(saveGuestSession(t.id, t.guest_token))
    }} />
  }

  // ── 会话已失效：直接渲染下单页（不依赖 effect 时序，避免卡在加载态）──
  if (deadSession) {
    return <GuestSelectView onCreated={(t) => {
      if (t?.id && t?.guest_token) setSession(saveGuestSession(t.id, t.guest_token))
    }} />
  }

  // ── 查询失败（非凭证问题）：给出可操作提示，不无限转圈 ──
  if (error && !ticket) {
    return (
      <div className="min-h-[100dvh] max-w-md mx-auto p-4 space-y-4 safe-area-all">
        <Header />
        <div className="glass-card p-6 text-center space-y-3">
          <div className="text-sm text-white/60">订单查询失败</div>
          <div className="text-xs text-white/35">
            {(error as any)?.message || '网络异常，请检查是否连着店内 WiFi'}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 bg-tan text-white rounded-lg text-sm min-h-[44px]"
            >重试</button>
            <button
              onClick={() => { clearGuestSession(); setSession(null) }}
              className="flex-1 glass-card text-sm min-h-[44px] text-white/60"
            >重新下单</button>
          </div>
        </div>
      </div>
    )
  }

  // ── 加载中 ────────────────────────────────────────
  if (!ticket) {
    return (
      <div className="min-h-[100dvh] max-w-md mx-auto p-4 space-y-4 safe-area-all">
        <Header />
        <div className="glass-card p-6 text-center text-white/40 text-sm animate-pulse">
          正在查询订单…
        </div>
      </div>
    )
  }

  // ── 状态 3：已分配房间 → 已安排/服务中视图 ──────────
  // 注意：派单后状态仍是 pending（已分配、未开钟），
  // 只有开钟后才变 active。两种都算「已安排」，都要离开等待页。
  if (ticket.room_id) {
    return <AssignedView ticket={ticket} />
  }

  // ── 状态 2：等待客服安排 ──────────────────────────
  return <WaitingView ticket={ticket} />
}

// ─── 品牌头 ────────────────────────────────────────
function Header() {
  return (
    <div className="text-center py-3">
      <BrandTitle size="xl" shimmer publicPage stack />
    </div>
  )
}

// ─── 等待客服安排房间 ──────────────────────────────
function WaitingView({ ticket }: { ticket: any }) {
  const overnight = !!ticket.overnight
  return (
    <div className="min-h-[100dvh] max-w-md mx-auto p-4 space-y-4 safe-area-all">
      <Header />

      {/* 状态卡 */}
      <div className="glass-card p-6 text-center space-y-3 border-tan/25 bg-tan/5">
        <div className="w-14 h-14 mx-auto rounded-full bg-tan/20 flex items-center justify-center">
          <Clock size={26} className="text-tan animate-pulse" />
        </div>
        <div className="text-lg text-tan">等待为您安排房间</div>
        <div className="text-xs text-white/40">客服正在处理，请稍候片刻</div>
      </div>

      {/* 订单详情 */}
      <div className="glass-card p-5 space-y-3">
        <Row label="服务项目" value={ticket.service_name || '—'} />
        {ticket.service_duration ? (
          <Row label="时长" value={`${ticket.service_duration} 分钟`} />
        ) : null}
        <Row
          label="技师"
          value={ticket.technician_name
            ? `${ticket.technician_number ? `${ticket.technician_number}号 ` : ''}${ticket.technician_name}`
            : '由客服安排'}
        />
        <Row label="房间" value={ticket.room_number ? `${ticket.room_number}号` : '待分配'} />
        {overnight && (
          <div className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-tan/10 text-tan border border-tan/20">
            <Moon size={11} /> 已勾选过夜睡眠服务
          </div>
        )}
        <div className="flex justify-between items-center pt-3 border-t border-white/5">
          <span className="text-white/50 text-sm">费用</span>
          <span className="text-tan text-xl font-medium">
            {fmt(ticket.total_cents ?? ticket.price_cents)}
          </span>
        </div>
        {ticket.orders_cents > 0 && (
          <div className="text-[10px] text-white/30 text-right">
            含点单 {fmt(ticket.orders_cents)}
          </div>
        )}
      </div>

      <div className="text-center text-[10px] text-white/20">
        本页面会自动刷新，安排好后无需重新扫码
      </div>
    </div>
  )
}

// ─── 已分配房间：待开钟 / 服务中 / 可评价 ────────────
function AssignedView({ ticket }: { ticket: any }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const started = !!ticket.started_at
  const progress = started && ticket.service_duration
    ? Math.min(100, ((Date.now() - ticket.started_at) / (ticket.service_duration * 60000)) * 100)
    : 0
  const remainMin = started && ticket.service_duration
    ? Math.max(0, Math.round(ticket.service_duration - (Date.now() - ticket.started_at) / 60000))
    : null

  // 可评价：服务完成/已结账 + 有技师 + 未评价
  const reviewable = ['completed', 'paid'].includes(ticket.status)
    && !!ticket.technician_id
    && !ticket.reviewed

  return (
    <div className="min-h-[100dvh] max-w-md mx-auto p-4 space-y-4 safe-area-all">
      <Header />

      {/* 房间已分配提示 + 扫房间码引导 */}
      <div className="glass-card p-4 space-y-3 border-moss/25 bg-moss/5">
        <div className="flex items-center gap-3">
          <MapPin size={18} className="text-moss shrink-0" />
          <div className="text-sm">
            <span className="text-moss">已为您安排</span>
            <span className="text-white/70 ml-1">
              {ticket.room_number}号{ticket.room_type || ''}
            </span>
          </div>
        </div>
        {/* 扫房间码引导 */}
        <div className="rounded-lg bg-tan/10 border border-tan/20 p-3 text-xs text-tan/90 space-y-1">
          <div className="font-medium">请扫房间码进入服务</div>
          <div className="text-tan/60">
            到房间后扫门上的二维码，即可查看服务进度、点单、评价
          </div>
        </div>
      </div>

      {/* 技师 */}
      <div className="glass-card p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-tan/20 to-tan/5 flex items-center justify-center text-tan font-bold text-lg">
          {ticket.technician_number || <Star size={22} />}
        </div>
        <div>
          <div className="font-medium text-lg">{ticket.technician_name || '技师'}</div>
          <div className="text-xs text-white/40">
            {ticket.technician_number && `${ticket.technician_number}号 · `}
            {ticket.technician_level || ''}
            {started ? ' 正在为您服务' : ' 即将为您服务'}
          </div>
        </div>
      </div>

      {/* 服务项目 + 进度（未开钟时只显示项目信息） */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-medium">{ticket.service_name}</span>
          <span className="text-sm text-tan">{fmt(ticket.price_cents)}</span>
        </div>

        {started ? (
          <>
            <div className="flex justify-between text-xs text-white/40">
              <span className="flex items-center gap-1">
                <Clock size={12} /> 已服务 {elapsed(ticket.started_at)} 分钟
              </span>
              <span>共 {ticket.service_duration} 分钟</span>
            </div>
            <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-tan/60 to-tan rounded-full transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            {remainMin != null && (
              <div className="text-center">
                <span className="text-2xl font-medium text-tan">{remainMin}</span>
                <span className="text-xs text-white/40 ml-1">分钟后结束</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-3 space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs text-tan">
              <Clock size={13} className="animate-pulse" />
              技师正在赶来，请稍候
            </div>
            <div className="text-[10px] text-white/25">
              共 {ticket.service_duration} 分钟 · 服务开始后此处显示进度
            </div>
          </div>
        )}
      </div>

      {/* 评价入口（服务完成后显示） */}
      {reviewable && (
        <button
          onClick={() => setReviewOpen(true)}
          className="w-full glass-card p-4 flex items-center justify-center gap-2 text-sm text-tan hover:border-tan/30 active:scale-[0.98] transition-all"
        >
          <Star size={16} className="fill-tan" />
          评价 {ticket.technician_name || '技师'} 的服务
        </button>
      )}

      <div className="text-center text-[10px] text-white/20">
        {started ? '服务结束后请至前台结账' : '无需重新扫码，本页会自动更新'}
      </div>

      {/* 评价弹层 */}
      {reviewOpen && (
        <ReviewSheet
          ticket={ticket}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  )
}

// ─── 小组件 ────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-white/50">{label}</span>
      <span className="text-white/90">{value}</span>
    </div>
  )
}

function fmt(cents?: number) {
  if (cents == null) return '—'
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 60000))
}
