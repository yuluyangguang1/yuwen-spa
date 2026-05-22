import { Outlet, NavLink } from 'react-router-dom'
import { Clock, History } from 'lucide-react'

// 技师端布局：手机竖屏优化，底部两个 tab
export default function TechLayout() {
  return (
    <div className="flex flex-col h-screen max-w-md mx-auto">
      <header className="px-4 py-3 border-b border-white/5">
        <h1 className="font-display text-lg text-tan">足韵 · 技师</h1>
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
    </div>
  )
}
