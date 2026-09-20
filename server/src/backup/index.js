// 数据库自动备份
//
// 每小时自动备份一次，保留最近 7 天（168 个备份）。
// 备份文件存在 db/backups/ 目录，格式：yuwen_2026-05-23T14.db
// 老板只需拷贝 db/ 整个目录就能迁移数据。

import fs from 'node:fs'
import path from 'node:path'

const BACKUP_DIR = path.join(process.cwd(), 'db', 'backups')
const MAX_BACKUPS = 168  // 7 天 × 24 小时

let dbPath = null

export function initBackup(db) {
  // 获取数据库文件路径
  dbPath = path.join(process.cwd(), 'db', 'yuwen.db')
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  // 立即备份一次
  doBackup()

  // 每小时备份
  setInterval(doBackup, 60 * 60 * 1000)

  console.log('[backup] 自动备份已启动（每小时，保留 7 天）')
}

function doBackup() {
  if (!dbPath || !fs.existsSync(dbPath)) return

  const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 16)
  const dest = path.join(BACKUP_DIR, `yuwen_${ts}.db`)

  try {
    fs.copyFileSync(dbPath, dest)
    cleanup()
  } catch (e) {
    console.error('[backup] 备份失败:', e.message)
  }
}

function cleanup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('yuwen_') && f.endsWith('.db'))
      .sort()
      .reverse()

    // 保留最新 MAX_BACKUPS 个，删除多余的
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      fs.unlinkSync(path.join(BACKUP_DIR, files[i]))
    }
  } catch (_) {}
}

// 手动触发备份（供 API 调用）
export function manualBackup() {
  doBackup()
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('yuwen_') && f.endsWith('.db'))
    .sort().reverse()
  return { ok: true, count: files.length, latest: files[0] || null }
}

// 获取备份列表
export function listBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('yuwen_') && f.endsWith('.db'))
    .sort().reverse()
  return files.map(f => ({
    name: f,
    size: fs.statSync(path.join(BACKUP_DIR, f)).size,
    time: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
  }))
}
