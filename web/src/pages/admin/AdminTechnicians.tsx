import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSimpleCRUD } from '@/hooks/useCRUD'
import { get, post, put } from '@/lib/api'
import { Plus, X, Bell, Star, ImagePlus, Users } from 'lucide-react'
import { Field } from '@/components/Field'
import { TechCard } from '@/components/TechCard'
import { AvatarEditor } from '@/components/AvatarEditor'
import { EmptyState } from '@/components/EmptyState'
import { TableSkeleton } from '@/components/LoadingSkeleton'

export default function AdminTechnicians() {
  const {
    data: technicians = [],
    isLoading,
    showForm,
    editItem: editTech,
    setShowForm,
    setEditItem: setEditTech,
    createMut,
    updateMut,
  } = useSimpleCRUD({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians?pageSize=500'),
    createFn: (data: any) => post('/api/technicians', data),
    updateFn: (id: string, data: any) => put(`/api/technicians/${id}`, data),
  })

  const shop_id = technicians[0]?.shop_id

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">技师管理</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          <Plus size={14} /> 新增技师
        </button>
      </div>

      {isLoading && !technicians.length ? (
        <div className="glass-card p-4"><TableSkeleton rows={5} /></div>
      ) : technicians.length === 0 ? (
        <EmptyState icon={Users} title="暂无技师"
          hint="录入工号、头像与提成规则后，技师即可关联账号登录"
          action={{ label: '新增技师', onClick: () => setShowForm(true) }} />
      ) : (
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">工号</th>
              <th className="text-left p-3">姓名</th>
              <th className="text-left p-3">级别</th>
              <th className="text-left p-3">电话</th>
              <th className="text-center p-3">通知</th>
              <th className="text-center p-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((t: any) => (
              <TechCard key={t.id} tech={t} onClick={(tech) => setEditTech(tech)} />
            ))}
          </tbody>
        </table>
      </div>
      )}

      {showForm && <TechForm title="新增技师" shop_id={shop_id}
        onSubmit={(d) => createMut.mutate(d)} onClose={() => setShowForm(false)}
        error={createMut.error?.message} loading={createMut.isPending} />}

      {editTech && <TechForm title="编辑技师" initial={editTech}
        onSubmit={(d) => updateMut.mutate({ id: editTech.id, ...d })} onClose={() => setEditTech(null)}
        error={updateMut.error?.message} loading={updateMut.isPending} />}
    </div>
  )
}

function TechForm({ title, initial, shop_id, onSubmit, onClose, error, loading }: {
  title: string; initial?: any; shop_id?: string; onSubmit: (d: any) => void; onClose: () => void; error?: string; loading?: boolean
}) {
  const queryClient = useQueryClient()
  const [f, setF] = useState({
    number: initial?.number || '',
    name: initial?.name || '',
    level: initial?.level || '初级',
    phone: initial?.phone || '',
    bio: initial?.bio || '',
    years: initial?.years?.toString() || '',
    webhook_url: initial?.webhook_url || '',
    is_star: !!initial?.is_star,
  })
  const [avatar, setAvatar] = useState(initial?.avatar || '')
  const [editorOpen, setEditorOpen] = useState(false)
  const [avatarErr, setAvatarErr] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['technicians'] })
    queryClient.invalidateQueries({ queryKey: ['guest-technicians'] })
  }

  async function handleAvatarApply(dataUrl: string) {
    if (!initial?.id) return
    setAvatarBusy(true)
    setAvatarErr('')
    try {
      const r = await post<{ avatar: string }>(`/api/technicians/${initial.id}/avatar`, { image: dataUrl })
      setAvatar(r.avatar)
      setEditorOpen(false)
      invalidate()
    } catch (e: any) {
      setAvatarErr(e?.message || '上传失败')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function removeAvatar() {
    if (!initial?.id) return
    setAvatarBusy(true)
    setAvatarErr('')
    try {
      await put(`/api/technicians/${initial.id}`, { avatar: null })
      setAvatar('')
      invalidate()
    } catch (e: any) {
      setAvatarErr(e?.message || '移除失败')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      shop_id: shop_id || initial?.shop_id,
      number: f.number,
      name: f.name,
      level: f.level,
      phone: f.phone || null,
      bio: f.bio || null,
      years: f.years ? Number(f.years) : null,
      webhook_url: f.webhook_url || null,
      is_star: f.is_star,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>

        {initial?.id && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
            <div className="w-14 h-[75px] shrink-0 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center border border-white/10">
              {avatar
                ? <img src={avatar} alt="技师照片" width={600} height={800} decoding="async" className="w-full h-full object-cover" />
                : <ImagePlus size={18} className="text-white/25" />}
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="text-xs text-white/40">卡片照片（3:4 竖版，顾客扫码可见）</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditorOpen(true)} disabled={avatarBusy}
                  className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">
                  {avatar ? '重新裁剪' : '上传照片'}
                </button>
                {avatar && (
                  <button type="button" onClick={removeAvatar} disabled={avatarBusy}
                    className="text-xs py-1.5 px-3 text-white/35 hover:text-red-400 disabled:opacity-40">
                    移除
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {avatarErr && <p className="text-red-400 text-xs -mt-2">{avatarErr}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="工号" value={f.number} onChange={v => setF({ ...f, number: v })} required />
            <Field label="姓名" value={f.name} onChange={v => setF({ ...f, name: v })} required />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">级别</label>
            <div className="flex gap-1.5 flex-wrap">
              {['初级', '中级', '高级', '技师长'].map(l => (
                <button key={l} type="button" onClick={() => setF({ ...f, level: l })}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${f.level === l ? 'border-tan/50 bg-tan/10 text-tan' : 'border-white/10 text-white/40'}`}>{l}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={f.is_star}
              onChange={e => setF({ ...f, is_star: e.target.checked })}
              className="accent-[#edff45] w-4 h-4"
            />
            <Star size={12} className="text-tan" />
            明星技师（顾客端展示专属金框卡）
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="电话" value={f.phone} onChange={v => setF({ ...f, phone: v })} />
            <Field label="从业年限" type="number" value={f.years} onChange={v => setF({ ...f, years: v })} />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">个人简介</label>
            <textarea value={f.bio} onChange={e => setF({ ...f, bio: e.target.value })} rows={2}
              placeholder="从业经历、擅长手法…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-tan/50 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 flex items-center gap-1">
              <Bell size={12} /> 个人 Webhook（企业微信）
            </label>
            <input value={f.webhook_url} onChange={e => setF({ ...f, webhook_url: e.target.value })}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-tan/50" />
          </div>
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
            {loading ? '保存中...' : '保存'}
          </button>
        </form>
      </div>

      {editorOpen && initial?.id && (
        <AvatarEditor current={avatar} onApply={handleAvatarApply} onClose={() => setEditorOpen(false)} />
      )}
    </div>
  )
}