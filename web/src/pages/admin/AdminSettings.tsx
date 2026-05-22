import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'

export default function AdminSettings() {
  const { data: shop } = useQuery({
    queryKey: ['shop'],
    queryFn: () => get('/api/shops/current'),
  })
  const { data: system } = useQuery({
    queryKey: ['system'],
    queryFn: () => get('/api/system'),
  })

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-lg font-medium">系统设置</h1>

      {/* 门店信息 */}
      <section className="glass-card p-5 space-y-3">
        <h2 className="text-sm text-white/50">门店信息</h2>
        <div className="grid gap-3">
          <Field label="店名" value={shop?.name} />
          <Field label="地址" value={shop?.address || '未设置'} />
          <Field label="电话" value={shop?.phone || '未设置'} />
        </div>
      </section>

      {/* 系统信息 */}
      <section className="glass-card p-5 space-y-3">
        <h2 className="text-sm text-white/50">系统信息</h2>
        <div className="grid gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-white/40">主机名</span>
            <span>{system?.hostname}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">平台</span>
            <span>{system?.platform} / {system?.arch}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Node.js</span>
            <span>{system?.nodeVersion}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">运行时间</span>
            <span>{system?.uptime ? `${Math.floor(system.uptime / 3600)}小时` : '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">内存</span>
            <span>{system?.memory ? `${Math.round(system.memory.free / 1024 / 1024)}MB 可用` : '-'}</span>
          </div>
        </div>
      </section>

      {/* 访问入口 */}
      <section className="glass-card p-5 space-y-3">
        <h2 className="text-sm text-white/50">各端入口</h2>
        <div className="grid gap-2 text-sm">
          <Entry label="收银端" path="/pos" desc="前台开钟、结账" />
          <Entry label="技师端" path="/tech" desc="技师查看排钟、提成" />
          <Entry label="顾客端" path="/guest/room/[roomId]" desc="扫房间二维码，选技师下单" />
          <Entry label="管理后台" path="/admin" desc="全部管理功能" />
        </div>
      </section>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/40">{label}</span>
      <span className="text-sm">{value || '-'}</span>
    </div>
  )
}

function Entry({ label, path, desc }: { label: string; path: string; desc: string }) {
  return (
    <a href={path} className="flex items-center justify-between glass-card p-3 hover:border-tan/20">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-[10px] text-white/30">{desc}</div>
      </div>
      <span className="text-xs text-white/30 font-mono">{path}</span>
    </a>
  )
}
