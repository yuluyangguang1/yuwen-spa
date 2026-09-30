import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Clock, History, LogOut, Key } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ChangePasswordModal } from '../components/ChangePassword'
import { DarkModeToggle } from '../components/DarkModeToggle'
import { BrandTitle } from '../components/BrandTitle'

// 技师端布局：手机竖屏优化，底部两个 tab
export default function TechLayout() {
  const { user, logout } = useAuth()
  const [showPwd, setShowPwd] = useState(false)

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0e0e0d] sm:bg-transparent">
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <BrandTitle suffix="技师" size="lg" />
        <div className="flex items-center gap-2">
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
      <main tabIndex={-1} className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <nav className="flex border-t border-white/5 bg-[#0e0e0d]/90 safe-area-pb shrink-0">
        <NavLink to="/tech" end className={({ isActive }) =>
          `flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] ${isActive ? 'text-tan' : 'text-white/60'}`
        }>
          <Clock size={20} />
          <span className="text-xs">我的排钟</span>
        </NavLink>
        <NavLink to="/tech/history" className={({ isActive }) =>
          `flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] ${isActive ? 'text-tan' : 'text-white/60'}`
        }>
          <History size={20} />
          <span className="text-xs">历史记录</span>
        </NavLink>
      </nav>
      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  )
}
