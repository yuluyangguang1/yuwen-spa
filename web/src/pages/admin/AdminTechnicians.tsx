import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put } from '@/lib/api'
import { statusLabel } from '@/lib/utils'
import { Edit2, X, Bell } from 'lucide-react'

export default function AdminTechnicians() {
  const qc = useQueryClient()
  const [editTech, setEditTech] = useState<any>(null)

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => get('/api/technicians'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => put(`/api/technicians/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['technicians'] }); setEditTech(null) },
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">技师管理</h1>
        <button className="bg-tan text-white px-4 py-2 rounded-lg text-sm active:scale-[0.97]">
          新增技师
        </button>
      </div>
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs">
              <th className="text-left p-3">工号</th>
              <th className="text-left p-3">姓名</th>
              <th className="text-left p-3">级别</th>
              <th className="text-center p-3">通知</th>
              <th className="text-center p-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((t: any) => (
              <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] cursor-pointer"
                onClick={() => setEditTech(t)}>
                <td className="p-3 font-bold text-white/60">{t.number}</td>
                <td className="p-3">{t.name}</td>
                <td className="p-3 text-white/50">{t.level || '-'}</td>
                <td className="p-3 text-center">
                  {t.webhook_url ? (
                    <Bell size={14} className="text-tan mx-auto" />
                  ) : (
                    <span className="text-white/20 text-xs">-</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    t.status === 'working' ? 'bg-tan/15 text-tan' :
                    t.status === 'idle' ? 'bg-moss/15 text-moss' :
                    'bg-white/5 text-white/30'
                  }`}>
                    {statusLabel(t.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 编辑弹窗 */}
      {editTech && (
        <EditTechModal
          tech={editTech}
          onSave={(data) => updateMut.mutate({ id: editTech.id, ...data })}
          onClose={() => setEditTech(null)}
          loading={updateMut.isPending}
          error={updateMut.error?.message}
        />
      )}
    </div>
  )
}

function EditTechModal({ tech, onSave, onClose, loading, error }: {
  tech: any; onSave: (data: any) => void; onClose: () => void; loading: boolean; error?: string
}) {
  const [webhookUrl, setWebhookUrl] = useState(tech.webhook_url || '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{tech.name}（{tech.number}号）</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>

        <div className="space-y-2 text-xs text-white/40">
          <div>级别：{tech.level || '-'}</div>
          <div>电话：{tech.phone || '-'}</div>
          <div>AI 评分：{tech.ai_score || '-'}</div>
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1 flex items-center gap-1">
            <Bell size={12} /> 个人 Webhook（企业微信）
          </label>
          <input
            type="text"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:border-tan/40 focus:outline-none"
          />
          <div className="text-[10px] text-white/25 mt-1">
            技师个人的「只有自己和机器人」的群 webhook，留空则只推群消息
          </div>
        </div>

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        <button
          onClick={() => onSave({ webhook_url: webhookUrl || null })}
          disabled={loading}
          className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm"
        >
          {loading ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}
