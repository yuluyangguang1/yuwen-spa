// 客服端看板：全场实时状态（技师 / 房间 / 钟单 / 今日统计）
// 复用客服实时看板组件（AdminDashboard 内部即看板逻辑，数据接口对 cs 角色开放）

import AdminDashboard from '@/pages/admin/AdminDashboard'

export default function CsDashboard() {
  return <AdminDashboard />
}
