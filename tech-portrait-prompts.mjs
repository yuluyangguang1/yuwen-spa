// 技师照片生成提示词 — 足韵 yuwen-spa 客户预览专用
//
// 使用方式：复制 prompt 到 即梦/可灵/Midjourney；negative 贴到负面提示词框
// 生成后上传静态资源，URL 存入 technicians.avatar
//
// 提示词结构（8 段，顺序固定）：
//   1 面部增强 → 2 年龄表情 → 3 发型 → 4 上装 → 5 下装
//   → 6 配饰 → 7 姿势场景 → 8 品质后缀
// 技巧：脸崩就砍 4-6 段；服装不对就只改 4-5；比例统一 3:4 竖图

// ──────────────────────────────────────────────────
// 面部增强模板
// ──────────────────────────────────────────────────
export const FEMALE_FACE = `商业级人像摄影，亚洲年轻女性，五官精致对称，
鹅蛋脸线条流畅，高挺鼻梁，饱满唇形，眉眼清亮有神，
皮肤白皙细腻有真实毛孔质感，睫毛根根分明，双眼皮，
面部光影立体柔和，镜头感强，高级模特脸，气质知性优雅`

export const MALE_FACE = `商业级人像摄影，亚洲年轻男性，五官立体帅气，
下颌线清晰，高挺鼻梁，剑眉星目，眼神沉稳有神，
皮肤干净有真实质感，短发利落，面部光影立体，
高级男模脸，阳光可靠气质`

// ──────────────────────────────────────────────────
// 品质后缀（通用，始终放最后）
// ──────────────────────────────────────────────────
export const QUALITY_SUFFIX = `全身构图，头到膝盖或全身入镜，
足浴SPA会所室内场景，暖色氛围灯与柔和筒光，
背景虚化散景光斑，浅景深，主体清晰锐利，
8K超高清，时尚杂志封面质感，真实摄影，竖版3:4`

// ──────────────────────────────────────────────────
// 负向提示词（通用）
// ──────────────────────────────────────────────────
export const NEGATIVE_PROMPT = `动漫，卡通，插画，3D渲染，塑料感，模糊，低清晰度，
手指变形，多余手指，六指，手部畸形，五官不对称，脸部崩坏，
文字，水印，logo，边框，裁切头顶，多人，畸形肢体，暴漏，内衣外穿`

// ──────────────────────────────────────────────────
// 平台参数
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
  flags: '--style raw --v 6.1 --ar 3:4 --no cartoon,anime,3D,text,watermark',
}

// ──────────────────────────────────────────────────
// 女性技师
// ──────────────────────────────────────────────────

// ─── 高级足疗技师·女 ────────────────────────────
export const TECH_FEMALE_SENIOR = {
  name: '高级足疗技师·女',
  level: '高级',
  specialty: '足底穴位按摩 · 经络推拿',
  prompt: `${FEMALE_FACE}
28岁，温柔自信微笑，露齿不夸张，
长发微卷披肩+法式空气刘海，
浅紫色真丝立领修身按摩上衣，长袖，中式盘扣细节，
黑色高腰束脚瑜伽长裤，软底黑色SPA工作鞋，
细银链项链+小巧耳钉，
站在足疗包间暖光下，双手轻叠于身前待命，体态挺拔，
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
25岁，知性亲和微笑，眼神明亮，
长发高丸子头+轻薄空气刘海，碎发自然，
奶白色修身针织开衫，V领，袖口微卷，
黑色高腰瑜伽长裤，软底黑色工作鞋，
木质串珠手链一只，
在接待区暖光中侧身站立，双手掌心向上呈欢迎姿势，
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
22岁，甜美开朗笑容，元气满满，
高马尾辫+额前碎发，
淡粉色短袖修身针织polo衫，小立领，
白色高腰直筒休闲长裤（非短裙），软底浅口工作鞋，
珍珠耳钉，
在明亮走廊自然站立，双手轻垂身侧，面向镜头微笑，
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
35岁，优雅从容浅笑，气场沉稳，
锁骨短发微内扣+珍珠发卡，
深紫色缎面立领修身旗袍式按摩服，长袖，盘扣，
黑色薄纱披肩搭肩，
翡翠小耳环+细金链，
在中式会客区暖光中侧身站立，一手持经络按摩棒呈讲解姿态，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 精油SPA技师·女 ────────────────────────────
export const TECH_FEMALE_AROMATHERAPY = {
  name: '精油SPA技师·女',
  level: '高级',
  specialty: '精油SPA · 芳疗',
  prompt: `${FEMALE_FACE}
27岁，恬静温柔微笑，眼神放松，
长发自然披散微卷，侧分，
白色宽松亚麻长袖罩衫，V领，草编细腰带束腰，
同色系米白宽松长裤，软底平底鞋，
干花发饰点缀发间，
在芳疗房暖柔光中，双手轻捧棕色精油小瓶于胸前呈展示姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm natural lighting',
}

