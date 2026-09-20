// 通知工具：声音 + 震动
//
// 局域网 HTTP 环境不支持 PWA Push，用 Web Audio API 播放提示音。
// 浏览器要求用户先交互过才能播放声音，所以在登录后预加载。

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
  } catch (_) { /* 静音环境忽略 */ }
}

// 震动（移动端）
function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch (_) {}
}

// 显示通知（页面内 toast 由调用方处理，这里只负责声+震）
export function notifyNewTicket() {
  playDing()
  vibrate()
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
  } catch (_) {}
}
