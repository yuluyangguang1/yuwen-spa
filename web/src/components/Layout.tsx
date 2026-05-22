import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Scissors, Users, Settings } from 'lucide-react'

const navItems = [
  { to: '/dashboard', label: '台面', icon: LayoutDashboard },
  { to: '/services', label: '项目', icon: Scissors },
  { to: '/technicians', label: '技师', icon: Users },
]

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 - 桌面端 */}
      <aside className="hidden md:flex flex-col w-56 border-r border-white/10 bg-[#0e0e0d]/50 backdrop-blur-xl">
        <div className="p-5">
          <h1 className="font-display text-2xl text-tan">足韵</h1>
          <p className="text-xs text-ink-muted dark:text-white/40 mt-1">yuwen-spa</p>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-tan/15 text-tan font-medium'
                    : 'text-white/60 hover:text-white/90 hover:bg-white/5'
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-white/5">
          <NavLink to="/settings" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/40 hover:text-white/70">
            <Settings size={16} />
            设置
          </NavLink>
        </div>
      </aside>

      {/* 底部导航 - 移动端 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-white/10 bg-[#0e0e0d]/90 backdrop-blur-xl py-2 safe-area-pb">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-4 py-1 text-xs transition-colors ${
                isActive ? 'text-tan' : 'text-white/50'
              }`
            }
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <Outlet />
      </main>
    </div>
  )
}
