// 深色模式切换组件
//
// 通过 Tailwind 的 .dark 类切换实现深色/浅色模式。
// 偏好存储在 localStorage 中，刷新后恢复。
// 支持 aria-checked 切换状态和系统偏好回退。

import { useEffect, useState, useCallback } from 'react'
import { Sun, Moon } from 'lucide-react'

interface DarkModeToggleProps {
  className?: string
}

export function DarkModeToggle({ className = '' }: DarkModeToggleProps) {
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

  // 监听系统偏好变化（仅在用户未手动设置时）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem('yuwen-dark-mode')
      if (stored === null) {
        setIsDark(e.matches)
      }
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const toggle = useCallback(() => {
    setIsDark((prev) => !prev)
  }, [])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      title={isDark ? '浅色模式' : '深色模式'}
      onClick={toggle}
      className={`dark-mode-toggle ${className}`}
    >
      <span className={`transition-opacity duration-300 ${isDark ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true">
        <Sun size={18} />
      </span>
      <span className={`transition-opacity duration-300 ${isDark ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
        <Moon size={18} />
      </span>
    </button>
  )
}
