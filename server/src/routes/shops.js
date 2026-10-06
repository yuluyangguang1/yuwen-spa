// 门店：单店模式下只用 GET / PUT 改名字+地址，另可上传自定义标识

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NotFoundError, ValidationError } from '../lib/errors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

export async function registerShopRoutes(fastify) {
  fastify.get('/api/shops', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: '仅管理员可查看门店列表' })
      }
      // 门店列表仅返回本店，避免泄露其他租户信息
      const mine = req.user.shop_id
        ? fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).all(req.user.shop_id)
        : []
      return { data: mine, total: mine.length, page: 1, pageSize: Math.max(mine.length, 1) }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })

  fastify.get('/api/shops/current', async (req, reply) => {
    try {
      if (req.user?.shop_id) {
        const mine = fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).get(req.user.shop_id)
        if (mine) return mine
      }
      return fastify.db.prepare(`SELECT * FROM shops ORDER BY created_at LIMIT 1`).get() || null
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  fastify.put('/api/shops/:id', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: '仅管理员可修改门店信息' })
      }
      const { id } = req.params
      if (id !== req.user.shop_id) {
        return reply.code(403).send({ error: '无权限修改该门店' })
      }
      const { name, address, phone, short_name } = req.body || {}
      const now = Date.now()
      const r = fastify.db.prepare(`UPDATE shops SET name=COALESCE(?, name), address=COALESCE(?, address), phone=COALESCE(?, phone), short_name=COALESCE(?, short_name), updated_at=? WHERE id=?`).run(name, address, phone, short_name, now, id)
      if (r.changes === 0) throw new NotFoundError('not found')
      return fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).get(id)
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw e
    }
  })

  // ── 上传自定义标识（浏览器图标 / PWA / 品牌区）──
  // 存 server/public/brand（生产）+ web/public/brand（vite dev 即时可见）
  fastify.post('/api/shops/:id/logo', async (req, reply) => {
    try {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: '仅管理员可修改门店标识' })
      }
      const { id } = req.params
      if (id !== req.user.shop_id) {
        return reply.code(403).send({ error: '无权限修改该门店' })
      }
      const image = req.body?.image
      if (!image || typeof image !== 'string') throw new ValidationError('缺少 image')
      // 支持 PNG（保留透明通道，深浅色底都能用）
      const m = image.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
      if (!m) throw new ValidationError('仅支持 PNG / JPEG 图片')
      if (m[2].length > 1_500_000) throw new ValidationError('图片过大，请压缩后重试')
      const buf = Buffer.from(m[2], 'base64')
      const isPng = m[1] === 'png'
      const magicOk = isPng
        ? buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50
        : buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8
      if (!magicOk) throw new ValidationError('图片内容无效')

      const ext = isPng ? 'png' : 'jpg'
      const fname = `logo-${id}.${ext}`
      const dirs = [path.join(path.resolve(__dirname, '../..'), 'public', 'brand')]
      try {
        dirs.push(path.join(PROJECT_ROOT, 'web', 'public', 'brand'))
      } catch { /* 镜像目录失败不影响主存储 */ }
      for (const dir of dirs) {
        try {
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, fname), buf)
        } catch (e) {
          if (dir === dirs[0]) throw e
        }
      }

      const logo = `/brand/${fname}?v=${Date.now()}`
      fastify.db.prepare(`UPDATE shops SET logo=?, updated_at=? WHERE id=?`).run(logo, Date.now(), id)
      const updated = fastify.db.prepare(`SELECT * FROM shops WHERE id=?`).get(id)
      fastify.broadcast?.({ type: 'shop:updated', data: updated })
      return { logo }
    } catch (e) {
      req.log.error(e)
      if (e.code && e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      return reply.code(500).send({ error: '服务器内部错误' })
    }
  })
}
