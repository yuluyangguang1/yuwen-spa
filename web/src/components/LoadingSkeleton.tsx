// 全局加载骨架屏组件
//
// 在数据首次加载时展示骨架屏，减少白屏感。
// 使用 CSS animate-pulse 实现呼吸效果。

import { clsx } from 'clsx'

interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
  rounded?: boolean
}

export function Skeleton({ className, width, height, rounded = true }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'animate-pulse bg-[#2a2a29] opacity-60',
        rounded ? 'rounded-md' : '',
        className
      )}
      style={{ width, height }}
    />
  )
}

// 房间卡片骨架
export function RoomCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#2a2a29] bg-[#1a1a19] p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

// 表格骨架
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

// 统计卡片骨架
export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[#2a2a29] bg-[#1a1a19] p-4 space-y-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-7 w-3/4" />
        </div>
      ))}
    </div>
  )
}
