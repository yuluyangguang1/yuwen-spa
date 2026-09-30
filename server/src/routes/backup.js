// 备份管理 API（admin）
//
// GET  /api/backups                  — 列表 + 待恢复暂存状态
// POST /api/backups                  — 立即手动备份
// GET  /api/backups/:name/download   — 下载备份文件
// POST /api/backups/:name/restore    — 校验 + 暂存恢复（不在线换库，决策A）
//     body: { confirm: <name> }      — 二次确认，防误触

import fs from 'node:fs'
import { nanoid } from 'nanoid'
import { requireRole, ADMIN_ROLES } from '../auth/roles.js'
import { ValidationError } from '../lib/errors.js'
import {
  manualBackup, listBackups, verifyBackup, stageRestore, getPendingRestore, safeBackupPath,
} from '../backup/index.js'

export async function registerBackupRoutes(fastify) {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) }

  fastify.get('/api/backups', adminOnly, async (req, reply) => {
    try {
      const files = listBackups()
      const pending_restore = getPendingRestore()
      // 顶层 data 被前端 api.ts 解包 → { files, pending_restore }
      return { data: { files, pending_restore }, total: files.length, page: 1, pageSize: files.length }
    } catch (e) {
      req.log.error(e)
      throw e
    }
  })

  fastify.post('/api/backups', adminOnly, async (req, reply) => {
    const result = manualBackup()
    fastify.db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?, ?, ?, 'backup.create', 'backup', ?, ?, ?)
    `).run(nanoid(10), req.user.shop_id, req.user.sub || null,
          result.latest || null, JSON.stringify({ count: result.count }), Date.now())
    return result
  })

  fastify.get('/api/backups/:name/download', adminOnly, async (req, reply) => {
    const full = safeBackupPath(req.params.name)
    if (!fs.existsSync(full)) {
      return reply.code(404).send({ error: '备份文件不存在', code: 'NOT_FOUND' })
    }
    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename="${req.params.name}"`)
    return fs.createReadStream(full)
  })

  fastify.post('/api/backups/:name/restore', adminOnly, async (req, reply) => {
    const name = req.params.name
    const confirm = req.body?.confirm
    if (confirm !== name) {
      throw new ValidationError('请在 confirm 中回填备份文件名以确认恢复')
    }

    // 校验（不存在/损坏 → 抛错，不产生副作用）
    const verified = verifyBackup(name)
    if (!verified.ok) {
      return reply.code(422).send({ error: '备份文件校验失败', code: 'BACKUP_VERIFY_FAILED', details: verified })
    }

    // 暂存：安全备份当前库 + 拷贝暂存文件 + sidecar（不触碰运行中的 yuwen.db）
    const staged = stageRestore(name)

    fastify.db.prepare(`
      INSERT INTO audit_logs(id, shop_id, actor, action, target_type, target_id, payload, created_at)
      VALUES(?, ?, ?, 'backup.restore_staged', 'backup', ?, ?, ?)
    `).run(nanoid(10), req.user.shop_id, req.user.sub || null, name,
          JSON.stringify({
            schema_version: verified.schema_version,
            pre_restore_backup: staged.pre_restore_backup,
            staged: staged.staged,
          }), Date.now())

    return {
      ok: true,
      verified: staged.verified,
      staged: staged.staged,
      pre_restore_backup: staged.pre_restore_backup,
      instructions: staged.instructions,
    }
  })
}
