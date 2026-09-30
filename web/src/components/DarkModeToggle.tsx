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
    try {
      const saved = localStorage.getItem('yuwen-dark-mode')
      if (saved !== null) return saved === 'true'
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return true // localStorage 不可用（隐私模式等）：回退深色
    }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', isDark ? '#170d02' : '#f2eee6')
    try {
      localStorage.setItem('yuwen-dark-mode', String(isDark))
    } catch {
      /* 存储不可用时仅本次会话生效 */
    }
  }, [isDark])

  // 监听系统偏好变化（仅在用户未手动设置时）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      let stored: string | null = null
      try {
        stored = localStorage.getItem('yuwen-dark-mode')
      } catch {
        /* ignore */
      }
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
      className={`dark-mode-toggle w-11 h-11 relative ${className}`}
    >
      <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${isDark ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true">
        <Sun size={18} strokeWidth={1.5} />
      </span>
      <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${isDark ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
        <Moon size={18} strokeWidth={1.5} />
      </span>
    </button>
  )
}
