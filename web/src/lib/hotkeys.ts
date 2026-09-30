// 全局键盘快捷键
// - Ctrl/Cmd+N：新开钟（收银/管理）
// - Ctrl/Cmd+K：钟单列表
// - Ctrl/Cmd+Shift+D：收银台面
// - /：聚焦页面上第一个搜索框（非输入态）
// 输入框/文本域内不拦截

import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node) return false
  const tag = node.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable === true
  )
}

export function useGlobalHotkeys() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return

      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'n') {
          e.preventDefault()
          navigate('/pos/new')
          return
        }
        if (key === 'k') {
          e.preventDefault()
          navigate('/admin/tickets')
          return
        }
        if (key === 'd' && e.shiftKey) {
          e.preventDefault()
          navigate('/pos')
          return
        }
      }

      // 单键 /：聚焦搜索（仅 admin 区）
      if (e.key === '/' && !mod && !isTypingTarget(e.target)) {
        if (!location.pathname.startsWith('/admin')) return
        const input = document.querySelector<HTMLInputElement>(
          'main input[type="search"], main input[placeholder*="搜索"], main input[placeholder*="查找"], main input[placeholder*="过滤"]'
        )
        if (input) {
          e.preventDefault()
          input.focus()
          input.select?.()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, location.pathname])
}
