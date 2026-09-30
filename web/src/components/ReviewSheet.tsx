// 顾客扫码评价弹层：星级 + 标签 + 留言 + 匿名
// 免登录 POST /api/guest/reviews

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '@/lib/api'
import { Star, X } from 'lucide-react'

const TAGS = ['手法专业', '力度合适', '态度热情', '环境舒适', '会再来']

export function ReviewSheet({
  ticket,
  onClose,
}: {
  ticket: {
    id: string
    room_id?: string | null
    technician_id?: string | null
    technician_name?: string | null
    technician_number?: string | null
    service_name?: string | null
  }
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [rating, setRating] = useState(5)
  const [hover, setHover] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [anonymous, setAnonymous] = useState(true)
  const [done, setDone] = useState(false)

  const submit = useMutation({
    mutationFn: () =>
      post('/api/guest/reviews', {
        ticket_id: ticket.id,
        room_id: ticket.room_id || undefined,
        technician_id: ticket.technician_id || undefined,
        rating,
        tags: tags.length ? tags : undefined,
        comment: comment.trim() || undefined,
        anonymous,
      }),
    onSuccess: () => {
      setDone(true)
      qc.invalidateQueries({ queryKey: ['guest-tickets'] })
      qc.invalidateQueries({ queryKey: ['guest-technicians'] })
    },
  })

  const toggleTag = (t: string) =>
    setTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-md glass-card p-5 space-y-4 rounded-t-2xl sm:rounded-2xl border border-white/10 max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">评价本次服务</div>
            <div className="text-xs text-white/40 mt-0.5">
              {ticket.technician_number ? `${ticket.technician_number}号 ` : ''}
              {ticket.technician_name || '技师'}
              {ticket.service_name ? ` · ${ticket.service_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭"
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white/70">
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="py-8 text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-full bg-tan/15 flex items-center justify-center">
              <Star size={28} className="text-tan fill-tan" />
            </div>
            <div className="text-tan">感谢您的评价</div>
            <div className="text-xs text-white/40">您的反馈会帮助我们做得更好</div>
            <button onClick={onClose}
              className="mt-4 px-6 py-2 bg-tan text-white rounded-lg text-sm">完成</button>
          </div>
        ) : (
          <>
            {/* 星级 */}
            <div className="flex items-center justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button"
                  aria-label={`${n}星`}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(n)}
                  className="p-1 active:scale-90 transition-transform">
                  <Star size={36}
                    className={(hover || rating) >= n ? 'text-tan fill-tan' : 'text-white/20'} />
                </button>
              ))}
            </div>
            <div className="text-center text-xs text-white/40">
              {['很不满意', '不满意', '一般', '满意', '非常满意'][(hover || rating) - 1]}
            </div>

            {/* 标签 */}
            <div className="flex flex-wrap gap-2 justify-center">
              {TAGS.map(t => (
                <button key={t} type="button" onClick={() => toggleTag(t)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    tags.includes(t)
                      ? 'bg-tan/15 border-tan/40 text-tan'
                      : 'bg-white/5 border-white/10 text-white/50'
                  }`}>{t}</button>
              ))}
            </div>

            {/* 留言 */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="说点什么（选填）"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-tan/40 resize-none"
            />

            <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
              <input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)}
                className="accent-tan w-3.5 h-3.5" />
              匿名评价（不显示姓名）
            </label>

            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
              className="w-full bg-tan text-white py-3 rounded-xl text-sm font-medium active:scale-[0.97] disabled:opacity-50"
            >
              {submit.isPending ? '提交中...' : '提交评价'}
            </button>
            {submit.isError && (
              <div className="text-xs text-red-400 text-center">{submit.error?.message || '提交失败'}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
