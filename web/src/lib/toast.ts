// 全局 Toast：堆栈 + 自动 dismiss + 多类型 + 同文案去重
// 页面任意处 `toast.success('已保存')` 即可；ToastHost 挂在 main.tsx

import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  duration: number
}

interface ToastState {
  items: ToastItem[]
  push: (message: string, type: ToastType, duration?: number) => void
  dismiss: (id: number) => void
}

let seq = 0
const timers = new Map<number, number>()

function clearTimer(id: number) {
  const t = timers.get(id)
  if (t !== undefined) {
    window.clearTimeout(t)
    timers.delete(id)
  }
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, type = 'info', duration) => {
    const ms = duration ?? (type === 'error' ? 6000 : 4000)
    // 去重：同文案同类型的可见 toast 直接刷新计时，不叠新条
    const existing = useToastStore.getState().items.find(
      (t) => t.message === message && t.type === type
    )
    if (existing) {
      clearTimer(existing.id)
      timers.set(
        existing.id,
        window.setTimeout(() => {
          clearTimer(existing.id)
          set((s) => ({ items: s.items.filter((t) => t.id !== existing.id) }))
        }, ms)
      )
      return
    }
    const id = ++seq
    set((s) => ({
      // 最多同时 4 条，挤掉最旧
      items: [...s.items, { id, message, type, duration: ms }].slice(-4),
    }))
    timers.set(
      id,
      window.setTimeout(() => {
        clearTimer(id)
        set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
      }, ms)
    )
  },
  dismiss: (id) => {
    clearTimer(id)
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
  },
}))

export const toast = {
  info: (message: string, duration?: number) =>
    useToastStore.getState().push(message, 'info', duration),
  success: (message: string, duration?: number) =>
    useToastStore.getState().push(message, 'success', duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().push(message, 'error', duration),
}
