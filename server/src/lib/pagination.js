// 分页工具
//
// 所有列表路由应使用此工具解析 page/pageSize 参数，
// 并返回 { data, total, page, pageSize } 格式。
//
// 默认值：page=1, pageSize=20, 最大 pageSize=100

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 500

export function parsePagination(req) {
  const page = Math.max(1, Number(req.query.page) || DEFAULT_PAGE)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE)
  )
  const offset = (page - 1) * pageSize
  return { page, pageSize, offset, limit: pageSize }
}

/**
 * 执行分页查询并返回标准化响应
 *
 * @param {object} db - better-sqlite3 db instance
 * @param {string} countSql - SELECT COUNT(*) AS total FROM ... 的 SQL
 * @param {array} countArgs - countSql 的参数
 * @param {string} dataSql - SELECT ... FROM ... 的 SQL（不含 LIMIT/OFFSET）
 * @param {array} dataArgs - dataSql 的基础参数
 * @param {number} page - 当前页
 * @param {number} pageSize - 每页条数
 * @returns {object} { data, total, page, pageSize }
 */
export function paginate(db, countSql, countArgs, dataSql, dataArgs, page, pageSize) {
  const totalResult = db.prepare(countSql).get(...countArgs)
  const total = Number(totalResult.total ?? Object.values(totalResult)[0] ?? 0)
  const offset = (page - 1) * pageSize
  const rows = db.prepare(`${dataSql} LIMIT ? OFFSET ?`).all(...dataArgs, pageSize, offset)
  return { data: rows, total, page, pageSize }
}
