// 将 web/dist 复制到 server/public 供 Fastify 静态托管
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'web', 'dist')
const DST = path.join(__dirname, '..', 'server', 'public')

// 清空目标目录
if (fs.existsSync(DST)) {
  fs.rmSync(DST, { recursive: true })
}

// 复制整个 dist 目录
fs.cpSync(SRC, DST, { recursive: true })

console.log(`[copy-web] ✅ 已复制 web/dist → server/public`)
