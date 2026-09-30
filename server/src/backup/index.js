// 数据库自动备份
//
// 使用 SQLite 的 VACUUM INTO 生成一致性备份（WAL 安全），
// 失败时回退到同步 copyFile（先 checkpoint）。
//
// 每小时自动备份一次，保留最近 7 天（168 个备份）。
// 备份文件存在 db/backups/ 目录，格式：yuwen_2026-05-23T14.db
//
// 恢复（批次1，决策A）：不在线换库 —— 校验备份 → 自动安全备份当前库 →
// 暂存为 db/yuwen.restore.db + sidecar 说明 → 指导人工停服替换重启。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { ValidationError, NotFoundError, BusinessError } from '../lib/errors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const BACKUP_DIR = path.join(ROOT, 'db', 'backups')
const LIVE_DB = path.join(ROOT, 'db', 'yuwen.db')
const RESTORE_STAGED = path.join(ROOT, 'db', 'yuwen.restore.db')
const RESTORE_SIDECAR = path.join(ROOT, 'db', 'yuwen.restore.json')
const MAX_BACKUPS = 168  // 7 天 × 24 小时

let dbHandle = null

export function initBackup(db) {
  dbHandle = db
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  // 启动 10 秒后再做首次备份，避免拖慢冷启动
  const bootTimer = setTimeout(() => doBackup(), 10_000)
  bootTimer.unref?.()

  const interval = setInterval(doBackup, 60 * 60 * 1000)
  interval.unref?.()

  console.log('[backup] 自动备份已启动（每小时，保留 7 天，VACUUM INTO）')
}

function listBackupFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('yuwen_') && f.endsWith('.db'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function cleanupSync() {
  try {
    const files = listBackupFiles()
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, files[i])) } catch (_) {}
    }
  } catch (_) {}
}

/**
 * 一致性备份：VACUUM INTO（含 WAL 中已提交数据，单文件）
 */
function doBackup() {
  if (!dbHandle) return
  try {
    const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 16)
    const dest = path.join(BACKUP_DIR, `yuwen_${ts}.db`)
    dbHandle.prepare(`VACUUM INTO ?`).run(dest)
    cleanupSync()
  } catch (e) {
    // 回退：checkpoint 后 copy
    try {
      dbHandle.prepare(`PRAGMA wal_checkpoint(TRUNCATE)`).run()
      const src = LIVE_DB
      if (fs.existsSync(src)) {
        const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 16)
        fs.copyFileSync(src, path.join(BACKUP_DIR, `yuwen_${ts}.db`))
        cleanupSync()
      }
    } catch (e2) {
      console.error('[backup] 备份失败:', e2.message)
    }
  }
}

// 手动触发备份（供 API 调用）
export function manualBackup() {
  doBackup()
  const files = listBackupFiles()
  return { ok: true, count: files.length, latest: files[0] || null }
}

// 获取备份列表
export function listBackups() {
  return listBackupFiles().map(f => {
    const full = path.join(BACKUP_DIR, f)
    const st = fs.statSync(full)
    return { name: f, size: st.size, time: st.mtime }
  })
}

// ── 恢复（批次1）：校验 + 暂存，不在线换库 ───────

/** 校验文件名并解析为 BACKUP_DIR 内绝对路径（防路径穿越） */
export function safeBackupPath(name) {
  if (typeof name !== 'string' || !/^yuwen_[0-9A-Za-z:._-]+\.db$/.test(name)) {
    throw new ValidationError('非法备份文件名')
  }
  const full = path.join(BACKUP_DIR, name)
  if (!path.resolve(full).startsWith(BACKUP_DIR + path.sep)) {
    throw new ValidationError('非法备份文件名')
  }
  return full
}

/** 校验备份文件：quick_check + schema_version + shops 计数 */
export function verifyBackup(name) {
  const full = safeBackupPath(name)
  if (!fs.existsSync(full)) throw new NotFoundError('备份文件不存在')
  let b
  try {
    b = new Database(full, { readonly: true, fileMustExist: true })
  } catch (e) {
    throw new BusinessError(`无法打开备份文件：${e.message}`, { code: 'BACKUP_INVALID' })
  }
  try {
    let quick
    try { quick = b.prepare('PRAGMA quick_check').get() } catch (e) {
      return { ok: false, quick_check: e.message, schema_version: null, shop_count: null, size: fs.statSync(full).size }
    }
    let schema_version = null, shop_count = null
    try {
      schema_version = b.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get()?.value
      shop_count = b.prepare('SELECT COUNT(*) c FROM shops').get()?.c
    } catch (_) {}
    return {
      ok: quick?.quick_check === 'ok' && schema_version != null,
      quick_check: quick?.quick_check || null,
      schema_version: schema_version != null ? Number(schema_version) : null,
      shop_count: shop_count != null ? Number(shop_count) : null,
      size: fs.statSync(full).size,
    }
  } finally {
    b.close()
  }
}

function restoreInstructions(preRestoreName) {
  const dbDir = path.join(ROOT, 'db')
  return [
    '停止服务：pkill -f "server/src/index.js"',
    `替换库文件：cd ${dbDir} && rm -f yuwen.db yuwen.db-wal yuwen.db-shm && mv yuwen.restore.db yuwen.db`,
    `重启服务：cd ${ROOT} && node src/index.js`,
    preRestoreName
      ? `回退备份：恢复前数据已自动存为 db/backups/${preRestoreName}，如需回退重复第 2 步换回该文件`
      : '回退备份：替换前请自行确认 db/backups/ 中已有当前数据的备份',
  ]
}

/** 待完成的恢复（staged 文件 + sidecar 说明） */
export function getPendingRestore() {
  try {
    if (!fs.existsSync(RESTORE_STAGED)) return null
    const st = fs.statSync(RESTORE_STAGED)
    let meta = {}
    try { meta = JSON.parse(fs.readFileSync(RESTORE_SIDECAR, 'utf8')) } catch (_) {}
    return {
      name: path.basename(RESTORE_STAGED),
      size: st.size,
      time: st.mtime,
      source: meta.source || null,
      pre_restore_backup: meta.pre_restore || null,
      instructions: meta.instructions || restoreInstructions(meta.pre_restore || null),
    }
  } catch {
    return null
  }
}

/**
 * 暂存恢复：校验备份 → VACUUM INTO 安全备份当前库 → 拷贝为 db/yuwen.restore.db + sidecar。
 * 不触碰运行中的 yuwen.db（决策A：不自动换库），由人工停服替换重启完成。
 */
export function stageRestore(name) {
  if (!dbHandle) throw new BusinessError('备份模块未初始化', { code: 'BACKUP_NOT_READY' })
  const verified = verifyBackup(name)
  if (!verified.ok) {
    throw new BusinessError('备份文件校验失败，拒绝暂存恢复', { code: 'BACKUP_VERIFY_FAILED' })
  }

  const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 16)
  const safetyName = `yuwen_pre_restore_${ts}.db`
  const safetyPath = path.join(BACKUP_DIR, safetyName)
  dbHandle.prepare(`VACUUM INTO ?`).run(safetyPath)

  fs.copyFileSync(safeBackupPath(name), RESTORE_STAGED)
  const instructions = restoreInstructions(safetyName)
  const sidecar = { source: name, pre_restore: safetyName, staged_at: Date.now(), instructions }
  fs.writeFileSync(RESTORE_SIDECAR, JSON.stringify(sidecar, null, 2))

  return {
    verified,
    staged: 'db/yuwen.restore.db',
    pre_restore_backup: safetyName,
    instructions,
  }
}
