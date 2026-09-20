import { X, AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  variant = 'info',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const borderClass =
    variant === 'danger' ? 'border-red-500/30' :
    variant === 'warning' ? 'border-yellow-500/30' :
    'border-white/10'

  const confirmClass =
    variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white' :
    variant === 'warning' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' :
    'bg-tan text-white'

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`glass-card w-full max-w-sm p-5 space-y-4 border ${borderClass}`}>
        <div className="flex items-center justify-between">
          <h2 className="font-medium flex items-center gap-2">
            {variant === 'danger' && <AlertTriangle size={16} className="text-red-400" />}
            {variant === 'warning' && <AlertTriangle size={16} className="text-yellow-400" />}
            {title}
          </h2>
          <button onClick={onCancel} className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <p className="text-sm text-white/70">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm border border-white/10 text-white/50 hover:text-white disabled:opacity-30"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-30 ${confirmClass}`}
          >
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}