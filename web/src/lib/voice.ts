// Web Speech API 封装：语音识别（点单/选项目）
// Safari/Chrome 需 HTTPS 或 localhost；不支持时返回 null

export type SpeechResult = {
  transcript: string
  isFinal: boolean
}

type SR = any

function getSpeechCtor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isSpeechSupported(): boolean {
  return !!getSpeechCtor()
}

/**
 * 开始一次中文语音识别。
 * @param onResult 实时/最终结果回调
 * @param onEnd 结束（自动或手动 stop）
 * @returns stop 函数；不支持时返回 null
 */
export function startSpeech(
  onResult: (r: SpeechResult) => void,
  onEnd?: (err?: string) => void,
): (() => void) | null {
  const Ctor = getSpeechCtor()
  if (!Ctor) return null

  const rec: SR = new Ctor()
  rec.lang = 'zh-CN'
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1

  let stopped = false
  let ended = false
  const finish = (err?: string) => {
    if (ended) return
    ended = true
    onEnd?.(err)
  }

  rec.onresult = (event: any) => {
    const last = event.results[event.results.length - 1]
    const transcript = String(last?.[0]?.transcript || '')
    onResult({ transcript, isFinal: !!last?.isFinal })
  }
  rec.onerror = (event: any) => {
    if (stopped) return
    const code = event?.error
    const errMap: Record<string, string> = {
      'not-allowed': '麦克风权限被拒绝',
      'service-not-allowed': '语音服务不可用',
      'no-speech': '未听到声音',
      'audio-capture': '未检测到麦克风',
      'network': '语音识别网络错误',
      'language-not-supported': '不支持中文识别',
      'aborted': '识别已取消',
    }
    finish(errMap[code] || (code && code !== 'no-speech' ? `识别失败（${code}）` : '识别失败'))
  }
  rec.onend = () => {
    if (!stopped) finish()
  }

  try {
    rec.start()
  } catch (e: any) {
    finish(e?.message || '启动识别失败')
    return null
  }

  return () => {
    stopped = true
    try { rec.stop() } catch { /* ignore */ }
    try { rec.abort() } catch { /* ignore */ }
  }
}

/**
 * 从语音文本匹配菜单项（服务/商品）。
 * 优先：完全包含 → 去空格互相包含 → 任一关键词命中
 */
export function matchItemByName<T extends { name: string }>(
  text: string,
  items: T[],
): T | null {
  const q = text.replace(/\s+/g, '').toLowerCase()
  if (!q) return null

  // 数字优先：「九十八」「98」「九十八元」等
  const numMap: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15,
    十六: 16, 十七: 17, 十八: 18, 十九: 19, 二十: 20,
    三十: 30, 四十: 40, 五十: 50, 六十: 60,
    七十: 70, 八十: 80, 九十: 90, 九十八: 98,
    一百二十八: 128, 一百六十八: 168, 一百九十八: 198,
  }
  for (const [zh, n] of Object.entries(numMap)) {
    if (q.includes(zh)) {
      const hit = items.find(it => String(it.name).includes(String(n)) || String(it.name).includes(zh))
      if (hit) return hit
    }
  }
  const digits = q.replace(/[^\d]/g, '')
  if (digits) {
    const hit = items.find(it => String(it.name).includes(digits))
    if (hit) return hit
  }

  // 完整名包含在语音里
  for (const it of items) {
    const name = it.name.replace(/\s+/g, '').toLowerCase()
    if (name && q.includes(name)) return it
  }
  // 语音片段出现在名字里
  if (q.length >= 2) {
    for (const it of items) {
      const name = it.name.replace(/\s+/g, '').toLowerCase()
      if (name && name.includes(q)) return it
    }
    // 双向部分匹配（至少 2 字）
    for (let len = Math.min(q.length, 6); len >= 2; len--) {
      const sub = q.slice(0, len)
      const hit = items.find(it => it.name.replace(/\s+/g, '').toLowerCase().includes(sub))
      if (hit) return hit
    }
  }
  return null
}
