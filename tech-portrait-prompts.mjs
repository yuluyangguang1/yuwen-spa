// 技师照片生成提示词 — 足韵 yuwen-spa 客户预览专用
//
// 使用方式：复制提示词到 即梦/可灵/Midjourney 生成照片
// 生成后上传至 server/src/db，将 URL 存入 technicians.avatar 字段
//
// 提示词结构：
//   [面部增强模板 — 2行，始终放最前]
//   [年龄 + 表情 — 1行]
//   [发型 — 1行]
//   [上身着装 — 1行]
//   [下身着装 — 1行]
//   [配饰 — 1行，最多1-2件]
//   [姿势 — 1行]
//   [品质后缀 — 1-2行，始终放最后]

// ──────────────────────────────────────────────────
// 面部增强模板（女性）— 知性性感 吸引人眼球
// ──────────────────────────────────────────────────
export const FEMALE_FACE = `专业人像摄影，亚洲女性，精致五官，知性性感，
完美瓜子脸，高挺鼻梁，饱满丰唇，肌肤白皙细腻有光泽，
睫毛根根分明，双眼皮内勾，眼神魅惑有神采，
面部光影立体柔和，高级模特脸，气质出众`

// ──────────────────────────────────────────────────
// 面部增强模板（男性）
// ──────────────────────────────────────────────────
export const MALE_FACE = `专业人像摄影，亚洲男性，精致五官，英俊帅气，
轮廓分明的下颌线，高挺鼻梁，剑眉星目，
皮肤干净细腻有质感，面部光影立体，高级男模脸`

// ──────────────────────────────────────────────────
// 品质后缀（通用）
// ──────────────────────────────────────────────────
export const QUALITY_SUFFIX = `全身站立，专业时尚写真摄影，柔光与暖色环境光交织，
背景梦幻散景光斑，浅景深，4K超高清，杂志质感`

// ──────────────────────────────────────────────────
// 负向提示词（通用）
// ──────────────────────────────────────────────────
export const NEGATIVE_PROMPT = `动漫，卡通，3D渲染，模糊，低质量，手指变形，多余手指，
文字，水印，面部畸形，五官不对称`

// ──────────────────────────────────────────────────
// 即梦/可灵 专用参数
// ──────────────────────────────────────────────────
export const JIMENG_SETTINGS = {
  style: '写实',
  aspectRatio: '3:4',
  model: 'jimeng-turbo',
}

export const KLING_SETTINGS = {
  style: '高清人像',
  aspectRatio: '3:4',
}

export const MIDJOURNEY_SETTINGS = {
  flags: '--style raw --v 6.1 --ar 3:4 --no cartoon,anime,3D',
}

// ──────────────────────────────────────────────────
// 技师角色提示词
// ──────────────────────────────────────────────────

/**
 * 技师角色列表
 * 每个角色需要：独特发型 + 1件标志性服装 + 1个配饰 + 1个表情
 */

