// 通知工具：声音 + 震动 + 语音（喇叭感）
//
// 局域网 HTTP 环境不支持 PWA Push，用 Web Audio API 播放提示音。
// 浏览器要求用户先交互过才能播放声音，所以在登录后预加载。
// speechSynthesis 中文播报用于完钟提醒（店内电脑/手机外放）。

// 用 AudioContext 合成一个简单的"叮咚"提示音
function playDing() {
  try {
    const ctx = new AudioContext()
    // 第一个音：高音
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.value = 880  // A5
    gain1.gain.setValueAtTime(0.3, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.3)

    // 第二个音：更高音（间隔 0.15s）
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.value = 1100  // C#6
    gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15)
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(ctx.currentTime + 0.15)
    osc2.stop(ctx.currentTime + 0.5)
    setTimeout(() => { try { ctx.close() } catch (_) {} }, 600)
  } catch (_) { /* 静音环境忽略 */ }
}

// 到点：更急促的三连音
function playUrgent() {
  try {
    const ctx = new AudioContext()
    const times = [0, 0.2, 0.4]
    for (const t of times) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 988
      gain.gain.setValueAtTime(0.22, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.16)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.18)
    }
    setTimeout(() => { try { ctx.close() } catch (_) {} }, 800)
  } catch (_) { /* ignore */ }
}

// 震动（移动端）
function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch (_) {}
}

// 中文语音播报（系统 TTS，真·喇叭感）
function speak(text: string) {
  try {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1
    u.pitch = 1
    const zh = window.speechSynthesis.getVoices().find(v =>
      v.lang?.toLowerCase().startsWith('zh'))
    if (zh) u.voice = zh
    window.speechSynthesis.speak(u)
  } catch (_) { /* 无 TTS 时静默 */ }
}

// 显示通知（页面内 toast 由调用方处理，这里只负责声+震）
export function notifyNewTicket() {
  playDing()
  vibrate()
}

// 完钟预警：剩余 stage 分钟（speech 传 null 可静音只播提示音）
export function notifyEndWarn(stage: number, speech?: string | null) {
  playDing()
  vibrate()
  if (speech !== null) speak(speech || `服务还有${stage}分钟`)
}

// 完钟到点
export function notifyEnd(speech?: string | null) {
  playUrgent()
  vibrate()
  if (speech !== null) speak(speech || '服务时间到了')
}

// 预热 AudioContext（需要在用户交互后调用一次，否则移动端浏览器会阻止自动播放）
let warmed = false
export function warmupAudio() {
  if (warmed) return
  warmed = true
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.01)
    setTimeout(() => { try { ctx.close() } catch (_) {} }, 50)
  } catch (_) {}
  // 预热语音合成（部分浏览器需要先 getVoices）
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices()
    }
  } catch (_) {}
}

// 本地倒计时用：按已触发集合去重
export function makeEndTracker(onWarn: (stage: number) => void, onEnd: () => void, warnMinutes: number[] = [5]) {
  const fired = new Set<string>()
  const stages = [...warnMinutes].sort((a, b) => b - a)
  return {
    /** remainMs 为剩余毫秒；跨档只回调一次 */
    check(remainMs: number) {
      for (const m of stages) {
        if (remainMs <= m * 60000 && remainMs > 0 && !fired.has(`w${m}`)) {
          fired.add(`w${m}`)
          onWarn(m)
        }
      }
      if (remainMs <= 0 && !fired.has('end')) {
        fired.add('end')
        onEnd()
      }
    },
    reset() { fired.clear() },
  }
}
