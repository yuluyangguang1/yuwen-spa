import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Scissors, Users, DoorOpen, UserCircle, Receipt, Bot, Settings, LogOut, UserCog, Key, BarChart3, ShoppingBasket, TicketPercent, CalendarClock, CalendarDays, Menu } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ChangePasswordModal } from '@/components/ChangePassword'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { BrandTitle } from '@/components/BrandTitle'

const navItems = [
  { to: '/admin', label: '看板', icon: LayoutDashboard, end: true, group: 'ops' },
  { to: '/admin/tickets', label: '钟单', icon: Receipt, group: 'ops' },
  { to: '/admin/appointments', label: '预约', icon: CalendarClock, group: 'ops' },
  { to: '/admin/schedule', label: '排钟', icon: CalendarDays, group: 'ops' },
  { to: '/admin/services', label: '项目', icon: Scissors, group: 'ops' },
  { to: '/admin/products', label: '商品', icon: ShoppingBasket, group: 'ops' },
  { to: '/admin/coupons', label: '优惠券', icon: TicketPercent, group: 'ops' },
  { to: '/admin/technicians', label: '技师', icon: Users, group: 'ops' },
  { to: '/admin/rooms', label: '房间', icon: DoorOpen, group: 'ops' },
  { to: '/admin/customers', label: '会员', icon: UserCircle, group: 'ops' },
  { to: '/admin/reports', label: '报表', icon: BarChart3, group: 'sys' },
  { to: '/admin/ai', label: 'AI 助手', icon: Bot, group: 'sys' },
  { to: '/admin/users', label: '账号', icon: UserCog, group: 'sys' },
  { to: '/admin/settings', label: '设置', icon: Settings, group: 'sys' },
]
const opsNavItems = navItems.filter(i => i.group === 'ops')
const sysNavItems = navItems.filter(i => i.group === 'sys')

// 移动端底部导航（5 个核心 tab）— 按 to 路径引用，避免插入项后索引错位
const MOBILE_TO = ['/admin', '/admin/tickets', '/admin/products', '/admin/reports', '/admin/settings']
const mobileNavItems = MOBILE_TO.map(to => navItems.find(i => i.to === to)!).filter(Boolean)

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const [showPwd, setShowPwd] = useState(false)
  const [showMore, setShowMore] = useState(false)

  return (
    <div className="flex h-[100dvh]">
      {/* 侧边栏（aside 不设 navigation role，避免与内层 nav landmark 重复） */}
      <aside className="hidden md:flex flex-col w-52 border-r border-white/5 bg-[#170d02]">
        <header className="p-5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <BrandTitle />
            <p className="text-xs text-white/50 mt-0.5">管理后台</p>
          </div>
          <DarkModeToggle />
        </header>
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto min-h-0" aria-label="主导航">
          <span className="text-[10px] text-white/50 uppercase mt-3 mb-1">运营</span>
          {opsNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-tan/10 text-tan' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
          <span className="text-[10px] text-white/50 uppercase mt-3 mb-1">系统</span>
          {sysNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-tan/10 text-tan' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* 快捷入口 + 用户信息 */}
        <div className="p-3 border-t border-white/5 space-y-1 text-xs">
          <a href="/pos" className="block px-3 py-1.5 text-white/50 hover:text-white rounded">→ 收银端</a>
          <a href="/cs" className="block px-3 py-1.5 text-white/50 hover:text-white rounded">→ 客服端</a>
          <a href="/tech" className="block px-3 py-1.5 text-white/50 hover:text-white rounded">→ 技师端</a>
          <button
            onClick={() => setShowPwd(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-white/50 hover:text-tan rounded transition-colors"
          >
            <Key size={12} />
            修改密码
          </button>
          <button
            onClick={logout}
            aria-label="退出登录"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-white/50 hover:text-red-400 rounded transition-colors"
          >
            <LogOut size={12} />
            {user?.display_name || user?.username} · 退出
          </button>
        </div>
      </aside>

      {/* 移动端底部导航 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-white/5 bg-[#170d02]/95 py-1 safe-area-pb" aria-label="移动端导航">
        {mobileNavItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1.5 min-h-[44px] justify-center text-xs ${isActive ? 'text-tan' : 'text-white/60'}`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
        {/* 更多：展开全量入口（移动端此前 11 个页面不可达） */}
        <button
          onClick={() => setShowMore(v => !v)}
          aria-expanded={showMore}
          aria-label="更多功能"
          className={`flex flex-col items-center gap-0.5 px-2 py-1.5 min-h-[44px] justify-center text-xs ${showMore ? 'text-tan' : 'text-white/60'}`}
        >
          <Menu size={18} />
          更多
        </button>
      </nav>

      {/* 移动端「更多」抽屉 */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setShowMore(false)}>
          <div
            className="absolute bottom-16 left-2 right-2 glass-card p-3 max-h-[70vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-2">
              {navItems.filter(i => !MOBILE_TO.includes(i.to)).map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 p-2 rounded-lg text-xs min-h-[56px] justify-center ${
                      isActive ? 'bg-tan/10 text-tan' : 'text-white/60 hover:bg-white/5'
                    }`
                  }
                >
                  <item.icon size={18} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 移动端顶栏：用户名 + 退出（半透明底，滚动时盖住内容） */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 px-3 py-2 flex items-center justify-between gap-2 bg-[#170d02]/85 backdrop-blur-xl border-b border-white/5">
        <BrandTitle size="sm" />
        <div className="flex items-center gap-2">
          <DarkModeToggle className="!p-1.5" />
          <button
            onClick={() => setShowPwd(true)}
            aria-label="修改密码"
            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg bg-white/5 text-white/60 text-xs hover:text-tan transition-colors"
          >
            <Key size={14} />
          </button>
          <button
            onClick={logout}
            aria-label="退出登录"
            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg bg-white/5 text-white/60 text-xs hover:text-red-400 transition-colors"
          >
            <LogOut size={14} />
            退出
          </button>
        </div>
      </div>

      <main tabIndex={-1} className="flex-1 overflow-y-auto pb-16 md:pb-0 pt-12 md:pt-0 min-w-0">
        <Outlet />
      </main>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  )
}
