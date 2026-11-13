import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT, readJson } from './util.js'
import { ratioText } from './ratios.js'

const EXCLUSIVE = readJson(path.join(PLUGIN_ROOT, 'styles', 'exclusive.json'), null)
const BUILTIN = readJson(path.join(PLUGIN_ROOT, 'styles', 'builtin.json'), [])

export function exclusiveProfile() {
  return EXCLUSIVE
}

export function allStyles(settings) {
  const custom = Array.isArray(settings?.customStyles) ? settings.customStyles : []
  const customStyles = custom.map((c) => {
    const pooled = (Array.isArray(c.layoutPool) && c.layoutPool.length) ? c.layoutPool : []
    const replicaLayout = c.replicaSource?.layoutId
    const layoutPool = (c.replica && replicaLayout)
      ? [replicaLayout, ...pooled.filter((x) => x !== replicaLayout)]
      : (pooled.length ? pooled : ['left-stack', 'vertical-duo', 'bottom-title', 'center-overlap', 'top-title', 'right-title', 'edge-poster', 'diagonal'])
    const refs = Array.isArray(c.references) ? c.references : []
    const isReplica = !!c.replica || (refs.length === 1 && !c.isSection)
    const hint = `${c.name || ''} ${c.tagline || ''} ${c.directive || ''} ${c.replicaSource?.titlePlacement || ''} ${(c.replicaSource?.styleTags || []).join(' ')}`
    const typography = { ...(c.typography && typeof c.typography === 'object' ? c.typography : {}) }
    if (/黑体|无衬线|sans|粗黑|综艺/i.test(hint)) typography.font = 'sans'
    else if (/宋体|衬线|serif/i.test(hint)) typography.font = 'serif'
    if (!typography.align) {
      if (/右置|标题在右|右侧标题|标题靠右/.test(hint)) typography.align = 'right'
      else if (/居中|标题居中/.test(hint)) typography.align = 'center'
    }
    const inferredVertical = /竖排|竖列|vertical/i.test(hint)
    return {
      id: c.id,
      name: c.name,
      tagline: c.tagline || (isReplica ? '从单张封面拆解的同款配方' : '自定义风格'),
      description: c.directive || '按你的描述自由设计。',
      layoutPool,
      palette: (Array.isArray(c.palette) && c.palette.length) ? c.palette : (EXCLUSIVE?.palette ? Object.values(EXCLUSIVE.palette) : []),
      grade: 'neutral',
      accent: 'none',
      prompt: c.prompt || c.directive || '',
      negativePrompt: c.negativePrompt || EXCLUSIVE?.negativePrompt || '',
      typography,
      layout: c.layout && typeof c.layout === 'object' ? c.layout : (c.replicaSource?.layout && typeof c.replicaSource.layout === 'object' ? c.replicaSource.layout : null),
      vertical: typeof c.vertical === 'boolean' ? c.vertical : (c.replicaSource?.vertical === true ? true : (c.replicaSource?.vertical === false ? false : (inferredVertical ? true : null))),
      references: refs,
      isCustom: true,
      isReplica,
      replicaSource: c.replicaSource || null,
    }
  })

  const sections = Array.isArray(settings?.sections) ? settings.sections : []
  const sectionStyles = sections
    .filter((sec) => sec && sec.enabled !== false && sec.learned && (sec.learned.stylePrompt || sec.learned.summary))
    .map((sec) => ({
      id: 'section:' + sec.id,
      name: '分区 · ' + sec.name,
      tagline: sec.learned.summary || (sec.name + '高播放封面风格'),
      description: sec.learned.summary || '',
      layoutPool: (sec.learned.layoutPool && sec.learned.layoutPool.length) ? sec.learned.layoutPool : ['left-stack', 'vertical-duo', 'bottom-title', 'center-overlap', 'top-title', 'right-title', 'edge-poster'],
      palette: sec.learned.palette || [],
      grade: 'neutral',
      accent: 'none',
      prompt: sec.learned.stylePrompt || sec.learned.summary || '',
      negativePrompt: EXCLUSIVE?.negativePrompt || '',
      typography: sec.learned.typography || {},
      isSection: true,
      sectionId: sec.id,
      sectionName: sec.name,
      sectionProfile: {
        summary: sec.learned.summary || '',
        visualDNA: sec.learned.visualDNA || [],
        titlePatterns: sec.learned.titlePatterns || [],
        coverTypes: sec.types || sec.learned.coverTypes || [],
      },
      isCustom: false,
    }))
  const builtin = (Array.isArray(BUILTIN) ? BUILTIN : []).map((s) => ({ ...s, isCustom: false }))
  const exclusive = EXCLUSIVE
    ? [{
        id: EXCLUSIVE.id,
        name: EXCLUSIVE.name,
        tagline: EXCLUSIVE.tagline,
        description: EXCLUSIVE.summary,
        layoutPool: (EXCLUSIVE.layoutRecipes || []).map((r) => r.id),
        palette: Object.values(EXCLUSIVE.palette || {}),
        grade: 'cool',
        accent: 'none',
        prompt: EXCLUSIVE.backgroundPrompt,
        negativePrompt: EXCLUSIVE.negativePrompt,
        typography: EXCLUSIVE.typography || {},
        isExclusive: true,
        isCustom: false,
      }]
    : []
  return [...exclusive, ...builtin, ...sectionStyles, ...customStyles]
}

