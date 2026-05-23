import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import type { ReactNode } from 'react'

// ─── 登录页 ──────────────────────────────────────
import Login from './pages/Login'

// ─── 收银端（前台派单）───────────────────────────────
import PosLayout from './layouts/PosLayout'
import PosHome from './pages/pos/PosHome'
import PosNewTicket from './pages/pos/PosNewTicket'
import PosCashier from './pages/pos/PosCashier'

// ─── 技师端 ─────────────────────────────────────────
import TechLayout from './layouts/TechLayout'
import TechHome from './pages/tech/TechHome'
import TechHistory from './pages/tech/TechHistory'

// ─── 顾客端（扫码）──────────────────────────────────
import GuestView from './pages/guest/GuestView'

// ─── 总后台（老板管理）──────────────────────────────
import AdminLayout from './layouts/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminServices from './pages/admin/AdminServices'
import AdminTechnicians from './pages/admin/AdminTechnicians'
import AdminRooms from './pages/admin/AdminRooms'
import AdminCustomers from './pages/admin/AdminCustomers'
import AdminTickets from './pages/admin/AdminTickets'
import AdminAI from './pages/admin/AdminAI'
import AdminSettings from './pages/admin/AdminSettings'

// ─── 路由守卫 ──────────────────────────────────────
function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a09]">
        <div className="text-white/30 text-sm">加载中...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (roles && !roles.includes(user.role)) {
    // 角色不匹配，跳到对应角色的首页
    const home = user.role === 'admin' ? '/admin' : user.role === 'pos' ? '/pos' : '/tech'
    return <Navigate to={home} replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      {/* 登录页（无需鉴权） */}
      <Route path="/login" element={<Login />} />

      {/* 顾客端（无需登录，扫码访问） */}
      <Route path="/guest/room/:roomId" element={<GuestView />} />

      {/* 默认跳转到收银端 */}
      <Route path="/" element={<Navigate to="/pos" replace />} />

      {/* 收银端（admin + pos 可访问） */}
      <Route path="/pos" element={
        <RequireAuth roles={['admin', 'pos']}>
          <PosLayout />
        </RequireAuth>
      }>
        <Route index element={<PosHome />} />
        <Route path="new" element={<PosNewTicket />} />
        <Route path="cashier" element={<PosCashier />} />
      </Route>

      {/* 技师端（admin + tech 可访问） */}
      <Route path="/tech" element={
        <RequireAuth roles={['admin', 'tech']}>
          <TechLayout />
        </RequireAuth>
      }>
        <Route index element={<TechHome />} />
        <Route path="history" element={<TechHistory />} />
      </Route>

      {/* 总后台（仅 admin） */}
      <Route path="/admin" element={
        <RequireAuth roles={['admin']}>
          <AdminLayout />
        </RequireAuth>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="services" element={<AdminServices />} />
        <Route path="technicians" element={<AdminTechnicians />} />
        <Route path="rooms" element={<AdminRooms />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="tickets" element={<AdminTickets />} />
        <Route path="ai" element={<AdminAI />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
    </Routes>
  )
}
