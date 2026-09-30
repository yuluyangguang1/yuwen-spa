// 深色模式：启动时从 localStorage 恢复，避免闪烁

export const DARK_KEY = 'yuwen-dark-mode'

const THEME_COLOR = { dark: '#170d02', light: '#f2eee6' } as const

function syncThemeColor(dark: boolean) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light)
}

export function applyStoredTheme() {
  let dark = true
  try {
    const saved = localStorage.getItem(DARK_KEY)
    dark = saved !== null
      ? saved === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    dark = true
  }
  document.documentElement.classList.toggle('dark', dark)
  syncThemeColor(dark)
}

applyStoredTheme()