export function getStyle(id, settings) {
  const list = allStyles(settings)
  return list.find((s) => s.id === id) || list[0] || null
}

export function getRecipe(id, settings) {
  const recipes = EXCLUSIVE?.layoutRecipes || []
  return recipes.find((r) => r.id === id) || recipes[0] || null
}

export function styleSummary(style) {
  if (!style) return ''
  return `${style.name}：${style.tagline || style.description || ''}`
}

function pickDistinct(items, count) {
  const out = []
  let i = 0
  while (out.length < count) {
    if (!items.length) return out
    out.push(items[i % items.length])
    i++
    if (i > count * 4) break
  }
  return out
}

export function chooseVariants(selectedStyles, count, settings) {
  const styles = (Array.isArray(selectedStyles) && selectedStyles.length
    ? selectedStyles
    : ['exclusive'])
    .map((id) => getStyle(id, settings))
    .filter(Boolean)
  const pickedStyles = styles.length ? styles : [getStyle('exclusive', settings)]
  const layoutsUsed = new Set()
  const out = []
  for (let i = 0; i < count; i++) {
    const style = pickedStyles[i % pickedStyles.length]
    const pool = (style.layoutPool && style.layoutPool.length ? style.layoutPool : ['left-stack'])
    let layoutId = pool.find((id) => !layoutsUsed.has(id)) || pool[i % pool.length]
    // 同一版式重复时，用不同标题方向/遮罩做区分
    if (layoutsUsed.has(layoutId)) {
      const rec = getRecipe(layoutId, settings)
      if (rec) layoutId = rec.id
    }
    layoutsUsed.add(layoutId)
    out.push({ style, layoutId })
  }
  return out
}

function refBlock(references, baseReferenceId) {
  if (!Array.isArray(references) || !references.length) return '（没有参考图分析）'
  return references.map((r, i) => {
    const a = r.analysis || {}
    const base = baseReferenceId && r.id === baseReferenceId
    return `${base ? '【底图 / 最高优先级】' : ''}参考图 ${i + 1}「${r.name || '未命名'}」：\n${JSON.stringify({
      summary: a.baseSummary || a.summary || a.description || '',
      subject: a.subject || '',
      composition: a.composition || '',
      titlePlacement: a.titlePlacement || '',
      typography: a.typography || '',
      palette: a.palette || '',
      usableFor: a.usableFor || '',
      preserve: a.preserve || '',
    }, null, 2)}`
  }).join('\n\n')
}

