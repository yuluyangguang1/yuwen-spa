// 足韵 yuwen-spa 前端入口
//
// 优化要点：
//   1. 路由懒加载：每个页面按需加载，减少首屏 bundle 体积
//   2. 全局错误边界：捕获渲染异常，防止白屏
//   3. API 超时 + 401 优雅跳转
//   4. TanStack Query 优化：staleTime、refetch 策略

import React from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import type { ReactNode } from 'react'

// ─── 路由懒加载 ──────────────────────────────────────
// React.lazy + Suspense：每个页面只在首次访问时加载
// chunk 加载失败（发版后旧 hash）自动重试一次，仍失败交给 ErrorBoundary 硬刷新
function isChunkLoadError(e: any): boolean {
  const m = `${e?.name || ''} ${e?.message || ''}`
  return /ChunkLoadError|Failed to fetch dynamically imported|Importing a module script failed|dynamically imported module|Loading chunk/i.test(m)
}

function lazyWithRetry<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return React.lazy(async () => {
    try {
      return await factory()
    } catch (e) {
      if (isChunkLoadError(e)) {
        await new Promise((r) => setTimeout(r, 250))
        return await factory()
      }
      throw e
    }
  })
}

const Login = lazyWithRetry(() => import('./pages/Login'))

// 收银端（前台派单）
const PosLayout = lazyWithRetry(() => import('./layouts/PosLayout'))
const PosHome = lazyWithRetry(() => import('./pages/pos/PosHome'))
const PosNewTicket = lazyWithRetry(() => import('./pages/pos/PosNewTicket'))
const PosCashier = lazyWithRetry(() => import('./pages/pos/PosCashier'))

// 技师端
const TechLayout = lazyWithRetry(() => import('./layouts/TechLayout'))
const TechHome = lazyWithRetry(() => import('./pages/tech/TechHome'))
const TechHistory = lazyWithRetry(() => import('./pages/tech/TechHistory'))

// 顾客端（扫码）
const GuestView = lazyWithRetry(() => import('./pages/guest/GuestView'))

// 总后台（老板管理）
const AdminLayout = lazyWithRetry(() => import('./layouts/AdminLayout'))
const AdminDashboard = lazyWithRetry(() => import('./pages/admin/AdminDashboard'))
const AdminServices = lazyWithRetry(() => import('./pages/admin/AdminServices'))
const AdminTechnicians = lazyWithRetry(() => import('./pages/admin/AdminTechnicians'))
const AdminRooms = lazyWithRetry(() => import('./pages/admin/AdminRooms'))
const AdminCustomers = lazyWithRetry(() => import('./pages/admin/AdminCustomers'))
const AdminTickets = lazyWithRetry(() => import('./pages/admin/AdminTickets'))
const AdminReports = lazyWithRetry(() => import('./pages/admin/AdminReports'))
const AdminAI = lazyWithRetry(() => import('./pages/admin/AdminAI'))
const AdminSettings = lazyWithRetry(() => import('./pages/admin/AdminSettings'))
const AdminUsers = lazyWithRetry(() => import('./pages/admin/AdminUsers'))
const AdminProducts = lazyWithRetry(() => import('./pages/admin/AdminProducts'))
const AdminCoupons = lazyWithRetry(() => import('./pages/admin/AdminCoupons'))
const AdminAppointments = lazyWithRetry(() => import('./pages/admin/AdminAppointments'))
const AdminSchedule = lazyWithRetry(() => import('./pages/admin/AdminSchedule'))

// 客服端
const CsLayout = lazyWithRetry(() => import('./layouts/CsLayout'))
const CsDashboard = lazyWithRetry(() => import('./pages/cs/CsDashboard'))
const CsOrders = lazyWithRetry(() => import('./pages/cs/CsOrders'))

// ─── 加载占位符 ──────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#170d02]">
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
    const home = user.role === 'admin' ? '/admin' : user.role === 'pos' ? '/pos' : user.role === 'cs' ? '/cs' : '/tech'
    return <Navigate to={home} replace />
  }

  return <>{children}</>
}

// ─── 路由切换：滚动复位 + 焦点交给新页面 ──────────────
// 各 layout 的 <main class="flex-1 overflow-y-auto"> 是真实滚动容器；
// 换页时滚回顶部，并把键盘焦点从导航移到内容区（无障碍）。
function ScrollToTop() {
  const { pathname } = useLocation()
  React.useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('main.overflow-y-auto')
    if (scroller) scroller.scrollTop = 0
    // 焦点交给内容区（layout 的 <main tabIndex={-1}>，无 layout 时退回外层）；
    // 输入框已自动聚焦时（如登录页）不抢焦点
    const ae = document.activeElement as HTMLElement | null
    const typing = !!ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)
    if (!typing) {
      const target = (document.querySelector('main') as HTMLElement | null)
        || document.getElementById('main-content')
      target?.focus({ preventScroll: true })
    }
  }, [pathname])
  return null
}

export default function App() {
  return (
    <React.Suspense fallback={<PageLoader />}>
      <a href="#main-content" className="skip-navigation">跳至主内容</a>
      <div id="main-content" tabIndex={-1}>
        <ScrollToTop />
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

        {/* 客服端（admin + cs 可访问） */}
        <Route path="/cs" element={
          <RequireAuth roles={['admin', 'cs']}>
            <CsLayout />
          </RequireAuth>
        }>
          <Route index element={<CsDashboard />} />
          <Route path="orders" element={<CsOrders />} />
        </Route>

        {/* 总后台（仅 admin） */}
        <Route path="/admin" element={
          <RequireAuth roles={['admin']}>
            <AdminLayout />
          </RequireAuth>
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="services" element={<AdminServices />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="technicians" element={<AdminTechnicians />} />
          <Route path="rooms" element={<AdminRooms />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="coupons" element={<AdminCoupons />} />
          <Route path="appointments" element={<AdminAppointments />} />
          <Route path="schedule" element={<AdminSchedule />} />
          <Route path="schedules" element={<Navigate to="/admin/schedule?tab=shifts" replace />} />
          <Route path="inventory" element={<Navigate to="/admin/products" replace />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="ai" element={<AdminAI />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
        {/* 404 兜底：错链/旧书签不白屏 */}
        <Route path="*" element={
          <div className="min-h-[100dvh] flex items-center justify-center bg-[#170d02] text-white/60">
            <div className="text-center space-y-3">
              <div className="text-4xl text-tan">404</div>
              <p className="text-sm">页面不存在</p>
              <a href="/" className="inline-block px-4 py-2 bg-tan/20 text-tan rounded-lg text-sm hover:bg-tan/30">
                返回首页
              </a>
            </div>
          </div>
        } />
      </Routes>
      </div>
  </React.Suspense>
  )
}
