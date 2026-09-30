// 报表轻量图表：纯 SVG/DOM 手写，无第三方依赖
// TrendChart 趋势面积图 / BarList 横向条形图 / DonutChart 占比环形图

import { formatMoney } from '@/lib/utils'

export function TrendChart({ points, ariaLabel, height = 120 }: {
  points: { label: string; value: number }[]
  ariaLabel: string
  height?: number
}) {
  if (points.length < 2) return null
  const W = 600
  const H = 100
  const max = Math.max(...points.map(p => p.value), 1)
  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * W,
    y: H - 6 - (p.value / max) * (H - 18),
  }))
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const mid = points[Math.floor((points.length - 1) / 2)]
  const sum = points.reduce((s, p) => s + p.value, 0)
  return (
    <div role="img" aria-label={ariaLabel}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height }}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a0826d" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#a0826d" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <path
          d={line}
          fill="none"
          stroke="#c8a882"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {xy.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="6" fill="transparent">
            <title>{points[i].label} {formatMoney(points[i].value)}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-white/30 mt-1">
        <span>{points[0].label.slice(5)}</span>
        <span>{mid.label.slice(5)}</span>
        <span>{points[points.length - 1].label.slice(5)}</span>
      </div>
      <div className="flex gap-4 text-[10px] text-white/40 mt-0.5">
        <span>峰值 {formatMoney(max)}</span>
        <span>日均 {formatMoney(Math.round(sum / points.length))}</span>
      </div>
    </div>
  )
}

export function BarList({ items, ariaLabel }: {
  items: { label: string; value: number; display: string }[]
  ariaLabel: string
}) {
  if (!items.length) return null
  const max = Math.max(...items.map(i => i.value), 1)
  return (
    <div className="space-y-2" role="img" aria-label={ariaLabel}>
      {items.map(it => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-white/60" title={it.label}>{it.label}</span>
          <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-tan/40 to-tan/70 rounded"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-tan">{it.display}</span>
        </div>
      ))}
    </div>
  )
}

const DONUT_COLORS = ['#a0826d', '#5a7a5a', '#b8860b', '#8b3a3a', '#3b82f6', '#8a8a8a']

export function DonutChart({ items, ariaLabel }: {
  items: { label: string; value: number; display: string }[]
  ariaLabel: string
}) {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (!total || !items.length) return null
  const R = 44
  const C = 2 * Math.PI * R
  let acc = 0
  const segs = items.map((it, i) => {
    const frac = it.value / total
    const seg = {
      ...it,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      pct: Math.round(frac * 100),
      dash: `${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`,
      offset: -acc * C,
    }
    acc += frac
    return seg
  })
  return (
    <div className="flex items-center gap-6 flex-wrap" role="img" aria-label={ariaLabel}>
      <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="16" />
          {segs.map(s => (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={s.dash}
              strokeDashoffset={s.offset}
            >
              <title>{s.label} {s.display} · {s.pct}%</title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="space-y-1.5 text-xs min-w-[150px]">
        {segs.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-white/60">{s.label}</span>
            <span className="text-white/40 ml-auto">{s.display}</span>
            <span className="text-white/70 w-9 text-right">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