export function buildPlannerPrompt({
  brief,
  title,
  subtitle,
  selectedStyles,
  count,
  ratio,
  references,
  customStyle,
  documentText,
  settings,
  baseReferenceId,
  baseAnalysis,
  manualContext,
}) {
  const ex = EXCLUSIVE || {}
  const styleList = chooseVariants(selectedStyles, count, settings)
  const styles = allStyles(settings)
  const selected = styleList.map(({ style, layoutId }) => {
    const recipe = (ex.layoutRecipes || []).find((r) => r.id === layoutId)
    return {
      styleId: style.id,
      styleName: style.name,
      stylePrompt: style.prompt,
      sectionProfile: style.sectionProfile || null,
      layoutId,
      layoutName: recipe?.name,
      layoutHint: recipe?.description,
    }
  })
  const system = [
    '你是一位资深视频封面美术指导 + 中文标题排版师，正在为一位个人 UP 主设计视频封面。',
    '你只输出严格的 JSON，不输出 Markdown、解释或代码围栏。',
    '你的任务不是写一段生图提示词，而是给出 N 个真正不同的封面方案：每个方案有自己的版式、标题位置、字号、颜色、背景处理和生图提示词。',
    '所有中文标题都由本地排版引擎用思源宋体 Heavy 写入，生图模型只负责无字背景，绝对不要让生图模型写任何文字。',
    '用户给出的主标题和副标题必须原样保留；只有用户没给时才由你提出。',
    '多张封面共用同一组主/副标题，差异只在版式和氛围，不要给每张换标题。',
    '标题是画面主体，必须大；优先 1-2 行，最多 3 行；副标题最多 2 行，要清楚可读。',
    '不要红色横线、编号、集数、年份、英文小字、底部说明和版权字。',
    '不要拼贴、双曝光、证物板、分屏、网格、贴纸和素材堆叠。',
    '每张方案必须指定不同的 layoutId；如果版式池不够，就改变标题位置、对齐、遮罩方向、字号和颜色。',
    '标题颜色根据背景明暗自动选择：深底用暖白，浅底用近黑；如果背景复杂，优先把标题放在干净的负空间，并给文字留出足够的明暗对比。',
    '任何画幅都不要拉伸原图；竖屏、方形、超宽画幅必须重新构图或扩图，背景提示词要按目标画幅描述留白方向。',
    baseReferenceId
      ? '用户指定了底图。底图是唯一权威画面：必须保留底图里的主体身份、脸、服装、姿势、构图和光影。不要换成别的角色，不要重画场景；差异只放在标题位置、字号、裁切和轻微色调上。所有 backgroundPrompt 都要写成“基于底图编辑”的指令，而不是重新生成一张无关画面。'
      : '',
  ].filter(Boolean).join('\n')

  const user = `
# 用户需求
${brief?.trim() || '（未填写，按标题和参考图发挥）'}

# 主标题
${title?.trim() || '（未指定，请提出一个，最多 14 个汉字）'}

# 副标题
${subtitle?.trim() || '（未指定，请提出一句，最多 24 个汉字）'}

# 画幅与数量
画幅：${ratio}（${ratioText(ratio)}）；数量：${count} 张。

# 选中的风格
${JSON.stringify(selected, null, 2)}

# 自定义风格描述
${customStyle?.trim() || '（未填写）'}

# 文档内容（如果用户拖入了文档）
${documentText?.trim() ? String(documentText).slice(0, 8000) : '（没有文档）'}

# 用户的设计原则（必须遵守）
${(ex.principles || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}

# 字体与版式约束
${JSON.stringify(ex.typography || {}, null, 2)}

# 版式配方（layoutId 必须从此表选择，或使用所选风格 layoutPool 中的 id）
${JSON.stringify((ex.layoutRecipes || []).map((r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  titleBox: r.titleBox,
  subtitleBox: r.subtitleBox,
  vertical: r.vertical,
  gradient: r.gradient,
})), null, 2)}

# 参考图分析
${refBlock(references, baseReferenceId)}

# 底图（最高优先级）
${baseReferenceId ? `用户明确指定了一张底图。底图分析：${JSON.stringify(baseAnalysis || {}, null, 2)}
所有方案都必须从这张底图出发：保留人物/主体、服装、姿势、构图和光影；只允许去掉文字/Logo/水印、按画幅扩图、调整裁切和轻微色调。不要生成另一套人物或场景。` : '（用户没有指定底图，可以按参考图和主题重新构图）'}

# 用户手动稿上下文
${manualContext && manualContext.layers?.length ? `用户刚在手动画布里做好了构图，下面是可读的图层信息。请保留它的视觉层级和主体位置，在此基础上重排文字和细节，不要把用户做的东西全部推翻：
${JSON.stringify(manualContext, null, 2)}` : '（没有手动稿）'}

# 背景生图提示词要求
- 保留官方人物，不重画、不新增角色。
- 清除原图所有文字、Logo、版权字、水印、集数、字幕。
- 按 ${ratio}（${ratioText(ratio)}）重新构图或扩图，用一致的天空/背景/光影补齐。
- 为标题留出干净、连贯的负空间，用自然暗部而不是纯色色块。
- 画面中绝对不能出现文字、字母、数字、标志。
- 每张的背景提示词必须不同：改变构图、留白方向、光线、时间、天气或色调。

# 输出 JSON 结构
{
  "coverBrief": "一句话总结这组封面的方向",
  "variants": [
    {
      "id": "v1",
      "styleId": "从选中风格里选",
      "layoutId": "从版式表/风格池里选",
      "title": "主标题（原样）",
      "subtitle": "副标题（原样）",
      "ratio": "${ratio}",
      "vertical": false,
      "titleColor": "auto",
      "palette": ["#0B0F14", "#F7F3EA"],
      "backgroundPrompt": "给生图模型的中文/英文提示词，必须无字、保留官方人物、扩展画幅、留出标题负空间",
      "negativePrompt": "英文负向提示词",
      "typography": {
        "titleSize": 0.118,
        "titleTracking": 0.025,
        "titleLineHeight": 1.02,
        "subtitleSize": 0.032,
        "align": "left"
      },
      "layout": {
        "titleX": 0.055, "titleY": 0.26, "titleW": 0.52, "titleH": 0.36,
        "subtitleX": 0.062, "subtitleY": 0.715, "subtitleW": 0.44, "subtitleH": 0.15,
        "gradient": "left", "subtitleBar": true, "overlap": false
      },
      "notes": "这张为什么这样设计，一句话"
    }
  ]
}
只输出 JSON，不要输出其他内容。`.trim()

  return { system, user, selected }
}

