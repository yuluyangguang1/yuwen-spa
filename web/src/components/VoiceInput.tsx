// 语音输入按钮：长按/点击开始识别，回传最终文本

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { isSpeechSupported, startSpeech } from '@/lib/voice'

interface VoiceInputProps {
  onText: (text: string) => void
  onError?: (msg: string) => void
  label?: string
  className?: string
}

export function VoiceInput({ onText, onError, label = '语音输入', className = '' }: VoiceInputProps) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const stopRef = useRef<(() => void) | null>(null)
  const supported = isSpeechSupported()

  useEffect(() => () => { stopRef.current?.() }, [])

  if (!supported) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] text-white/20 ${className}`}
        title="当前浏览器不支持语音识别"
      >
        <MicOff size={14} /> 语音不可用
      </span>
    )
  }

  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
    setListening(false)
    setInterim('')
  }

  const toggle = () => {
    if (listening) { stop(); return }
    const stopper = startSpeech(
      (r) => {
        setInterim(r.transcript)
        if (r.isFinal && r.transcript.trim()) {
          onText(r.transcript.trim())
          stop()
        }
      },
      (err) => {
        if (err && err !== '未听到声音') onError?.(err)
        stop()
      },
    )
    if (!stopper) {
      onError?.('当前浏览器不支持语音识别（需 Chrome/Edge）')
      return
    }
    stopRef.current = stopper
    setListening(true)
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={listening}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors active:scale-95 ${
          listening
            ? 'bg-cinnabar/20 text-cinnabar animate-pulse'
            : 'bg-white/5 text-white/50 hover:text-white/80'
        }`}
        title={listening ? '停止识别' : label}
      >
        {listening ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
      </button>
      {listening && (
        <span className="text-[11px] text-cinnabar/90 truncate max-w-[12em]" aria-live="polite">
          {interim || '请说话…'}
        </span>
      )}
    </div>
  )
}
