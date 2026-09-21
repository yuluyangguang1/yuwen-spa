// 足韵 yuwen-spa 前端入口
//
// 优化要点：
//   1. 路由懒加载：每个页面按需加载，减少首屏 bundle 体积
//   2. 全局错误边界：捕获渲染异常，防止白屏
//   3. API 超时 + 401 优雅跳转
//   4. TanStack Query 优化：staleTime、refetch 策略

import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import type { ReactNode } from 'react'

// ─── 路由懒加载 ──────────────────────────────────────
// React.lazy + Suspense：每个页面只在首次访问时加载
const Login = React.lazy(() => import('./pages/Login'))

// 收银端（前台派单）
const PosLayout = React.lazy(() => import('./layouts/PosLayout'))
const PosHome = React.lazy(() => import('./pages/pos/PosHome'))
const PosNewTicket = React.lazy(() => import('./pages/pos/PosNewTicket'))
const PosCashier = React.lazy(() => import('./pages/pos/PosCashier'))

// 技师端
const TechLayout = React.lazy(() => import('./layouts/TechLayout'))
const TechHome = React.lazy(() => import('./pages/tech/TechHome'))
const TechHistory = React.lazy(() => import('./pages/tech/TechHistory'))

// 顾客端（扫码）
const GuestView = React.lazy(() => import('./pages/guest/GuestView'))

// 总后台（老板管理）
const AdminLayout = React.lazy(() => import('./layouts/AdminLayout'))
const AdminDashboard = React.lazy(() => import('./pages/admin/AdminDashboard'))
const AdminServices = React.lazy(() => import('./pages/admin/AdminServices'))
const AdminTechnicians = React.lazy(() => import('./pages/admin/AdminTechnicians'))
const AdminRooms = React.lazy(() => import('./pages/admin/AdminRooms'))
const AdminCustomers = React.lazy(() => import('./pages/admin/AdminCustomers'))
const AdminTickets = React.lazy(() => import('./pages/admin/AdminTickets'))
const AdminAI = React.lazy(() => import('./pages/admin/AdminAI'))
const AdminSettings = React.lazy(() => import('./pages/admin/AdminSettings'))
const AdminUsers = React.lazy(() => import('./pages/admin/AdminUsers'))

// ─── 加载占位符 ──────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#170d02]">
      <div className="text-tan text-sm animate-pulse">加载中...</div>
    </div>
  )
}

// ─── 路由守卫 ──────────────────────────────────────
function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <PageLoader />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (roles && !roles.includes(user.role)) {
    const home = user.role === 'admin' ? '/admin' : user.role === 'pos' ? '/pos' : '/tech'
    return <Navigate to={home} replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <React.Suspense fallback={<PageLoader />}>
      <a href="#main-content" className="skip-navigation">跳至主内容</a>
      <main id="main-content">
        <nav aria-label="主导航">
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
          <Route path="users" element={<AdminUsers />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Routes>
      </nav>
    </main>
  </React.Suspense>
  )
}
