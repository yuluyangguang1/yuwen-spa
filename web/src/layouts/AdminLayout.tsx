import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Scissors, Users, DoorOpen, UserCircle, Receipt, Bot, Settings } from 'lucide-react'

const navItems = [
  { to: '/admin', label: '看板', icon: LayoutDashboard, end: true },
  { to: '/admin/tickets', label: '钟单', icon: Receipt },
  { to: '/admin/services', label: '项目', icon: Scissors },
  { to: '/admin/technicians', label: '技师', icon: Users },
  { to: '/admin/rooms', label: '房间', icon: DoorOpen },
  { to: '/admin/customers', label: '会员', icon: UserCircle },
  { to: '/admin/ai', label: 'AI 助手', icon: Bot },
  { to: '/admin/settings', label: '设置', icon: Settings },
]

export default function AdminLayout() {
  return (
    <div className="flex h-screen">
      {/* 侧边栏 */}
      <aside className="hidden md:flex flex-col w-52 border-r border-white/5 bg-[#0a0a09]">
        <div className="p-5">
          <h1 className="font-display text-xl text-tan">足韵</h1>
          <p className="text-[10px] text-white/30 mt-0.5">管理后台</p>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-tan/10 text-tan' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* 快捷入口 */}
        <div className="p-3 border-t border-white/5 space-y-1 text-xs">
          <a href="/pos" className="block px-3 py-1.5 text-white/30 hover:text-white/60 rounded">→ 收银端</a>
          <a href="/tech" className="block px-3 py-1.5 text-white/30 hover:text-white/60 rounded">→ 技师端</a>
        </div>
      </aside>

      {/* 移动端底部导航 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-white/5 bg-[#0a0a09]/95 backdrop-blur-xl py-1.5 safe-area-pb">
        {navItems.slice(0, 5).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] ${isActive ? 'text-tan' : 'text-white/40'}`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>
    </div>
  )
}
