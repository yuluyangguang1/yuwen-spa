// 品牌标识组件
//
// 门店可在「系统设置 → 门店信息」上传自定义标识，上传后：
//   · 各端左上角品牌区显示该标识
//   · 浏览器标签页图标（favicon）与 PWA 图标同步替换
//   · 标签页标题显示门店名
//
// 未上传时回退到内置「羽AI」字标（深浅色各一版 PNG，跟随主题切换）。

import { useEffect } from 'react'
import { useShopBrand } from '@/hooks/useShopName'

const PRESETS = {
  sm: 'w-7 h-7',
  md: 'w-9 h-9',
  lg: 'w-11 h-11',
  xl: 'w-16 h-16',
  hero: 'w-24 h-24',
} as const

interface BrandLogoProps {
  size?: keyof typeof PRESETS
  className?: string
}

/** 品牌图标：优先门店自定义标识，否则内置羽AI字标 */
export function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  const { logo, name } = useShopBrand()
  const dim = PRESETS[size]

  if (logo) {
    return (
      <img
        src={logo}
        alt={name}
        className={`${dim} object-contain shrink-0 ${className}`}
      />
    )
  }

  // 内置羽AI字标：深色底用浅色版，浅色底用深色版
  return (
    <span className={`${dim} shrink-0 inline-flex items-center justify-center ${className}`}>
      <img src="/yu-logo.png" alt={name} className="w-full h-full object-contain dark:hidden" />
      <img src="/yu-logo-light.png" alt={name} className="w-full h-full object-contain hidden dark:block" />
    </span>
  )
}

/** 同步浏览器标签页标题 + 图标（跟随门店改名/换标识） */
export function useBrowserBranding() {
  const { logo, name, shortName } = useShopBrand()

  useEffect(() => {
    document.title = name
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', `${name} — 线下足浴本地部署 SaaS 系统`)

    // favicon：有自定义标识用自定义，否则内置羽AI图标
    const isCustom = !!logo
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]:not([sizes="any"])')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/png'
      document.head.appendChild(link)
    }
    if (isCustom) {
      link.type = /\.png(\?|$)/.test(logo) ? 'image/png' : 'image/jpeg'
      link.href = logo
    } else {
      link.type = 'image/png'
      link.href = '/favicon-32.png'
    }

    // apple-touch-icon 同步（iOS 添加到主屏）
    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    if (!apple) {
      apple = document.createElement('link')
      apple.rel = 'apple-touch-icon'
      document.head.appendChild(apple)
    }
    apple.href = isCustom ? logo : '/apple-touch-icon.png'
  }, [logo, name])

  return { logo, name, shortName }
}
