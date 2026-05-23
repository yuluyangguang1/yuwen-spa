// 账号管理页面（仅 admin）
//
// 功能：创建账号、修改角色/显示名、重置密码、禁用/启用

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/lib/api'
import { Plus, Key, Ban, CheckCircle, Edit2, X } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  pos: '收银',
  tech: '技师',
}

export default function AdminUsers() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<any>(null)
  const [resetPwdUser, setResetPwdUser] = useState<any>(null)

  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: () => get<{ users: any[] }>('/api/users'),
  })
  const users = data?.users || []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  // 创建用户
  const createMut = useMutation({
    mutationFn: (data: any) => post('/api/users', data),
    onSuccess: () => { invalidate(); setShowForm(false) },
  })

  // 修改用户
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/users/${id}`, data),
    onSuccess: () => { invalidate(); setEditUser(null) },
  })

  // 重置密码
  const resetPwdMut = useMutation({
    mutationFn: ({ id, newPassword }: any) => put(`/api/users/${id}/password`, { newPassword }),
    onSuccess: () => setResetPwdUser(null),
  })

  // 禁用/启用
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: any) => put(`/api/users/${id}`, { active }),
    onSuccess: invalidate,
  })

  // 删除
  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/users/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">账号管理</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]"
        >
          <Plus size={14} />
          新建账号
        </button>
      </div>

      {/* 用户列表 */}
      {users.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/30 text-sm">暂无账号</div>
      ) : (
        <div className="space-y-2">
          {users.map((u: any) => (
            <div key={u.id} className="glass-card p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.display_name || u.username}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    u.role === 'admin' ? 'bg-tan/20 text-tan' :
                    u.role === 'pos' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                  {!u.active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">已禁用</span>
                  )}
                </div>
                <div className="text-xs text-white/30 mt-0.5">
                  @{u.username}{u.tech_name ? ` · 关联技师: ${u.tech_name}` : ''}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditUser(u)}
                  className="p-2 text-white/30 hover:text-tan rounded transition-colors"
                  title="编辑"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => setResetPwdUser(u)}
                  className="p-2 text-white/30 hover:text-yellow-400 rounded transition-colors"
                  title="重置密码"
                >
                  <Key size={14} />
                </button>
                {u.active ? (
                  <button
                    onClick={() => {
                      if (confirm(`确定禁用 ${u.display_name || u.username}？`))
                        toggleMut.mutate({ id: u.id, active: 0 })
                    }}
                    className="p-2 text-white/30 hover:text-red-400 rounded transition-colors"
                    title="禁用"
                  >
                    <Ban size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => toggleMut.mutate({ id: u.id, active: 1 })}
                    className="p-2 text-white/30 hover:text-green-400 rounded transition-colors"
                    title="启用"
                  >
                    <CheckCircle size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建账号弹窗 */}
      {showForm && (
        <UserForm
          title="新建账号"
          onSubmit={(data) => createMut.mutate(data)}
          onClose={() => setShowForm(false)}
          error={createMut.error?.message}
          loading={createMut.isPending}
        />
      )}

      {/* 编辑弹窗 */}
      {editUser && (
        <UserForm
          title="编辑账号"
          initial={editUser}
          onSubmit={(data) => updateMut.mutate({ id: editUser.id, ...data })}
          onClose={() => setEditUser(null)}
          error={updateMut.error?.message}
          loading={updateMut.isPending}
        />
      )}

      {/* 重置密码弹窗 */}
      {resetPwdUser && (
        <ResetPwdForm
          username={resetPwdUser.display_name || resetPwdUser.username}
          onSubmit={(newPassword) => resetPwdMut.mutate({ id: resetPwdUser.id, newPassword })}
          onClose={() => setResetPwdUser(null)}
          error={resetPwdMut.error?.message}
          loading={resetPwdMut.isPending}
        />
      )}
    </div>
  )
}

// ── 创建/编辑表单 ────────────────────────────────
function UserForm({ title, initial, onSubmit, onClose, error, loading }: {
  title: string
  initial?: any
  onSubmit: (data: any) => void
  onClose: () => void
  error?: string
  loading?: boolean
}) {
  const [form, setForm] = useState({
    username: initial?.username || '',
    password: '',
    role: initial?.role || 'pos',
    display_name: initial?.display_name || '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: any = { ...form }
    if (initial && !data.password) delete data.password  // 编辑时不改密码
    onSubmit(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!initial && (
            <Field label="用户名" value={form.username} onChange={v => setForm({ ...form, username: v })} placeholder="登录用户名" required />
          )}
          <Field label={initial ? '新密码（留空不改）' : '密码'} type="password" value={form.password} onChange={v => setForm({ ...form, password: v })} placeholder="至少 4 位" required={!initial} />
          <Field label="显示名称" value={form.display_name} onChange={v => setForm({ ...form, display_name: v })} placeholder="如：小张" />

          <div>
            <label className="block text-xs text-white/40 mb-1">角色</label>
            <div className="flex gap-2">
              {['admin', 'pos', 'tech'].map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm({ ...form, role: r })}
                  className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                    form.role === r
                      ? 'border-tan/50 bg-tan/10 text-tan'
                      : 'border-white/10 text-white/40 hover:border-white/20'
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm"
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 重置密码弹窗 ────────────────────────────────
function ResetPwdForm({ username, onSubmit, onClose, error, loading }: {
  username: string
  onSubmit: (password: string) => void
  onClose: () => void
  error?: string
  loading?: boolean
}) {
  const [pwd, setPwd] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">重置密码</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <p className="text-sm text-white/50">为 <span className="text-tan">{username}</span> 设置新密码</p>

        <form onSubmit={e => { e.preventDefault(); if (pwd.length >= 4) onSubmit(pwd) }} className="space-y-3">
          <Field label="新密码" type="password" value={pwd} onChange={setPwd} placeholder="至少 4 位" required />
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || pwd.length < 4}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm"
          >
            {loading ? '重置中...' : '确认重置'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 通用表单字段 ──────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-white/40 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50"
      />
    </div>
  )
}
