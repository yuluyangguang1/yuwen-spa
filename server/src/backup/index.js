// 数据库自动备份
//
// 使用 SQLite 的 VACUUM INTO 生成一致性备份（WAL 安全），
// 失败时回退到同步 copyFile（先 checkpoint）。
//
// 每小时自动备份一次，保留最近 7 天（168 个备份）。
// 备份文件存在 db/backups/ 目录，格式：yuwen_2026-05-23T14.db

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const BACKUP_DIR = path.join(ROOT, 'db', 'backups')
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
      const src = path.join(ROOT, 'db', 'yuwen.db')
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
