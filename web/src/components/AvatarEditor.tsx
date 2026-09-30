import { useEffect, useRef, useState } from 'react'
import { X, ImagePlus, RotateCw } from 'lucide-react'

const OUT_W = 600
const OUT_H = 800
const BOX_W = 240
const BOX_H = 320

export function AvatarEditor({ current, onApply, onClose }: {
  current?: string | null
  onApply: (dataUrl: string) => Promise<void>
  onClose: () => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [rot, setRot] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const blobRef = useRef('')

  useEffect(() => () => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
  }, [])

  const cover = img ? Math.max(BOX_W / img.naturalWidth, BOX_H / img.naturalHeight) : 1

  const dispW = img ? img.naturalWidth * scale : 0
  const dispH = img ? img.naturalHeight * scale : 0
  const maxX = Math.max(0, (dispW - BOX_W) / 2)
  const maxY = Math.max(0, (dispH - BOX_H) / 2)
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('请选择图片文件'); return }
    if (file.size > 15 * 1024 * 1024) { setErr('图片不能超过 15MB'); return }
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
    const url = URL.createObjectURL(file)
    blobRef.current = url
    const im = new Image()
    im.onload = () => {
      setImg(im)
      setRot(0)
      const s = Math.max(BOX_W / im.naturalWidth, BOX_H / im.naturalHeight)
      setScale(s)
      setPos({ x: 0, y: 0 })
      setErr('')
    }
    im.onerror = () => { setErr('图片加载失败') }
    im.src = url
  }

  function loadCurrent() {
    if (!current) return
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => {
      setImg(im)
      setRot(0)
      setScale(Math.max(BOX_W / im.naturalWidth, BOX_H / im.naturalHeight))
      setPos({ x: 0, y: 0 })
    }
    im.src = current
  }

  useEffect(() => {
    if (current) loadCurrent()
  }, [])

  useEffect(() => {
    setScale(s => Math.max(s, cover))
    setPos(p => ({ x: clamp(p.x, maxX), y: clamp(p.y, maxY) }))
  }, [img, rot])

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    setPos({
      x: clamp(d.ox + (e.clientX - d.px), maxX),
      y: clamp(d.oy + (e.clientY - d.py), maxY),
    })
  }
  function onPointerUp() { dragRef.current = null }

  function rotate90() {
    if (!img) return
    setRot(r => (r + 90) % 360)
    setPos({ x: 0, y: 0 })
    setErr('')
  }

  function exportCrop(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!img) return reject(new Error('请先选择图片'))
      const c = document.createElement('canvas')
      c.width = OUT_W
      c.height = OUT_H
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#0a0a09'
      ctx.fillRect(0, 0, OUT_W, OUT_H)

      const k = OUT_W / BOX_W
      ctx.save()
      ctx.scale(k, k)
      ctx.translate(BOX_W / 2, BOX_H / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(pos.x, pos.y)
      ctx.drawImage(img, -dispW / 2, -dispH / 2, dispW, dispH)
      ctx.restore()

      resolve(c.toDataURL('image/jpeg', 0.88))
    })
  }

  async function handleApply() {
    setBusy(true)
    setErr('')
    try {
      const dataUrl = await exportCrop()
      await onApply(dataUrl)
    } catch (e: any) {
      setErr(e?.message || '处理失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">裁剪照片（3:4 竖版卡片）</h3>
          <button onClick={onClose} aria-label="关闭" className="text-white/30 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div
          ref={boxRef}
          className="relative mx-auto overflow-hidden rounded-xl border border-tan/30 bg-black touch-none select-none"
          style={{ width: BOX_W, height: BOX_H, cursor: img ? 'grab' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img ? (
            <img
              src={img.src}
              alt="裁剪预览"
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: dispW,
                height: dispH,
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) rotate(${rot}deg)`,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40 hover:text-tan"
            >
              <ImagePlus size={32} />
              <span className="text-xs">选择照片</span>
            </button>
          )}
          <div className="pointer-events-none absolute inset-0 border border-white/10 rounded-xl" />
          <div className="pointer-events-none absolute left-1/3 top-0 bottom-0 w-px bg-white/10" />
          <div className="pointer-events-none absolute left-2/3 top-0 bottom-0 w-px bg-white/10" />
          <div className="pointer-events-none absolute top-1/3 left-0 right-0 h-px bg-white/10" />
          <div className="pointer-events-none absolute top-2/3 left-0 right-0 h-px bg-white/10" />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-white/50">
            <span className="w-8 shrink-0">缩放</span>
            <input
              type="range" min={cover} max={Math.max(cover * 4, 3)} step={0.01}
              value={scale} disabled={!img}
              onChange={e => setScale(Number(e.target.value))}
              className="flex-1 accent-[#edff45]"
            />
          </label>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex-1 btn-secondary text-xs py-2">{img ? '换一张' : '选择照片'}</button>
            <button type="button" onClick={rotate90} disabled={!img} aria-label="旋转90度"
              className="btn-secondary px-3 py-2 disabled:opacity-30"><RotateCw size={14} /></button>
            {current && (
              <button type="button" onClick={loadCurrent}
                className="btn-secondary text-xs py-2 px-3">还原</button>
            )}
          </div>
          <p className="text-[10px] text-white/30">拖动调整位置，建议露出全身或半身，头部留出空间</p>
        </div>

        {err && <p className="text-red-400 text-xs text-center">{err}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary text-sm py-2.5">取消</button>
          <button type="button" onClick={handleApply} disabled={!img || busy}
            className="flex-1 bg-tan text-white rounded-lg text-sm py-2.5 disabled:opacity-40 active:scale-[0.97]">
            {busy ? '保存中...' : '应用照片'}
          </button>
        </div>
      </div>
    </div>
  )
}
