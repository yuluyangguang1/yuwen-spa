import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, getFull, post, put, del } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Bell, Send, CheckCircle, XCircle, History, ScrollText, Timer, SunMoon, Plus, Edit2, Trash2, X, Download, RotateCcw, DatabaseBackup } from 'lucide-react'
import { Field } from '@/components/Field'
import { SearchInput } from '@/components/SearchInput'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

export default function AdminSettings() {
  const { data: system } = useQuery({
    queryKey: ['system'],
    queryFn: () => get('/api/system'),
  })
  const { locale, setLocale } = useI18n()

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-lg font-medium">系统设置</h1>

      {/* 外观 */}
      <section className="glass-card p-5 space-y-3">
        <h2 className="text-sm text-white/50 flex items-center gap-2">
          <SunMoon size={14} /> 外观
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-white/60">深色模式</div>
            <div className="text-xs text-white/30 mt-0.5">跟随本设备偏好，刷新后保持</div>
          </div>
          <DarkModeToggle />
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <div>
            <div className="text-sm text-white/60">界面语言</div>
            <div className="text-xs text-white/30 mt-0.5">Language / 语言</div>
          </div>
          <div className="flex gap-1">
            {(['zh', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                  locale === l
                    ? 'bg-tan text-white'
                    : 'bg-white/5 text-white/40 hover:text-white/70'
                }`}
              >
                {l === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 企业微信通知 */}
      <NotifyConfig />
      <EndRemindConfig />
      <NotifyHistory />
      <TopupCommissionRules />
      <AuditLogs />

      {/* 门店信息（名称改后全端左上角/登录页/顾客端/收据同步显示） */}
      <ShopConfig />

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

      {/* 数据备份 */}
      <BackupPanel />

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

      {/* 品牌标识 */}
      <section className="glass-card p-5 space-y-4">
        <h2 className="text-sm text-white/50">品牌标识</h2>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <img src="/yu-logo.svg" alt="羽AI" className="w-16 h-16" />
            <span className="text-xs text-white/40">羽AI</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <img src="/yu-brand.png" alt="足韵 · 涌泉印" className="w-16 h-16 rounded-full" />
            <span className="text-xs text-white/40">足韵 · 涌泉印</span>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── 企业微信通知配置 ─────────────────────────────
function ShopConfig() {
  const qc = useQueryClient()
  const { data: shop } = useQuery({
    queryKey: ['shop'],
    queryFn: () => get('/api/shops/current'),
  })
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const loadedRef = useRef(false)
  useEffect(() => {
    if (shop && !loadedRef.current) {
      loadedRef.current = true
      setName(shop.name || '')
      setAddress(shop.address || '')
      setPhone(shop.phone || '')
    }
  }, [shop])

  const [flash, setFlash] = useState(false)
  const saveMut = useMutation({
    mutationFn: () => put('/api/shops/' + shop!.id, {
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop'] })
      qc.invalidateQueries({ queryKey: ['guest-shop'] })
      toast.success('门店信息已保存')
      setFlash(true)
      setTimeout(() => setFlash(false), 1500)
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  })

  return (
    <section className="glass-card p-5 space-y-3">
      <h2 className="text-sm text-white/50">门店信息</h2>
      <p className="text-xs text-white/30">
        门店名称会显示在各端左上角、登录页、顾客端、收据与房间二维码标签。
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="门店名称" value={name} onChange={setName} placeholder="如：足韵 · 涌泉印" required />
        <Field label="地址" value={address} onChange={setAddress} />
        <Field label="电话" value={phone} onChange={setPhone} />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveMut.mutate()}
          disabled={!shop || !name.trim() || saveMut.isPending}
          className={`bg-tan text-white px-5 py-2 rounded-lg text-sm active:scale-[0.97] disabled:opacity-50 ${flash ? 'btn-done' : ''}`}
        >
          {saveMut.isPending ? '保存中...' : '保存'}
        </button>
        {saveMut.isSuccess && <span className="text-xs text-moss">已保存</span>}
      </div>
    </section>
  )
}

function NotifyConfig() {
  const qc = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['notify-config'],
    queryFn: () => get<any>('/api/notify/config'),
  })

  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  const currentUrl = webhookUrl ?? config?.channels?.wechat?.webhookUrl ?? ''
  const currentEnabled = config?.channels?.wechat?.enabled ?? false

  const [flash, setFlash] = useState(false)
  const flashTick = () => { setFlash(true); setTimeout(() => setFlash(false), 1500) }
  const saveMut = useMutation({
    mutationFn: (data: any) => post('/api/notify/config', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notify-config'] })
      toast.success('通知配置已保存')
      flashTick()
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
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
          className={`flex-1 bg-tan text-white py-2 rounded-lg text-sm active:scale-[0.97] disabled:opacity-50 ${flash ? 'btn-done' : ''}`}
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

// ── 完钟倒计时提醒配置 ─────────────────────────
function EndRemindConfig() {
  const qc = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['notify-config'],
    queryFn: () => get<any>('/api/notify/config'),
  })
  const minutes = config?.endWarnMinutes ?? [5]
  const [draft, setDraft] = useState<string | null>(null)
  const current = draft ?? minutes.join(',')

  const [flash, setFlash] = useState(false)
  const flashTick = () => { setFlash(true); setTimeout(() => setFlash(false), 1500) }
  const saveMut = useMutation({
    mutationFn: (endWarnMinutes: number[]) =>
      post('/api/notify/config', { endWarnMinutes }),
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['notify-config'] })
      toast.success('预警分钟已保存')
      flashTick()
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  })
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const testMut = useMutation({
    mutationFn: (stage: number) => post('/api/notify/test-end', { stage }),
    onSuccess: (data: any) => setTestMsg(`已广播 ${data?.type || '事件'}（请听电脑/手机声音）`),
    onError: (err: any) => setTestMsg(err.message || '测试失败'),
  })

  const parse = () =>
    [...new Set(String(current || '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0 && n <= 480))]

  return (
    <section className="glass-card p-5 space-y-4">
      <h2 className="text-sm text-white/50 flex items-center gap-2">
        <Timer size={14} /> 完钟喇叭提醒
      </h2>
      <p className="text-xs text-white/30">
        快完钟/到点时，收银台、技师端、顾客页外放提示音与语音；到点固定提醒。逗号分隔提前分钟，如 <code className="text-tan/70">5</code> 或 <code className="text-tan/70">10,5</code>。
      </p>
      <div>
        <label className="block text-xs text-white/40 mb-1">预警提前分钟</label>
        <input
          type="text"
          value={current}
          onChange={e => setDraft(e.target.value)}
          placeholder="5 或 10,5"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:border-tan/40 focus:outline-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => saveMut.mutate(parse())}
          disabled={saveMut.isPending}
          className={`flex-1 bg-tan text-white py-2 rounded-lg text-sm active:scale-[0.97] disabled:opacity-50 ${flash ? 'btn-done' : ''}`}
        >
          {saveMut.isPending ? '保存中...' : '保存预警'}
        </button>
        <button
          onClick={() => { setTestMsg(null); testMut.mutate(5) }}
          disabled={testMut.isPending}
          className="flex-1 glass-card py-2 text-center text-sm text-white/50 hover:text-white/80 flex items-center justify-center gap-1.5 disabled:opacity-30"
        >
          <Send size={14} />
          测预警
        </button>
        <button
          onClick={() => { setTestMsg(null); testMut.mutate(0) }}
          disabled={testMut.isPending}
          className="flex-1 glass-card py-2 text-center text-sm text-white/50 hover:text-white/80 flex items-center justify-center gap-1.5 disabled:opacity-30"
        >
          <Send size={14} />
          测到点
        </button>
      </div>
      {saveMut.isSuccess && <div className="text-xs text-moss">已保存</div>}
      {testMsg && <div className="text-xs text-tan/80">{testMsg}</div>}
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

function fmtTs(ts?: number | null) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ── 通知发送历史（Phase 3）─────────────────────
function NotifyHistory() {
  const [page, setPage] = useState(1)
  // get() 会把 {data,total} 解包成数组导致 total 丢失 —— 分页列表用 getFull 保留信封
  const { data, isLoading } = useQuery({
    queryKey: ['notify-history', page],
    queryFn: () => getFull<any>(`/api/notify/history?page=${page}&pageSize=20`),
    refetchInterval: 30000,
  })
  const rows = Array.isArray(data) ? data : (data?.data || [])
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / 20))

  return (
    <section className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-white/50 flex items-center gap-2"><History size={14} /> 通知历史</h2>
        <span className="text-xs text-white/30">共 {total} 条</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="border-b border-white/5 text-white/35">
              <th className="text-left p-2">时间</th>
              <th className="text-left p-2">事件</th>
              <th className="text-left p-2">内容</th>
              <th className="text-left p-2">渠道</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => {
              const okN = (r.channels || []).filter((c: any) => c.ok).length
              const chN = (r.channels || []).length
              return (
                <tr key={r.id} className="border-b border-white/5 last:border-0">
                  <td className="p-2 text-white/40 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                  <td className="p-2 font-mono text-tan/70">{r.event}</td>
                  <td className="p-2 text-white/50 max-w-[240px] truncate" title={r.content || ''}>{r.content || '-'}</td>
                  <td className="p-2">
                    {chN ? (
                      <span className={okN ? 'text-moss' : 'text-red-400'}>{okN}/{chN} 成功</span>
                    ) : '-'}
                  </td>
                </tr>
              )
            })}
            {!isLoading && !rows.length && (
              <tr><td colSpan={4} className="p-4 text-center text-white/30">暂无通知记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-white/40">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-30">上一页</button>
          <span>{page}/{pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-30">下一页</button>
        </div>
      )}
    </section>
  )
}

// ── 充值提成档位规则（拉新归属结算）──────────
function TopupCommissionRules() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['topup-rules'],
    queryFn: () => get<any>('/api/topup-commission-rules'),
  })
  const rules: any[] = Array.isArray(data) ? data : ((data as any)?.data || [])
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [confirmState, setConfirmState] = useState<{ open: boolean; message: string; onConfirm: () => void }>({
    open: false, message: '', onConfirm: () => {},
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['topup-rules'] })
  const createMut = useMutation({
    mutationFn: (d: any) => post('/api/topup-commission-rules', d),
    onSuccess: () => { invalidate(); setShowForm(false); toast.success('规则已新增') },
    onError: (e: any) => toast.error(e?.message || '新增失败'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: any) => put(`/api/topup-commission-rules/${id}`, d),
    onSuccess: () => { invalidate(); setEditItem(null); toast.success('规则已保存') },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/topup-commission-rules/${id}`),
    onSuccess: () => { invalidate(); toast.success('规则已删除') },
    onError: (e: any) => toast.error(e?.message || '删除失败'),
  })

  const fmtRange = (r: any) =>
    `¥${r.min_cents / 100} ~ ${r.max_cents == null ? '∞' : `¥${r.max_cents / 100}`}`
  const fmtComm = (r: any) =>
    r.commission_type === 'percent' ? `${r.commission_value / 100}%` : formatMoney(r.commission_value)

  return (
    <section className="glass-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-white/50 flex items-center gap-1.5">
          <ScrollText size={14} /> 充值提成档位
        </h2>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 bg-tan text-white px-3 py-1 rounded-lg text-xs active:scale-[0.97]">
          <Plus size={12} /> 新增档位
        </button>
      </div>
      <p className="text-xs text-white/30">
        会员充值时按金额命中档位计提成，给客户归属人（无归属给当次操作人）；不预置规则 = 不计提成。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="border-b border-white/5 text-white/35">
              <th className="text-left p-2">名称</th>
              <th className="text-left p-2">金额区间</th>
              <th className="text-left p-2">提成</th>
              <th className="text-center p-2">状态</th>
              <th className="text-center p-2 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} className="border-b border-white/5 last:border-0">
                <td className="p-2 text-white/60">{r.name || '-'}</td>
                <td className="p-2 text-white/50 font-mono">{fmtRange(r)}</td>
                <td className="p-2 text-tan">{fmtComm(r)}</td>
                <td className="p-2 text-center">
                  <button onClick={() => updateMut.mutate({ id: r.id, active: r.active ? 0 : 1 })}
                    className={`px-2 py-0.5 rounded cursor-pointer ${r.active ? 'bg-moss/15 text-moss' : 'bg-white/5 text-white/30'}`}>
                    {r.active ? '启用' : '停用'}
                  </button>
                </td>
                <td className="p-2 text-center">
                  <button onClick={() => setEditItem(r)} className="p-1 text-white/30 hover:text-tan"><Edit2 size={13} /></button>
                  <button onClick={() => setConfirmState({
                    open: true,
                    message: `删除档位「${r.name || fmtRange(r)}」？`,
                    onConfirm: () => deleteMut.mutate(r.id),
                  })} className="p-1 text-white/30 hover:text-red-400"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            {!isLoading && !rules.length && (
              <tr><td colSpan={5} className="p-4 text-center text-white/30">暂无规则（不计提成）</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && <RuleForm title="新增档位"
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}
      {editItem && <RuleForm title="编辑档位" initial={editItem}
        onSubmit={(d) => updateMut.mutate({ id: editItem.id, ...d })} onClose={() => setEditItem(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}

      <ConfirmDialog
        open={confirmState.open}
        title="删除档位"
        message={confirmState.message}
        variant="danger"
        onConfirm={() => { confirmState.onConfirm(); setConfirmState(s => ({ ...s, open: false })) }}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />
    </section>
  )
}

function RuleForm({ title, initial, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const [f, setF] = useState({
    name: initial?.name || '',
    min_yuan: initial ? String(initial.min_cents / 100) : '0',
    max_yuan: initial?.max_cents != null ? String(initial.max_cents / 100) : '',
    commission_type: initial?.commission_type || 'percent',
    // percent: 输入 %（提交 *100 → 万分比）; fixed: 输入元（提交 *100 → 分）
    commission_value: initial ? String(initial.commission_value / 100) : '5',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      name: f.name || null,
      min_cents: Math.round(Number(f.min_yuan || 0) * 100) || 0,
      max_cents: f.max_yuan === '' ? null : Math.round(Number(f.max_yuan) * 100),
      commission_type: f.commission_type,
      commission_value: Math.round(Number(f.commission_value || 0) * 100),
      active: initial ? (initial.active ? 1 : 0) : 1,
      sort_order: initial?.sort_order ?? 0,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="名称(可选)" value={f.name} onChange={v => setF({ ...f, name: v })} placeholder="如 全额档 / 大额档" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="金额下限(元)" type="number" value={f.min_yuan} onChange={v => setF({ ...f, min_yuan: v })} />
            <Field label="金额上限(元,空=∞)" type="number" value={f.max_yuan} onChange={v => setF({ ...f, max_yuan: v })} />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">提成方式</label>
            <div className="flex gap-1.5">
              {([['percent', '按比例'], ['fixed', '固定额']] as const).map(([t, label]) => (
                <button key={t} type="button" onClick={() => setF({ ...f, commission_type: t })}
                  className={`flex-1 py-1.5 rounded-lg text-xs border ${f.commission_type === t ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>{label}</button>
              ))}
            </div>
          </div>
          <Field label={f.commission_type === 'percent' ? '提成(%)' : '提成(元)'} type="number"
            value={f.commission_value} onChange={v => setF({ ...f, commission_value: v })} />
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
            {loading ? '保存中...' : '保存'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 数据备份（批次1：list/create/download/暂存恢复）──
function BackupPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => get<any>('/api/backups'),
    refetchInterval: 60000,
  })
  const files: any[] = data?.files || []
  const pending = data?.pending_restore || null
  const [instructions, setInstructions] = useState<string[] | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)

  const backupMut = useMutation({
    mutationFn: () => post('/api/backups', {}),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ['backups'] })
      toast.success(d?.latest ? `备份完成：${d.latest}` : '备份完成')
    },
    onError: (e: any) => toast.error(e?.message || '备份失败'),
  })
  const restoreMut = useMutation({
    mutationFn: (name: string) => post(`/api/backups/${encodeURIComponent(name)}/restore`, { confirm: name }),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ['backups'] })
      setInstructions(d?.instructions || [])
      setRestoreTarget(null)
      toast.success('已暂存恢复文件，按步骤完成替换')
    },
    onError: (e: any) => { toast.error(e?.message || '恢复失败'); setRestoreTarget(null) },
  })

  const download = async (name: string) => {
    try {
      const token = localStorage.getItem('yuwen_token')
      const res = await fetch(`/api/backups/${encodeURIComponent(name)}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) { toast.error('下载失败'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('下载失败') }
  }

  const fmtSize = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
  const fmtTime = (t: any) => t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

  return (
    <section className="glass-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-white/50 flex items-center gap-1.5">
          <DatabaseBackup size={14} /> 数据备份
        </h2>
        <button onClick={() => backupMut.mutate()} disabled={backupMut.isPending}
          className="flex items-center gap-1 bg-tan text-white px-3 py-1 rounded-lg text-xs active:scale-[0.97] disabled:opacity-50">
          <Download size={12} /> {backupMut.isPending ? '备份中...' : '立即备份'}
        </button>
      </div>
      <p className="text-xs text-white/30">
        每小时自动备份（VACUUM INTO，保留 7 天至 db/backups/）。恢复不在线换库：校验后暂存替换文件，需按步骤停服替换重启。
      </p>

      {(pending || instructions) && (
        <div className="border border-amber-400/30 bg-amber-400/10 rounded-lg p-3 space-y-1.5">
          <div className="text-xs text-amber-300 font-medium">
            {pending ? `存在待完成的恢复暂存（${pending.name}${pending.source ? ` ← ${pending.source}` : ''}）` : '恢复已暂存，按以下步骤完成'}
          </div>
          <ol className="text-xs text-amber-200/80 space-y-1 list-decimal list-inside">
            {((pending?.instructions || instructions || []) as string[]).map((s: string, i: number) => (
              <li key={i} className="font-mono break-all">{s}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead className="sticky top-0 bg-[#141210]">
            <tr className="border-b border-white/5 text-white/35">
              <th className="text-left p-2">文件</th>
              <th className="text-right p-2">大小</th>
              <th className="text-right p-2">时间</th>
              <th className="text-center p-2 w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => (
              <tr key={f.name} className="border-b border-white/5 last:border-0">
                <td className="p-2 font-mono text-white/60">{f.name}</td>
                <td className="p-2 text-right text-white/50">{fmtSize(f.size)}</td>
                <td className="p-2 text-right text-white/40">{fmtTime(f.time)}</td>
                <td className="p-2 text-center whitespace-nowrap">
                  <button onClick={() => download(f.name)} className="p-1 text-white/30 hover:text-tan" title="下载">
                    <Download size={13} />
                  </button>
                  <button onClick={() => setRestoreTarget(f.name)} className="p-1 text-white/30 hover:text-amber-300" title="恢复到此版本">
                    <RotateCcw size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && !files.length && (
              <tr><td colSpan={4} className="p-4 text-center text-white/30">暂无备份</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!restoreTarget}
        title="暂存恢复"
        message={`将「${restoreTarget}」校验后暂存为替换文件？当前数据会自动安全备份；不会在线换库，需按步骤停服替换重启才能生效。`}
        variant="danger"
        loading={restoreMut.isPending}
        onConfirm={() => { if (restoreTarget) restoreMut.mutate(restoreTarget) }}
        onCancel={() => setRestoreTarget(null)}
      />
    </section>
  )
}

// ── 审计日志（Phase 3）─────────────────────────
function AuditLogs() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  // SearchInput 内置 300ms 防抖，停手后才打接口（后端是精确匹配）
  const handleSearch = (v: string) => {
    setAction(v.trim())
    setPage(1)
  }
  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, action],
    queryFn: () => getFull<any>(`/api/audit-logs?page=${page}&pageSize=20${action ? `&action=${encodeURIComponent(action)}` : ''}`),
    placeholderData: (prev: any) => prev,
  })
  const rows = Array.isArray(data) ? data : (data?.data || [])
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / 20))

  return (
    <section className="glass-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-white/50 flex items-center gap-2"><ScrollText size={14} /> 审计日志</h2>
        <div className="flex items-center gap-2">
          <SearchInput placeholder="过滤 action（完整匹配）…"
            label="按 action 过滤审计日志"
            onSearch={handleSearch} className="w-44" />
          <span className="text-xs text-white/40">共 {total} 条</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="border-b border-white/5 text-white/35">
              <th className="text-left p-2">时间</th>
              <th className="text-left p-2">操作</th>
              <th className="text-left p-2">类型</th>
              <th className="text-left p-2">对象</th>
              <th className="text-left p-2">详情</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b border-white/5 last:border-0">
                <td className="p-2 text-white/40 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                <td className="p-2 font-mono text-tan/70">{r.action}</td>
                <td className="p-2 text-white/50">{r.target_type}</td>
                <td className="p-2 font-mono text-white/35 max-w-[100px] truncate" title={r.target_id}>{r.target_id}</td>
                <td className="p-2 text-white/45 max-w-[200px] truncate" title={r.payload}>{r.payload || '-'}</td>
              </tr>
            ))}
            {!isLoading && !rows.length && (
              <tr><td colSpan={5} className="p-4 text-center text-white/30">暂无日志</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-white/40">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-30">上一页</button>
          <span>{page}/{pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-30">下一页</button>
        </div>
      )}
    </section>
  )
}