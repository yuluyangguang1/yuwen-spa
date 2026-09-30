// 集中式角色守卫
//
// 用法：
//   fastify.post('/api/x', { preHandler: requireRole('admin', 'pos') }, handler)
//   或在 handler 内 assertRole(req, 'admin')
//
// 角色模型：admin | pos | cs | tech（以 users.role 为准，hook 已回查 DB）

import { PermissionError, AuthError } from '../lib/errors.js'

export const ROLES = Object.freeze(['admin', 'pos', 'cs', 'tech'])

/** 收银/客服/管理员：开单、收款、报表、会员 */
export const STAFF_ROLES = Object.freeze(['admin', 'pos', 'cs'])
/** 仅管理员 */
export const ADMIN_ROLES = Object.freeze(['admin'])

export function assertRole(req, ...roles) {
  if (!req.user) throw new AuthError('请先登录')
  const role = req.user.role
  if (!roles.includes(role)) {
    throw new PermissionError('当前角色无权执行此操作')
  }
}

/**
 * Fastify preHandler：校验用户角色
 * @param {...string} roles 允许的角色列表
 */
export function requireRole(...roles) {
  const allowed = new Set(roles)
  return async function roleGuard(req) {
    assertRole(req, ...allowed)
  }
}
