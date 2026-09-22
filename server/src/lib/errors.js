// 结构化错误码
//
// 自定义错误类，区分 4xx / 5xx，便于前端精确处理和日志分类。
// 所有路由应优先抛出自定义错误，而非裸 Error。

export class BusinessError extends Error {
  constructor(message, { code = 'BUSINESS_ERROR', statusCode = 400, details = null } = {}) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.details = details
    this.name = 'BusinessError'
  }
}

export class NotFoundError extends BusinessError {
  constructor(message = '资源不存在') {
    super(message, { code: 'NOT_FOUND', statusCode: 404 })
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends BusinessError {
  constructor(message = '参数校验失败', details = null) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 422, details })
    this.name = 'ValidationError'
  }
}

export class AuthError extends BusinessError {
  constructor(message = '认证失败') {
    super(message, { code: 'AUTH_ERROR', statusCode: 401 })
    this.name = 'AuthError'
  }
}

export class PermissionError extends BusinessError {
  constructor(message = '无权限操作') {
    super(message, { code: 'PERMISSION_DENIED', statusCode: 403 })
    this.name = 'PermissionError'
  }
}

export class ConflictError extends BusinessError {
  constructor(message = '资源冲突') {
    super(message, { code: 'CONFLICT', statusCode: 409 })
    this.name = 'ConflictError'
  }
}

/**
 * 将错误对象转为 Fastify 友好的响应格式
 */
export function errorToResponse(err) {
  // 已有的结构化错误
  if (err instanceof BusinessError) {
    return {
      error: err.message,
      code: err.code,
      ...(err.details !== null ? { details: err.details } : {}),
    }
  }
  // 原生 JS 错误：不回传原始 message（可能含内部细节），只给通用文案
  if (err instanceof TypeError || err instanceof SyntaxError) {
    return { error: '请求参数无效', code: 'INVALID_ARGUMENT' }
  }
  // 未知错误 → 500
  return { error: '服务器内部错误', code: 'INTERNAL_ERROR' }
}

/**
 * Fastify 错误处理器集成
 */
export function registerErrorHandler(fastify) {
  fastify.setErrorHandler((err, req, reply) => {
    fastify.log.error({ err, url: req.url, method: req.method }, 'request error')

    const resp = errorToResponse(err)
    // statusCode 必须是数字；better-sqlite3 的 code 是 'SQLITE_*' 字符串，不能当 HTTP 状态码
    const code = Number.isInteger(err.statusCode) ? err.statusCode
      : Number.isInteger(err.code) ? err.code
      : 500
    return reply.code(code).send(resp)
  })
}
