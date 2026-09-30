// 启动时加载 .env（无 dotenv 依赖，零第三方）
// 必须在任何 import 到 auth/utils（读 JWT_SECRET）之前执行。
// index.js 将本模块作为第一个 import。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function loadEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return false
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const eq = s.indexOf('=')
      if (eq <= 0) continue
      const key = s.slice(0, eq).trim()
      let val = s.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val
      }
    }
    return true
  } catch {
    return false
  }
}

// 优先 server/.env，其次项目根 .env（安装脚本写入根目录）
loadEnvFile(path.join(ROOT, '.env'))
loadEnvFile(path.join(ROOT, '..', '.env'))

// 未提供密钥时在本机生成并持久化（开发/双击启动兜底；生产应显式配置）
if (!process.env.JWT_SECRET) {
  const { randomBytes } = await import('node:crypto')
  const secret = randomBytes(32).toString('hex')
  process.env.JWT_SECRET = secret
  try {
    const envPath = path.join(ROOT, '..', '.env')
    const exists = fs.existsSync(envPath)
    if (!exists || !fs.readFileSync(envPath, 'utf8').includes('JWT_SECRET=')) {
      fs.appendFileSync(envPath, `JWT_SECRET=${secret}\n`)
      console.warn('[env] 已生成 JWT_SECRET 并写入 .env（请妥善备份，勿提交到仓库）')
    }
  } catch (e) {
    console.warn('[env] 无法写入 .env，本次使用临时 JWT_SECRET:', e.message)
  }
}