// ─── 高级足疗技师·女 ────────────────────────────
export const TECH_FEMALE_SENIOR = {
  name: '高级足疗技师·女',
  level: '高级',
  specialty: '足底穴位按摩 · 经络推拿',
  prompt: `${FEMALE_FACE}
30岁温柔微笑，长发微卷+空气刘海，
浅紫色真丝按摩袍搭配黑色打底衫，
黑色宽松按摩长裤，
白色细链项链，
双手交叠放在身前呈待命姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 高级足疗技师·男 ────────────────────────────
export const TECH_MALE_SENIOR = {
  name: '高级足疗技师·男',
  level: '高级',
  specialty: '深度足疗 · 经络推拿',
  prompt: `${MALE_FACE}
35岁沉稳自信，短发平头，
深蓝色亚麻按摩衬衫卷起袖子，
深灰色休闲长裤，
银色简约手表，
双手背于身后呈自信站姿，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 中级技师·女 ────────────────────────────────
export const TECH_FEMALE_MID = {
  name: '中级技师·女',
  level: '中级',
  specialty: '精油SPA · 足浴+按摩',
  prompt: `${FEMALE_FACE}
26岁知性优雅，长发微卷+法式刘海，
奶白色粗针开衫搭配白色内搭，
浅色休闲长裤，
木质串珠手链，
捧手微笑呈热情接待姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 中级技师·男 ────────────────────────────────
export const TECH_MALE_MID = {
  name: '中级技师·男',
  level: '中级',
  specialty: '足浴 · 基础推拿',
  prompt: `${MALE_FACE}
28岁阳光开朗，短寸头，
浅灰色棉麻短袖衬衫，
深蓝色休闲裤，
黑色皮质表带手表，
自然站立右手微微抬起，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 初级技师·女 ────────────────────────────────
export const TECH_FEMALE_JUNIOR = {
  name: '初级技师·女',
  level: '初级',
  specialty: '足底按摩 · 热石SPA',
  prompt: `${FEMALE_FACE}
24岁甜美可人，高马尾辫+空气刘海，
淡粉色短袖针织衫，
白色百褶短裙，
珍珠耳钉，
双手自然下垂面带微笑，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 初级技师·男 ────────────────────────────────
export const TECH_MALE_JUNIOR = {
  name: '初级技师·男',
  level: '初级',
  specialty: '足浴 · 基本护理',
  prompt: `${MALE_FACE}
23岁年轻朝气短发，
白色圆领T恤，
深蓝色工装短裤，
帆布腰带，
双手插兜轻松站姿，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 技师长·女 ──────────────────────────────────
export const TECH_FEMALE_MASTER = {
  name: '技师长·女',
  level: '技师长',
  specialty: '经络调理 · 特色手法',
  prompt: `${FEMALE_FACE}
40岁知性优雅，锁骨发+珍珠发卡，
深紫色缎面旗袍式按摩服，
黑色丝绒披肩，
翡翠耳环，
手持按摩工具呈讲解姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 技师长·男 ──────────────────────────────────
export const TECH_MALE_MASTER = {
  name: '技师长·男',
  level: '技师长',
  specialty: '高级经络推拿 · 团队管理',
  prompt: `${MALE_FACE}
45岁资深权威，短发梳背，
白色中式立领按摩上衣，
黑色西裤，
金属袖扣，
双手交叉胸前呈权威姿态，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 特色技师·精油SPA·女 ────────────────────────
export const TECH_FEMALE_AROMATHERAPY = {
  name: '精油SPA技师·女',
  level: '高级',
  specialty: '精油SPA · 芳疗',
  prompt: `${FEMALE_FACE}
28岁气质出众，长发自然披散+微卷，
白色宽松亚麻长袍搭配草编腰带，
裸色凉鞋，
干花发饰，
双手捧精油瓶呈展示姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm natural lighting',
}

// ─── 特色技师·足浴·男 ───────────────────────────
export const TECH_MALE_FOOTSPA = {
  name: '足浴技师·男',
  level: '中级',
  specialty: '足浴 · 中式推拿',
  prompt: `${MALE_FACE}
32岁踏实可靠，短发偏分，
蓝色中式对襟按摩服，
黑色长裤，
黑色布鞋，
端托盘呈服务姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm traditional lighting',
}

// ──────────────────────────────────────────────────
// 批量生成配置
// ──────────────────────────────────────────────────

/**
 * 所有技师提示词列表
 * 按 level 和 gender 排列，生成后按需选择
 */
export const TECH_PROMPTS = [
  TECH_FEMALE_SENIOR,
  TECH_MALE_SENIOR,
  TECH_FEMALE_MID,
  TECH_MALE_MID,
  TECH_FEMALE_JUNIOR,
  TECH_MALE_JUNIOR,
  TECH_FEMALE_MASTER,
  TECH_MALE_MASTER,
  TECH_FEMALE_AROMATHERAPY,
  TECH_MALE_FOOTSPA,
]

// ──────────────────────────────────────────────────
// 使用说明
// ──────────────────────────────────────────────────

/*
1. 复制每个 prompt 字符串到 即梦/可灵
2. 设置：风格「写实」/「高清人像」，比例 3:4
3. 生成4张，选最佳面部
4. 如果面部不满意 → 减少服装/配饰描述，重新生成
5. 如果特定细节不对 → 只添加那个细节
6. 生成后下载图片 → 上传至服务器 → 存入 technicians.avatar 字段

即梦设置：
- 风格：写实
- 比例：3:4
- 负向提示词粘贴到负面提示词框

可灵设置：
- 风格：高清人像
- 比例：3:4

Midjourney设置：
--style raw --v 6.1 --ar 3:4 --no cartoon,anime,3D

每个角色差异化：
- 发型（最识别特征）
- 1件标志性服装
- 1个配饰
- 1个标志性动作/表情
*/
