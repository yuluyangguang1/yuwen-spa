import { Routes, Route, Navigate } from 'react-router-dom'

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
import AdminSettings from './pages/admin/AdminSettings'

export default function App() {
  return (
    <Routes>
      {/* 默认跳转到收银端 */}
      <Route path="/" element={<Navigate to="/pos" replace />} />

      {/* 收银端 */}
      <Route path="/pos" element={<PosLayout />}>
        <Route index element={<PosHome />} />
        <Route path="new" element={<PosNewTicket />} />
        <Route path="cashier" element={<PosCashier />} />
      </Route>

      {/* 技师端 */}
      <Route path="/tech" element={<TechLayout />}>
        <Route index element={<TechHome />} />
        <Route path="history" element={<TechHistory />} />
      </Route>

      {/* 顾客端 */}
      <Route path="/guest/room/:roomId" element={<GuestView />} />

      {/* 总后台 */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="services" element={<AdminServices />} />
        <Route path="technicians" element={<AdminTechnicians />} />
        <Route path="rooms" element={<AdminRooms />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="tickets" element={<AdminTickets />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
    </Routes>
  )
}
