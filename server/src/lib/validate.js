// 轻量入参校验（零依赖，替代全量 Zod 迁移的务实子集）
//
// 用法：
//   const body = requireObject(req.body)
//   const rating = requireInt(body.rating, 'rating', { min: 1, max: 5 })
//   const name = requireString(body.name, 'name', { max: 100 })
//
// 失败抛 ValidationError → 统一错误处理器返回 422 { error, code: 'VALIDATION_ERROR' }

import { ValidationError } from './errors.js'

export function requireObject(value, label = 'body') {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} 必须是对象`)
  }
  return value
}

export function requireString(value, field, { max = 1000, min = 1, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} 必须是字符串`)
  const s = trim ? value.trim() : value
  if (s.length < min) throw new ValidationError(`${field} 不能为空`)
  if (s.length > max) throw new ValidationError(`${field} 超长（最多 ${max} 字符）`)
  return s
}

export function optionalString(value, field, opts = {}) {
  if (value == null || value === '') return null
  return requireString(value, field, opts)
}

export function requireInt(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new ValidationError(`${field} 必须是整数`)
  if (n < min || n > max) throw new ValidationError(`${field} 必须在 ${min}~${max} 之间`)
  return n
}

export function optionalInt(value, field, opts = {}) {
  if (value == null || value === '') return null
  return requireInt(value, field, opts)
}

export function requireOneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} 必须是 ${allowed.join('/')}`)
  }
  return value
}

export function optionalBool(value, field, fallback = false) {
  if (value == null) return fallback
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return Boolean(value)
  if (value === 'true' || value === 'false') return value === 'true'
  throw new ValidationError(`${field} 必须是布尔值`)
}
