// 修改密码弹窗（各端通用）

import { useState } from 'react'
import { put } from '../lib/api'
import { X, Key } from 'lucide-react'
import { memo } from 'react'

interface ChangePasswordModalProps {
  onClose: () => void
}

export const ChangePasswordModal = memo(function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPwd !== confirm) { setError('两次输入的密码不一致'); return }
    if (newPwd.length < 4) { setError('新密码至少 4 位'); return }

    setLoading(true)
    try {
      await put('/api/auth/password', { oldPassword: oldPwd, newPassword: newPwd })
      setOk(true)
    } catch (err: any) {
      setError(err.message || '修改失败')
    } finally {
      setLoading(false)
    }
  }

  if (ok) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="glass-card w-full max-w-sm p-6 text-center space-y-3">
          <p className="text-tan text-sm">密码修改成功</p>
          <button onClick={onClose} className="bg-tan/20 text-tan border border-tan/30 px-6 py-2 rounded-lg text-sm">确定</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium flex items-center gap-2"><Key size={16} /> 修改密码</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1">旧密码</label>
            <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">新密码</label>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required placeholder="至少 4 位"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">确认新密码</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50" />
          </div>

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-tan/20 hover:bg-tan/30 disabled:opacity-30 text-tan border border-tan/30 rounded-lg py-2.5 text-sm">
            {loading ? '修改中...' : '确认修改'}
          </button>
        </form>
      </div>
    </div>
  )
})