// ──────────────────────────────────────────────────
// 男性技师
// ──────────────────────────────────────────────────

// ─── 高级足疗技师·男 ────────────────────────────
export const TECH_MALE_SENIOR = {
  name: '高级足疗技师·男',
  level: '高级',
  specialty: '深度足疗 · 经络推拿',
  prompt: `${MALE_FACE}
35岁，沉稳自信浅笑，可靠感，
利落短发，鬓角干净，
深蓝色亚麻立领按摩衬衫，袖口卷至小臂，
深灰色直筒休闲长裤，黑色软底皮鞋，
银色简约手表，
在包间暖光中挺拔站立，双手自然垂落或轻背于身后，面向镜头，
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
28岁，阳光开朗笑容，亲和力强，
清爽短寸头，
浅灰色棉麻短袖衬衫，小翻领，版型合身，
深蓝色直筒休闲长裤，深色休闲鞋，
黑色皮质表带手表，
在接待区自然站立，右手微抬呈招呼姿势，身体放松面向镜头，
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
23岁，朝气蓬勃笑容，年轻有活力，
清爽短发有层次感，
白色圆领纯棉T恤，合身不紧绷，
深蓝色工装直筒长裤（非短裤），帆布腰带，白色运动鞋，
在明亮大厅轻松站立，一手插兜一手自然下垂，面向镜头微笑，
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
45岁，资深权威神情，从容镇定，
短发梳理整洁微背头，鬓角修长，
白色中式立领盘扣按摩上衣，长袖，质感挺括，
黑色西裤，黑色皮鞋，
金属袖扣点缀，
在中式会客厅暖光中挺立，双臂自然环抱胸前呈管理姿态，目光直视镜头，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm spa lighting',
}

// ─── 足浴技师·男 ───────────────────────────────
export const TECH_MALE_FOOTSPA = {
  name: '足浴技师·男',
  level: '中级',
  specialty: '足浴 · 中式推拿',
  prompt: `${MALE_FACE}
32岁，踏实可靠微笑，服务感强，
短发偏分梳理整齐，
蓝色中式对襟盘扣按摩服，长袖，
黑色直筒长裤，黑色布鞋，
在足浴大厅暖光中端正站立，双手端木质托盘于身前呈服务姿势，
${QUALITY_SUFFIX}`,
  negative: NEGATIVE_PROMPT,
  avatarStyle: 'warm traditional lighting',
}

// ──────────────────────────────────────────────────
// 批量生成配置
// ──────────────────────────────────────────────────
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
// 一键导出纯文本（方便整段复制）
// ──────────────────────────────────────────────────
export function formatAllPrompts() {
  return TECH_PROMPTS.map((t, i) =>
    `【${i + 1}/10 ${t.name}】专长：${t.specialty}\n${t.prompt}\n---负面---\n${t.negative}`
  ).join('\n\n')
}

/*
使用说明
1. 复制 prompt → 即梦/可灵；negative → 负面提示词框
2. 即梦：风格「写实」，比例 3:4｜可灵：风格「高清人像」，比例 3:4
3. Midjourney：prompt + ` --style raw --v 6.1 --ar 3:4 --no cartoon,anime,3D,text,watermark`
4. 每角色生成 4 张选脸；脸崩删配饰/服装段；全身裁切就强调「全身构图」
5. 下载 → 上传服务器 → 写入 technicians.avatar

角色区分锚点（改一处即可换人设）：
女：紫衣卷发 / 白开衫丸子头 / 粉衫马尾 / 紫旗袍珍珠 / 白亚麻精油
男：深蓝卷袖 / 灰衬衫短寸 / 白T工装裤 / 中式立领权威 / 蓝对襟托盘
*/
