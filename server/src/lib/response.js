// 统一响应约定（ApiResponse）
//
// 列表：  { data: T[], total, page, pageSize }     — web/src/lib/api.ts 解包 data
// 单体：  对象本身 或 { ok: true, ... }
// 动作：  { ok: true, ...fields }
// 错误：  { error: string, code: string, details? } — 见 lib/errors.js errorToResponse
//
// 注意：api.ts 若见顶层 data 键会只返回 data，因此
//   - 列表必须用 data 装数组，元数据放同级 total/page/pageSize（解包后前端拿不到，
//     需要元数据时应改用原生 fetch 或在 data 外不要依赖顶层字段）
//   - 需要同时返回数组+元数据给同一调用方时，用 { data, total, ... } 并由调用方
//     使用原始 fetch；或把元数据嵌在 data 内的对象里。

/** 列表响应信封 */
export function list(data, { total, page, pageSize } = {}) {
  const rows = Array.isArray(data) ? data : []
  return {
    data: rows,
    total: total ?? rows.length,
    page: page ?? 1,
    pageSize: pageSize ?? Math.max(rows.length, 1),
  }
}

/** 单对象（不包 data，避免 api.ts 解包破坏嵌套结构） */
export function item(payload) {
  return payload
}

/** 写操作成功 */
export function ok(extra = {}) {
  return { ok: true, ...extra }
}
