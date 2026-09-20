// 服务工作者 — 离线缓存 + API 请求拦截
//
// 缓存策略：
//   - App shell（HTML/CSS/JS）: Cache-First
//   - API 数据: Network-First（失败时回退到缓存）
//   - 图片/字体: Cache-First

const CACHE_NAME = 'yuwen-v1'
const APP_SHELL = [
  '/',
  '/index.html',
  '/assets/index.css',
]

const API_CACHE = 'yuwen-api-v1'

// ── 安装 ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  )
})

// ── 激活 ──────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== API_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  )
  self.skipWaiting()
})

// ── 请求拦截 ──────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // API 请求：Network-First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, API_CACHE))
    return
  }

  // App shell：Cache-First
  event.respondWith(cacheFirst(event.request, CACHE_NAME))
})

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