export function normalizeVariant(variant, fallback) {
  const v = variant && typeof variant === 'object' ? variant : {}
  const f = fallback || {}
  const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d)
  const str = (x, d) => (typeof x === 'string' && x.trim() ? x.trim() : d)
  const layout = v.layout && typeof v.layout === 'object' ? v.layout : {}
  const typo = v.typography && typeof v.typography === 'object' ? v.typography : {}
  const title = str(v.title, f.title || '')
  const subtitle = str(v.subtitle, f.subtitle || '')
  return {
    id: str(v.id, f.id || 'v1'),
    styleId: str(v.styleId, f.styleId || 'exclusive'),
    layoutId: str(v.layoutId, f.layoutId || 'left-stack'),
    title,
    subtitle,
    ratio: str(v.ratio, f.ratio || '16:9'),
    vertical: typeof v.vertical === 'boolean' ? v.vertical : !!f.vertical,
    titleColor: str(v.titleColor, 'auto'),
    palette: Array.isArray(v.palette) ? v.palette.slice(0, 6).map(String) : (f.palette || []),
    backgroundPrompt: str(v.backgroundPrompt, f.backgroundPrompt || ''),
    negativePrompt: str(v.negativePrompt, f.negativePrompt || ''),
    typography: {
      titleSize: num(typo.titleSize, f.titleSize || 0.11),
      titleTracking: num(typo.titleTracking, 0.025),
      titleLineHeight: num(typo.titleLineHeight, 1.02),
      subtitleSize: num(typo.subtitleSize, 0.03),
      align: str(typo.align, f.align || 'left'),
    },
    layout: {
      titleX: num(layout.titleX, f.titleX ?? 0.055),
      titleY: num(layout.titleY, f.titleY ?? 0.26),
      titleW: num(layout.titleW, f.titleW ?? 0.52),
      titleH: num(layout.titleH, f.titleH ?? 0.36),
      subtitleX: num(layout.subtitleX, f.subtitleX ?? 0.062),
      subtitleY: num(layout.subtitleY, f.subtitleY ?? 0.715),
      subtitleW: num(layout.subtitleW, f.subtitleW ?? 0.44),
      subtitleH: num(layout.subtitleH, f.subtitleH ?? 0.15),
      gradient: str(layout.gradient, f.gradient || 'left'),
      subtitleBar: typeof layout.subtitleBar === 'boolean' ? layout.subtitleBar : !!f.subtitleBar,
      overlap: typeof layout.overlap === 'boolean' ? layout.overlap : !!f.overlap,
    },
    notes: str(v.notes, ''),
  }
}

