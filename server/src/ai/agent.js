// 足韵 AI Agent
//
// 系统内置智能助手，具备以下能力：
// 1. 技师月度评分（分析评价文本语义）
// 2. 经营日报/周报
// 3. 智能排钟建议
// 4. 自然语言查询（老板问"今天赚了多少"）
//
// Agent 通过 system prompt 注入足浴行业知识 + 当前门店数据上下文

import { chatCompletion, getAIConfig } from './provider.js'

const SYSTEM_PROMPT = `你是"足韵"足浴门店管理系统的内置 AI 助手。你的角色是帮助门店老板和管理者做经营决策。

你了解足浴行业的特点：
- 技师是核心资产，服务质量直接影响回头率
- 排钟效率影响翻台率和营收
- 会员储值是现金流的关键
- 高峰时段（18:00-22:00）需要合理调度
- 顾客评价是改进服务的重要依据

你的回答风格：
- 简洁直接，用数据说话
- 给出可执行的建议，不说空话
- 金额用人民币，时间用24小时制
- 如果数据不足以得出结论，诚实说明`

// ── 能力 1: 技师月度评分 ─────────────────────────────────
export async function aiScoreTechnician(techName, reviews) {
  if (reviews.length === 0) return null

  const reviewTexts = reviews.map((r, i) =>
    `评价${i + 1}: ${r.rating}星${r.tags?.length ? ` [${r.tags.join(',')}]` : ''}${r.comment ? ` "${r.comment}"` : ''}`
  ).join('\n')

  const prompt = `请分析以下顾客对技师"${techName}"的评价，给出多维度评分和总结。

${reviewTexts}

请以 JSON 格式回复（不要 markdown 代码块）：
{
  "score": 总分(0-5,保留1位小数),
  "dimensions": {
    "service": 服务质量(0-5),
    "attitude": 服务态度(0-5),
    "skill": 专业技能(0-5),
    "punctuality": 准时守约(0-5)
  },
  "summary": "一句话总结(30字以内)",
  "suggestions": "给技师的改进建议(50字以内)",
  "keywords": ["正面关键词1","正面关键词2"],
  "concerns": ["需关注的问题1"]
}`

  const result = await chatCompletion([
    { role: 'system', content: '你是足浴行业的服务质量评估专家。请严格按 JSON 格式回复。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.3 })

  try {
    // 尝试解析 JSON（LLM 可能包裹在 ```json ``` 里）
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  } catch (e) {
    // 解析失败，返回原始文本
    return { score: 0, summary: result.slice(0, 100), raw: result }
  }
}

// ── 能力 2: 经营分析 ─────────────────────────────────────
export async function aiBusinessReport(data) {
  const prompt = `请根据以下门店经营数据生成简报：

今日数据：
- 营收: ¥${(data.revenue / 100).toFixed(0)}
- 完成钟数: ${data.ticketCount}
- 客单价: ¥${(data.avgTicket / 100).toFixed(0)}
- 在岗技师: ${data.techCount}人
- 新会员: ${data.newCustomers}人
- 储值充值: ¥${(data.topupAmount / 100).toFixed(0)}

${data.comparison ? `对比昨日：营收${data.comparison.revenueChange > 0 ? '+' : ''}${data.comparison.revenueChange}%` : ''}

请给出：
1. 一句话总结今日经营状况
2. 2-3 条具体可执行的建议
3. 需要关注的风险点（如果有）

用简洁中文回复，不超过 200 字。`

  return chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ])
}

// ── 能力 3: 智能排钟建议 ─────────────────────────────────
export async function aiScheduleSuggestion(context) {
  const prompt = `当前排钟情况：
- 空闲技师: ${context.idleTechs.map(t => `${t.name}(${t.level},评分${t.ai_score})`).join(', ')}
- 等待顾客: ${context.waitingCount}人
- 当前时段: ${context.timeSlot}
- 顾客偏好: ${context.customerPreference || '无特殊偏好'}

请推荐最合适的技师，并说明理由（一句话）。回复格式：
推荐: [技师名]
理由: [一句话]`

  return chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ], { temperature: 0.5, max_tokens: 200 })
}

// ── 能力 4: 自然语言查询 ─────────────────────────────────
export async function aiChat(userMessage, context) {
  const contextPrompt = context ? `\n\n当前门店数据上下文：\n${JSON.stringify(context, null, 2)}` : ''

  return chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT + contextPrompt },
    { role: 'user', content: userMessage },
  ])
}

// 检查 AI 是否可用（从 provider.js 导出）
