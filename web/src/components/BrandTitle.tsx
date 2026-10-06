import { BrandLogo } from './BrandLogo'
import { useShopName } from '@/hooks/useShopName'

const PRESETS = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-lg',
  xl: 'text-2xl',
  hero: 'text-4xl',
} as const

const LOGO_SIZES = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  hero: 'hero',
} as const

interface BrandTitleProps {
  /** 端别后缀，如「收银」→ 显示「店名 · 收银」 */
  suffix?: string
  size?: keyof typeof PRESETS
  shimmer?: boolean
  /** 免登录页（登录页/顾客端）用 guest 接口取名 */
  publicPage?: boolean
  /** 竖排（居中品牌位），用于登录页/顾客端 */
  stack?: boolean
  /** 是否显示图标（默认显示） */
  showLogo?: boolean
  className?: string
}

/** 全端统一品牌区：门店标识 + 门店名称（名称来自系统设置，未配置时回退「足韵」） */
export function BrandTitle({
  suffix,
  size = 'md',
  shimmer = false,
  publicPage = false,
  stack = false,
  showLogo = true,
  className = '',
}: BrandTitleProps) {
  const name = useShopName(publicPage)
  return (
    <div
      className={`flex min-w-0 ${stack ? 'flex-col items-center gap-2' : 'items-center gap-2'} ${className}`}
    >
      {showLogo && <BrandLogo size={LOGO_SIZES[size]} />}
      <h1
        className={`font-display ${PRESETS[size]} text-tan ${stack ? '' : 'truncate'} ${shimmer ? 'brand-shimmer' : ''}`}
      >
        {suffix ? `${name} · ${suffix}` : name}
      </h1>
    </div>
  )
}
