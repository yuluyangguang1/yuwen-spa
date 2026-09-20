import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { Bell, Send, CheckCircle, XCircle } from 'lucide-react'
import { Field } from '@/components/Field'

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

      {/* 企业微信通知 */}
      <NotifyConfig />

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

// ── 企业微信通知配置 ─────────────────────────────
function NotifyConfig() {
  const qc = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['notify-config'],
    queryFn: () => get<{ webhookUrl: string; enabled: boolean }>('/api/notify/config'),
  })

  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  const currentUrl = webhookUrl ?? config?.webhookUrl ?? ''
  const currentEnabled = config?.enabled ?? false

  const saveMut = useMutation({
    mutationFn: (data: any) => post('/api/notify/config', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notify-config'] }),
  })

  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)
  const testMut = useMutation({
    mutationFn: () => post('/api/notify/test'),
    onSuccess: (data: any) => setTestResult(data),
    onError: (err: any) => setTestResult({ ok: false, error: err.message }),
  })

  return (
    <section className="glass-card p-5 space-y-4">
      <h2 className="text-sm text-white/50 flex items-center gap-2">
        <Bell size={14} /> 企业微信通知
      </h2>
      <p className="text-xs text-white/30">
        配置企业微信群机器人 webhook，开钟和结账时自动推送通知到群里。
      </p>

      <div>
        <label className="block text-xs text-white/40 mb-1">Webhook 地址</label>
        <input
          type="text"
          value={currentUrl}
          onChange={e => setWebhookUrl(e.target.value)}
          placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:border-tan/40 focus:outline-none"
        />
        <div className="text-[10px] text-white/25 mt-1">
          企业微信群 → 群设置 → 群机器人 → 添加机器人 → 复制 webhook 地址
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-white/60">启用通知</span>
        <button
          onClick={() => saveMut.mutate({ enabled: !currentEnabled })}
          className={`w-10 h-5 rounded-full transition-colors relative ${currentEnabled ? 'bg-tan' : 'bg-white/10'}`}
        >
          <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${currentEnabled ? 'left-5' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => saveMut.mutate({ webhookUrl: currentUrl, enabled: currentEnabled })}
          disabled={saveMut.isPending}
          className="flex-1 bg-tan text-white py-2 rounded-lg text-sm active:scale-[0.97] disabled:opacity-50"
        >
          {saveMut.isPending ? '保存中...' : '保存'}
        </button>
        <button
          onClick={() => { setTestResult(null); testMut.mutate() }}
          disabled={testMut.isPending || !currentUrl}
          className="flex-1 glass-card py-2 text-center text-sm text-white/50 hover:text-white/80 flex items-center justify-center gap-1.5 disabled:opacity-30"
        >
          <Send size={14} />
          {testMut.isPending ? '发送中...' : '测试发送'}
        </button>
      </div>

      {saveMut.isSuccess && <div className="text-xs text-moss">已保存</div>}

      {testResult && (
        <div className={`text-xs p-2 rounded flex items-center gap-1.5 ${testResult.ok ? 'bg-moss/10 text-moss' : 'bg-red-500/10 text-red-400'}`}>
          {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {testResult.ok ? testResult.message : testResult.error}
        </div>
      )}
    </section>
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