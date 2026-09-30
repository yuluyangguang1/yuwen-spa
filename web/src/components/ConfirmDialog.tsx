import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const messageId = useId()
  // 调用方几乎都传内联箭头；存 ref 避免父组件轮询重渲染时 effect 反复重跑抢焦点
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  const borderClass =
    variant === 'danger' ? 'border-cinnabar/40' :
    variant === 'warning' ? 'border-gold/40' :
    'border-white/15'

  const confirmClass =
    variant === 'danger' ? 'bg-cinnabar hover:bg-cinnabar/80 text-white' :
    variant === 'warning' ? 'bg-gold hover:bg-gold/80 text-white' :
    'bg-tan hover:bg-tan-dark text-white'

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
        onCancelRef.current()
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
  }, [open])

  if (!open) return null

  // portal 到 body：玻璃卡片带 contain:paint、遮罩带 backdrop-filter，
  // 都会把 fixed 后代的定位基准拉到祖先 —— 只有挂到 body 才保证全屏铺满
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className={`glass-card w-full max-w-sm p-5 space-y-4 border max-h-[85dvh] overflow-y-auto ${borderClass}`}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="font-medium flex items-center gap-2 text-white/90">
            {variant === 'danger' && <AlertTriangle size={16} className="text-cinnabar" />}
            {variant === 'warning' && <AlertTriangle size={16} className="text-gold" />}
            {title}
          </h2>
          <button onClick={onCancel} aria-label="关闭" className="text-white/50 hover:text-white p-1 -m-1 min-h-[44px] min-w-[44px] flex items-center justify-center"><X size={18} /></button>
        </div>
        <p id={messageId} className="text-sm text-white/70 leading-relaxed">{message}</p>
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm border border-white/15 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium disabled:opacity-30 active:scale-[0.97] ${confirmClass}`}
          >
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
