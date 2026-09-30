// 统一搜索输入框：内置防抖 + 自绘清除按钮 + / 快捷键友好
//
// 用法：<SearchInput label="搜索会员" placeholder="搜手机号/姓名" onSearch={setQ} />
// onSearch 在输入停顿 debounceMs 后触发（清除按钮立即触发），
// 父组件拿 onSearch 的值直接做查询即可（天然防抖）。

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  placeholder?: string
  /** aria-label / 无障碍名称，默认取 placeholder */
  label?: string
  onSearch: (value: string) => void
  debounceMs?: number
  className?: string
  autoFocus?: boolean
}

export function SearchInput({
  placeholder = '搜索…',
  label,
  onSearch,
  debounceMs = 300,
  className = '',
  autoFocus,
}: SearchInputProps) {
  const [value, setValue] = useState('')
  const timerRef = useRef<number | undefined>(undefined)
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const emit = (v: string, delay: number) => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => onSearchRef.current(v), delay)
  }

  const handleChange = (v: string) => {
    setValue(v)
    emit(v, debounceMs)
  }

  const handleClear = () => {
    setValue('')
    window.clearTimeout(timerRef.current)
    onSearchRef.current('')
  }

  return (
    <div className={`relative ${className}`}>
      <Search
        size={14}
        aria-hidden="true"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-8 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-tan/50"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="清除搜索"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-white/40 hover:text-white rounded flex items-center justify-center min-h-[28px] min-w-[28px]"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
