import { Outlet, NavLink } from 'react-router-dom'
import { LayoutGrid, PlusCircle, Banknote, LogOut } from 'lucide-react'
import { useAuth } from '../lib/auth'

// 收银端布局：底部大按钮导航，适合触屏操作
export default function PosLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex flex-col h-screen">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#0e0e0d]/80 backdrop-blur-xl">
        <h1 className="font-display text-xl text-tan">足韵 · 收银</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/30">
            <Clock />
          </span>
          <button
            onClick={logout}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">{user?.display_name}</span>
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* 底部导航 - 大按钮，触屏友好 */}
      <nav className="flex border-t border-white/5 bg-[#0e0e0d]/90 backdrop-blur-xl safe-area-pb">
        <PosNavBtn to="/pos" icon={LayoutGrid} label="台面" end />
        <PosNavBtn to="/pos/new" icon={PlusCircle} label="开钟" />
        <PosNavBtn to="/pos/cashier" icon={Banknote} label="结账" />
      </nav>
    </div>
  )
}

function PosNavBtn({ to, icon: Icon, label, end }: any) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
          isActive ? 'text-tan' : 'text-white/40'
        }`
      }
    >
      <Icon size={22} />
      <span className="text-xs">{label}</span>
    </NavLink>
  )
}

function Clock() {
  const now = new Date()
  return <span>{now.getHours().toString().padStart(2,'0')}:{now.getMinutes().toString().padStart(2,'0')}</span>
}
