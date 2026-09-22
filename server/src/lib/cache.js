// 基于 Map 的内存 LRU 缓存，支持 TTL 自动过期
// 默认最大容量 1000 条，默认 TTL 5 分钟

const DEFAULT_MAX_SIZE = 1000
const DEFAULT_TTL = 5 * 60 * 1000 // 5 分钟

export class LRUCache {
  #map
  #maxSize
  #defaultTTL

  constructor(maxSize = DEFAULT_MAX_SIZE, defaultTTL = DEFAULT_TTL) {
    this.#map = new Map()
    this.#maxSize = maxSize
    this.#defaultTTL = defaultTTL
  }

  #now() {
    return Date.now()
  }

  #isExpired(entry) {
    return entry.expiresAt !== null && entry.expiresAt <= this.#now()
  }

  get(key) {
    const entry = this.#map.get(key)
    if (!entry) return undefined
    if (this.#isExpired(entry)) {
      this.#map.delete(key)
      return undefined
    }
    // 移动到末尾表示最近使用
    this.#map.delete(key)
    this.#map.set(key, entry)
    return entry.value
  }

  set(key, value, ttl) {
    // 如果 key 已存在，先删除以便重新插入到末尾
    if (this.#map.has(key)) {
      this.#map.delete(key)
    }
    // 超过容量时淘汰最久未使用的条目
    if (this.#map.size >= this.#maxSize) {
      const oldestKey = this.#map.keys().next().value
      this.#map.delete(oldestKey)
    }
    const expiresAt = ttl !== undefined ? this.#now() + ttl : null
    this.#map.set(key, { value, expiresAt })
  }

  invalidate(key) {
    // 兼容前缀失效：'services:shop1:' 匹配 'services:shop1:page:size'
    let deleted = this.#map.delete(key)
    if (key.endsWith(':')) {
      for (const k of [...this.#map.keys()]) {
        if (k.startsWith(key)) {
          this.#map.delete(k)
          deleted = true
        }
      }
    }
    return deleted
  }

  clear() {
    this.#map.clear()
  }

  get size() {
    return this.#map.size
  }
}

// 模块级单例，默认配置
export const cache = new LRUCache()
