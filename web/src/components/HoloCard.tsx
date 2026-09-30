import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { HoloTarget } from '@/lib/holo'

export const HoloCard = memo(function HoloCard({ src, fallbackNumber, star, onClick, ariaLabel, children }: {
  src?: string | null
  fallbackNumber?: string | number
  star?: boolean
  onClick?: () => void
  ariaLabel?: string
  children?: ReactNode
}) {
  const hostRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HoloTarget>({ x: 0.025, y: -0.13 })
  const [failed, setFailed] = useState(false)
  const useWebGL = !!src && !failed

  useEffect(() => {
    if (!useWebGL || !stageRef.current || !hostRef.current) return
    let disposed = false
    let dispose: (() => void) | null = null
    import('@/lib/holo')
      .then(m => m.createHolo(stageRef.current!, hostRef.current!, src!, targetRef.current))
      .then(fn => {
        if (disposed) fn()
        else dispose = fn
      })
      .catch(err => {
        console.error('HoloCard init failed:', err)
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      dispose?.()
    }
  }, [useWebGL, src])

  return (
    <button
      ref={hostRef}
      type="button"
      className={`holo-card${star ? ' holo-card--star' : ''}${useWebGL ? '' : ' holo-static'}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {/* 照片底层：WebGL 就绪前即时显示（避免加载黑屏），纹理失败/初始化失败时作为兜底 */}
      {src && (
        <img src={src} alt="" width={600} height={800} className="holo-card-img" loading="lazy" decoding="async" />
      )}
      {useWebGL && (
        <div ref={stageRef} className="absolute inset-0 z-[1]" />
      )}
      {!src && (
        <div className="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br from-[#1d1a14] to-[#0a0a09]">
          <span className="text-7xl font-bold text-tan/30">{fallbackNumber}</span>
        </div>
      )}
      {star && (
        <>
          <span className="holo-card-star" aria-hidden>★ 明星技师</span>
          <span className="holo-card-frame" aria-hidden />
        </>
      )}
      {children}
    </button>
  )
})
