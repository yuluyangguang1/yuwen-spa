// 统一空态：图标 + 标题 + 说明 + 可选行动按钮
// 替代各页面零散的「暂无xxx」文本，给出下一步操作引导

import type { ComponentType } from 'react'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }>
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon: Icon = Inbox, title, hint, action }: EmptyStateProps) {
  return (
    <div className="glass-card p-8 sm:p-10 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
        <Icon size={22} className="text-white/40" />
      </div>
      <div className="text-sm text-white/70">{title}</div>
      {hint && <div className="text-xs text-white/40 max-w-xs mx-auto leading-relaxed">{hint}</div>}
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-1.5 bg-tan text-white px-4 py-2 min-h-[40px] rounded-lg text-sm active:scale-[0.97]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
