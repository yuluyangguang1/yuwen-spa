// 深色模式切换组件
//
// 通过 Tailwind 的 .dark 类切换实现深色/浅色模式。
// 偏好存储在 localStorage 中，刷新后恢复。

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function DarkModeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('yuwen-dark-mode')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('yuwen-dark-mode', String(isDark))
  }, [isDark])

  return (
    <button
      onClick={() => setIsDark((d) => !d)}
      className="dark-mode-toggle"
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      title={isDark ? '浅色模式' : '深色模式'}
    >
      {isDark ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}
