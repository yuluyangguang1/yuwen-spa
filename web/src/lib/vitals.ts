// 轻量 Web Vitals：PerformanceObserver 采集 LCP/CLS/INP/TTI 近似
// 无第三方依赖；默认仅 console，可通过 yuwen:vitals 监听或 POST 上报

export interface VitalMetric {
  name: string
  value: number
  rating?: 'good' | 'needsImprovement' | 'poor'
  ts: number
}

const thresholds: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
}

function rate(name: string, value: number): VitalMetric['rating'] {
  const t = thresholds[name]
  if (!t) return undefined
  if (value <= t[0]) return 'good'
  if (value <= t[1]) return 'needsImprovement'
  return 'poor'
}

function emit(name: string, value: number) {
  const metric: VitalMetric = {
    name,
    value: name === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value),
    rating: rate(name, value),
    ts: Date.now(),
  }
  window.dispatchEvent(new CustomEvent('yuwen:vitals', { detail: metric }))
  if (import.meta.env?.DEV) {
    console.info(`[vitals] ${metric.name}=${metric.value} (${metric.rating || '-'})`)
  }
}

export function initWebVitals() {
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as any
        if (entry.entryType === 'largest-contentful-paint') emit('LCP', e.startTime)
        else if (entry.entryType === 'layout-shift' && !e.hadRecentInput) emit('CLS', e.value)
        else if (entry.entryType === 'event' && e.name === 'INP') emit('INP', e.duration)
        else if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') emit('FCP', entry.startTime)
      }
    })
    po.observe({ type: 'largest-contentful-paint', buffered: true } as any)
    po.observe({ type: 'layout-shift', buffered: true } as any)
    po.observe({ type: 'event', buffered: true, durationThreshold: 40 } as any)
    po.observe({ type: 'paint', buffered: true } as any)
  } catch { /* 浏览器不支持则静默 */ }

  // TTFB
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav) emit('TTFB', nav.responseStart)
  } catch { /* ignore */ }
}
