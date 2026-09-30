// 全局 Toast 堆栈视图（挂在 main.tsx）

import { useToastStore, type ToastType } from '@/lib/toast'

const typeClass: Record<ToastType, string> = {
  info: 'border-tan/40 text-tan',
  success: 'border-moss/40 text-moss',
  error: 'border-cinnabar/40 text-cinnabar',
}

export function ToastHost() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!items.length) return null

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[min(92vw,420px)] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto text-left rounded-xl border bg-[#1a1a18]/95 backdrop-blur px-4 py-3 shadow-lg text-sm ${typeClass[t.type]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
