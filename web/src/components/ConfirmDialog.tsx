import { useEffect, useId, useRef } from 'react'
import { IconX as X, IconAlertTriangle as AlertTriangle } from '@tabler/icons-react'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const messageId = useId()

  const borderClass =
    variant === 'danger' ? 'border-cinnabar/30' :
    variant === 'warning' ? 'border-gold/30' :
    'border-white/10'

  const confirmClass =
    variant === 'danger' ? 'bg-cinnabar hover:bg-cinnabar/80 text-white' :
    variant === 'warning' ? 'bg-gold hover:bg-gold/80 text-white' :
    'bg-tan text-white'

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : []
    focusable[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className={`w-full max-w-sm p-5 space-y-4 border ${borderClass}`}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="font-medium flex items-center gap-2">
            {variant === 'danger' && <AlertTriangle size={16} className="text-cinnabar" />}
            {variant === 'warning' && <AlertTriangle size={16} className="text-gold" />}
            {title}
          </h2>
          <button onClick={onCancel} aria-label="关闭" className="text-white/30 hover:text-white"><X size={18} /></button>
        </div>
        <p id={messageId} className="text-sm text-white/70">{message}</p>
        <div className="flex gap-2 justify-end" aria-live="polite">
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