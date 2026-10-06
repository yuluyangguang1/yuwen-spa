import { useEffect, useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, ShoppingBasket, LogOut, Key } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ChangePasswordModal } from '@/components/ChangePassword'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { BrandTitle } from '@/components/BrandTitle'

// 客服端布局：看板 + 点单 两个大 tab（前台/客服触屏友好）
export default function CsLayout() {
  const { user, logout } = useAuth()
  const [showPwd, setShowPwd] = useState(false)

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#0e0e0d]/80 backdrop-blur-xl">
        <BrandTitle suffix="客服" />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-white/50 px-1 hidden sm:inline"><Clock /></span>
          <a href="/pos" className="text-xs text-white/50 hover:text-white/80 transition-colors hidden sm:inline px-2">收银端</a>
          <DarkModeToggle />
          <button onClick={() => setShowPwd(true)} aria-label="修改密码" style={{ minWidth: 44, minHeight: 44 }} className="text-white/50 hover:text-tan transition-colors flex items-center justify-center">
            <Key size={16} />
          </button>
          <button onClick={logout} aria-label={`退出登录 ${user?.display_name ?? ''}`} style={{ minWidth: 44, minHeight: 44 }} className="flex items-center justify-center gap-1 text-xs text-white/50 hover:text-red-400 transition-colors">
            <LogOut size={16} />
            <span className="hidden sm:inline">{user?.display_name}</span>
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main tabIndex={-1} className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* 底部导航 */}
      <nav className="flex border-t border-white/5 bg-[#0e0e0d]/90 backdrop-blur-xl safe-area-pb">
        <CsNavBtn to="/cs" icon={LayoutDashboard} label="看板" end />
        <CsNavBtn to="/cs/orders" icon={ShoppingBasket} label="点单" />
      </nav>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  )
}

function CsNavBtn({ to, icon: Icon, label, end }: any) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] transition-colors ${isActive ? 'text-tan' : 'text-white/60'}`
      }>
      <Icon size={22} />
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
