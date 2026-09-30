import { useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../lib/api'
import { LayoutGrid, PlusCircle, Banknote, LogOut, Key } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ChangePasswordModal } from '../components/ChangePassword'
import { DarkModeToggle } from '../components/DarkModeToggle'
import { BrandTitle } from '../components/BrandTitle'

// 收银端布局：底部大按钮导航，适合触屏操作
export default function PosLayout() {
  const { user, logout } = useAuth()
  const [showPwd, setShowPwd] = useState(false)
  const { pathname } = useLocation()

  // 待办角标：与页面共享同 queryKey 缓存（台面=待派队列，结账=未收款钟单）
  const { data: queue = [] } = useQuery({
    queryKey: ['ticket-queue'],
    queryFn: () => get('/api/tickets/queue').then((r: any) => r?.data || r || []),
    refetchInterval: 10000,
    staleTime: 8000,
  })
  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-today'],
    queryFn: () => get('/api/tickets/today?pageSize=500'),
    refetchInterval: 10000,
    staleTime: 8000,
  })
  const queueCount = Array.isArray(queue) ? queue.length : 0
  const unpaidCount = tickets.filter((t: any) => t.status === 'active' || t.status === 'completed').length

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#0e0e0d]/80 backdrop-blur-xl">
        <BrandTitle suffix="收银" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50"><Clock /></span>
          <DarkModeToggle />
          <button onClick={() => setShowPwd(true)} aria-label="修改密码" className="text-white/50 hover:text-tan transition-colors p-2 -m-1 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <Key size={16} />
          </button>
          <button onClick={logout} aria-label={`退出登录 ${user?.display_name ?? ''}`} className="flex items-center gap-1 text-xs text-white/50 hover:text-red-400 transition-colors p-2 -m-1 min-h-[44px]">
            <LogOut size={16} />
            <span className="hidden sm:inline">{user?.display_name}</span>
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main tabIndex={-1} className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* 底部导航 - 大按钮，触屏友好；活动底片随路由滑移（glide 指示器） */}
      <nav className="relative flex border-t border-white/5 bg-[#0e0e0d]/90 backdrop-blur-xl safe-area-pb">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-1/3 rounded-xl bg-tan/10 transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${(pathname === '/pos' ? 0 : pathname.startsWith('/pos/new') ? 1 : 2) * 100}%)` }}
        />
        <PosNavBtn to="/pos" icon={LayoutGrid} label="台面" end badge={queueCount} />
        <PosNavBtn to="/pos/new" icon={PlusCircle} label="开钟" />
        <PosNavBtn to="/pos/cashier" icon={Banknote} label="结账" badge={unpaidCount} />
      </nav>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  )
}

function PosNavBtn({ to, icon: Icon, label, end, badge = 0 }: any) {
  return (
    <NavLink to={to} end={end}
      aria-label={badge > 0 ? `${label}，${badge} 项待处理` : undefined}
      className={({ isActive }) =>
        `relative z-10 flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] transition-colors ${isActive ? 'text-tan' : 'text-white/60'}`
      }>
      <span className="relative">
        <Icon size={22} />
        {badge > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-2 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-cinnabar text-white text-[10px] font-medium leading-[18px] text-center"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="text-xs">{label}</span>
    </NavLink>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span>{now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}</span>
}