export function deterministicPlan({
  brief,
  title,
  subtitle,
  selectedStyles,
  count,
  ratio,
  references,
  customStyle,
  settings,
  baseReferenceId,
  manualContext,
}) {
  const ex = EXCLUSIVE || {}
  const chosen = chooseVariants(selectedStyles, count, settings)
  const baseTitle = title?.trim() || '未命名封面'
  const baseSubtitle = subtitle?.trim() || ''
  const variants = []
  const seenPrompts = new Set()
  for (let i = 0; i < count; i++) {
    const { style, layoutId } = chosen[i]
    const recipe = (ex.layoutRecipes || []).find((r) => r.id === layoutId) || (ex.layoutRecipes || [])[0] || {}
    const typo = style.typography && typeof style.typography === 'object' ? style.typography : {}
    const styleLayout = style.layout && typeof style.layout === 'object' ? style.layout : {}
    const vertical = typeof style.vertical === 'boolean' ? style.vertical : (typeof typo.vertical === 'boolean' ? typo.vertical : !!recipe.vertical)
    const side = recipe.align === 'right' ? '右侧' : (vertical ? '左侧竖排' : '左侧')
    const flavor = [
      '冷色调、低饱和、电影感',
      '暖色调、逆光、胶片颗粒',
      '黑蓝底、冷光、纪录片质感',
      '自然光、通透、干净留白',
      '黄昏、体积光、轻微雾气',
      '高对比、深色背景、人物边缘光',
    ][i % 6]
    let prompt = `${style.prompt || ex.backgroundPrompt || ''}\n${customStyle?.trim() ? `自定义方向：${customStyle.trim()}\n` : ''}${flavor}。为${side}的大标题留出干净、连贯的负空间，使用自然暗部或环境光过渡。画面中不要出现任何文字、字母、数字、标志。`
    if (baseReferenceId) {
      prompt = `以用户提供的底图为唯一画面来源：保留主体身份、脸、服装、姿势、构图与光影，移除所有文字/Logo/水印，只在必要时按目标画幅扩图并为${side}标题留出负空间。${flavor}。不要新造角色或换成无关场景。`
    } else if (manualContext && Array.isArray(manualContext.layers) && manualContext.layers.length) {
      prompt += ` 保留用户手动稿里的主体位置和视觉层级。`
    }
    if (seenPrompts.has(prompt)) prompt += ` 构图变化 ${i + 1}：改变人物在画面中的位置和光线方向。`
    seenPrompts.add(prompt)
    const ref = Array.isArray(references) && references[i % Math.max(1, references.length)]
    const refHint = ref?.analysis?.composition ? ` 参考图构图：${String(ref.analysis.composition).slice(0, 160)}。` : ''
    variants.push({
      id: `v${i + 1}`,
      styleId: style.id,
      layoutId,
      title: baseTitle,
      subtitle: baseSubtitle,
      ratio,
      vertical,
      titleColor: typo.titleColor || 'auto',
      palette: style.palette || [],
      backgroundPrompt: prompt + refHint,
      negativePrompt: style.negativePrompt || ex.negativePrompt || '',
      typography: {
        titleSize: Number(typo.titleSize) || Number(recipe.titleSize) || 0.11,
        titleTracking: Number(typo.titleTracking) || 0.025,
        titleLineHeight: Number(typo.titleLineHeight) || 1.02,
        subtitleSize: Number(typo.subtitleSize) || 0.03,
        align: typo.align || recipe.align || 'left',
        font: typo.font === 'sans' ? 'sans' : (typo.font === 'serif' ? 'serif' : ''),
        weight: Number(typo.weight) || 900,
        titleColor: typo.titleColor || 'auto',
        maxTitleLines: Math.max(1, Math.min(3, Number(typo.maxTitleLines || typo.titleLines) || 0)) || undefined,
        subtitleFont: typo.subtitleFont === 'serif' ? 'serif' : (typo.subtitleFont === 'sans' ? 'sans' : ''),
        scrim: typo.scrim === true,
        stroke: typo.stroke || '',
      },
      layout: {
        titleX: styleLayout.titleX ?? recipe.titleBox?.x ?? 0.055,
        titleY: styleLayout.titleY ?? recipe.titleBox?.y ?? 0.26,
        titleW: styleLayout.titleW ?? recipe.titleBox?.w ?? 0.52,
        titleH: styleLayout.titleH ?? recipe.titleBox?.h ?? 0.36,
        subtitleX: styleLayout.subtitleX ?? recipe.subtitleBox?.x ?? 0.062,
        subtitleY: styleLayout.subtitleY ?? recipe.subtitleBox?.y ?? 0.715,
        subtitleW: styleLayout.subtitleW ?? recipe.subtitleBox?.w ?? 0.44,
        subtitleH: styleLayout.subtitleH ?? recipe.subtitleBox?.h ?? 0.15,
        gradient: styleLayout.gradient || recipe.gradient || 'left',
        subtitleBar: styleLayout.subtitleBar !== undefined ? !!styleLayout.subtitleBar : !!recipe.subtitleBar,
        overlap: !!recipe.overlap,
      },
      notes: `自动方案：${style.name} / ${recipe.name || layoutId}`,
    })
  }
  return {
    coverBrief: brief?.trim() || `${baseTitle} 的封面方案`,
    variants,
  }
}
