import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Clock, History, LogOut, Key } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ChangePasswordModal } from '../components/ChangePassword'

// 技师端布局：手机竖屏优化，底部两个 tab
export default function TechLayout() {
  const { user, logout } = useAuth()
  const [showPwd, setShowPwd] = useState(false)

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto">
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h1 className="font-display text-lg text-tan">足韵 · 技师</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPwd(true)} className="text-white/30 hover:text-tan transition-colors" title="修改密码">
            <Key size={14} />
          </button>
          <button onClick={logout} className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors">
            <LogOut size={14} />
            <span className="hidden sm:inline">{user?.display_name}</span>
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <nav className="flex border-t border-white/5 bg-[#0e0e0d]/90 safe-area-pb">
        <NavLink to="/tech" end className={({ isActive }) =>
          `flex-1 flex flex-col items-center gap-1 py-3 ${isActive ? 'text-tan' : 'text-white/40'}`
        }>
          <Clock size={20} />
          <span className="text-xs">我的排钟</span>
        </NavLink>
        <NavLink to="/tech/history" className={({ isActive }) =>
          `flex-1 flex flex-col items-center gap-1 py-3 ${isActive ? 'text-tan' : 'text-white/40'}`
        }>
          <History size={20} />
          <span className="text-xs">历史记录</span>
        </NavLink>
      </nav>
      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  )
}
