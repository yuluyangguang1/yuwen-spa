import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { Star, X, Award, Clock, ThumbsUp } from 'lucide-react'

// 技师个人简介弹窗（顾客端点击技师后展示）
export default function TechProfile({ techId, onClose, onSelect }: {
  techId: string
  onClose: () => void
  onSelect: () => void
}) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['tech-profile', techId],
    queryFn: () => get(`/api/technicians/${techId}/profile`),
  })

  if (isLoading || !profile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="text-white/40">加载中...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a1a18] rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 bg-[#1a1a18] p-4 flex items-center justify-between border-b border-white/5">
          <h2 className="font-medium">技师简介</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* 基本信息 */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-tan/30 to-tan/5 flex items-center justify-center">
              <span className="text-2xl font-bold text-tan">{profile.number}</span>
            </div>
            <div className="flex-1">
              <div className="text-lg font-medium">{profile.name}</div>
              <div className="text-xs text-white/40 flex items-center gap-2 mt-0.5">
                <span>{profile.level || '技师'}</span>
                {profile.years && <span>· 从业{profile.years}年</span>}
              </div>
              <div className="flex items-center gap-1 mt-1">
                <RatingStars rating={profile.avg_rating} />
                <span className="text-xs text-white/40 ml-1">{profile.avg_rating} ({profile.review_count}条评价)</span>
              </div>
            </div>
          </div>

          {/* AI 评分 */}
          {profile.aiScore && (
            <div className="glass-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-white/50">
                <Award size={14} className="text-tan" />
                <span>AI 综合评分</span>
                <span className="ml-auto text-lg font-bold text-tan">{profile.ai_score}</span>
                <span className="text-white/30">/5</span>
              </div>
              {profile.aiScore.dimensions && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <DimBar label="服务质量" value={profile.aiScore.dimensions.service} />
                  <DimBar label="稳定性" value={profile.aiScore.dimensions.stability} />
                  <DimBar label="好评率" value={profile.aiScore.dimensions.popularity} />
                  <DimBar label="活跃度" value={profile.aiScore.dimensions.volume} />
                </div>
              )}
              {profile.aiScore.summary && (
                <p className="text-xs text-white/40 mt-2 italic">{profile.aiScore.summary}</p>
              )}
            </div>
          )}

          {/* 个人简介 */}
          {profile.bio && (
            <div>
              <h3 className="text-xs text-white/40 mb-1">简介</h3>
              <p className="text-sm text-white/70 leading-relaxed">{profile.bio}</p>
            </div>
          )}

          {/* 擅长项目 */}
          {profile.specialties?.length > 0 && (
            <div>
              <h3 className="text-xs text-white/40 mb-2">擅长项目</h3>
              <div className="flex flex-wrap gap-1.5">
                {profile.specialties.map((s: string) => (
                  <span key={s} className="text-xs px-2.5 py-1 rounded-full bg-tan/10 text-tan/80">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* 评分分布 */}
          {profile.distribution?.length > 0 && (
            <div>
              <h3 className="text-xs text-white/40 mb-2">评分分布</h3>
              <div className="space-y-1">
                {[5, 4, 3, 2, 1].map(star => {
                  const item = profile.distribution.find((d: any) => d.rating === star)
                  const count = item?.count || 0
                  const pct = profile.review_count > 0 ? (count / profile.review_count) * 100 : 0
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-3 text-white/40">{star}</span>
                      <Star size={10} className="text-tan/60" />
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-tan/40 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-6 text-right text-white/30">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 最近评价 */}
          {profile.recentReviews?.length > 0 && (
            <div>
              <h3 className="text-xs text-white/40 mb-2">最近评价</h3>
              <div className="space-y-3">
                {profile.recentReviews.slice(0, 5).map((r: any) => (
                  <div key={r.id} className="glass-card p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <RatingStars rating={r.rating} size={12} />
                      <span className="text-[10px] text-white/20">
                        {new Date(r.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    {r.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((tag: string) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-moss/10 text-moss/70">{tag}</span>
                        ))}
                      </div>
                    )}
                    {r.comment && <p className="text-xs text-white/50">{r.comment}</p>}
                    <div className="text-[10px] text-white/20">
                      {r.anonymous ? '匿名顾客' : (r.customer_name || '顾客')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部选择按钮 */}
        <div className="sticky bottom-0 p-4 border-t border-white/5 bg-[#1a1a18]">
          <button
            onClick={onSelect}
            className="w-full bg-tan text-white py-3 rounded-xl text-sm font-medium active:scale-[0.97]"
          >
            选择 {profile.name}
          </button>
        </div>
      </div>
    </div>
  )
}

function RatingStars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={size}
          className={i <= Math.round(rating) ? 'text-tan fill-tan' : 'text-white/10'}
        />
      ))}
    </div>
  )
}

function DimBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-white/40">{label}</span>
        <span className="text-white/60">{value}</span>
      </div>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full bg-tan/50 rounded-full" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
    </div>
  )
}
