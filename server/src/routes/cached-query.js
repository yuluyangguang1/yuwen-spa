// 缓存查询辅助：先查缓存，缓存未命中则执行 SQL 并写入缓存

export function cachedQuery(db, cache, key, sql, args, ttl) {
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const result = db.prepare(sql).all(...args)
  cache.set(key, result, ttl)
  return result
}
