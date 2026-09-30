// 极简 i18n：zh（默认）/ en 字典 + useT()
// 未命中的 key 回退原文（zh 即源串），便于渐进翻译

import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react'

export type Locale = 'zh' | 'en'

const dict: Record<Locale, Record<string, string>> = {
  zh: {},
  en: {
    '看板': 'Dashboard',
    '钟单': 'Tickets',
    '预约': 'Appointments',
    '排钟': 'Schedule',
    '排班': 'Roster',
    '项目': 'Services',
    '商品': 'Products',
    '库存': 'Inventory',
    '优惠券': 'Coupons',
    '技师': 'Technicians',
    '房间': 'Rooms',
    '会员': 'Members',
    '报表': 'Reports',
    'AI 助手': 'AI Assistant',
    '账号': 'Users',
    '设置': 'Settings',
    '登录': 'Sign in',
    '退出': 'Sign out',
    '保存': 'Save',
    '取消': 'Cancel',
    '确定': 'OK',
    '删除': 'Delete',
    '搜索': 'Search',
    '加载中...': 'Loading...',
    '已保存': 'Saved',
    '深色模式': 'Dark mode',
    '外观': 'Appearance',
    '启用 AI': 'Enable AI',
    '测试连接': 'Test connection',
  },
}

const LOCALE_KEY = 'yuwen-locale'

interface I18nState {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nState | null>(null)

function readLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY)
    if (v === 'en' || v === 'zh') return v
  } catch { /* ignore */ }
  return 'zh'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try { localStorage.setItem(LOCALE_KEY, l) } catch { /* ignore */ }
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN'
  }, [])

  const t = useCallback((key: string) => {
    if (locale === 'zh') return key
    return dict.en[key] ?? key
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  // 未包裹时的无操作回退，避免组件炸
  return { locale: 'zh', setLocale: () => {}, t: (k: string) => k }
}
