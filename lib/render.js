import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DSH_HOME, DATA_DIR, isWithin } from './util.js'
import { FONT_SANS, FONT_SERIF } from './settings.js'
import { exclusiveProfile, getStyle, getRecipe } from './styles.js'
import { targetSize, isPortrait, parseRatio } from './ratios.js'

export { targetSize }

let canvasMod = null
let registered = new Set()

export function loadCanvasModule() {
  if (canvasMod) return canvasMod
  const candidates = []
  if (process.env.DSH_PROFILE_DIR) candidates.push(path.join(process.env.DSH_PROFILE_DIR, 'package.json'))
  candidates.push(path.join(DSH_HOME, 'profiles', 'desktop', 'package.json'))
  candidates.push(path.join(DSH_HOME, 'profiles', 'node_modules', 'package.json'))
  for (const pkg of candidates) {
    try {
      const req = createRequire(pkg)
      canvasMod = req('@napi-rs/canvas')
      if (canvasMod?.createCanvas) return canvasMod
    } catch {}
  }
  try {
    const req = createRequire(import.meta.url)
    canvasMod = req('@napi-rs/canvas')
    if (canvasMod?.createCanvas) return canvasMod
  } catch {}
  throw new Error('找不到 @napi-rs/canvas。请确认 DSH 的 profile 已安装该依赖（当前 desktop profile 自带）。')
}

export function ensureFonts(settings) {
  const { GlobalFonts } = loadCanvasModule()
  const tryRegister = (file, family) => {
    if (!file || registered.has(file)) return
    try {
      if (!fs.existsSync(file)) return
      GlobalFonts.registerFromPath(file, family)
      registered.add(file)
    } catch {}
  }
  tryRegister(settings?.fontSerif || FONT_SERIF, 'CoverSerif')
  tryRegister(settings?.fontSans || FONT_SANS, 'CoverSans')
  for (const font of Array.isArray(settings?.customFonts) ? settings.customFonts : []) {
    if (font?.path && font?.family) tryRegister(font.path, font.family)
  }
  return { serif: settings?.fontSerif || FONT_SERIF, sans: settings?.fontSans || FONT_SANS }
}

export function fontString(size, family, weight = 400) {
  return `${weight} ${Math.max(8, Math.round(size))}px "${family}"`
}


export async function decodeImage(buffer) {
  const { loadImage } = loadCanvasModule()
  try {
    return await loadImage(buffer)
  } catch (err) {
    // AVIF/HEIC/TIFF 等 Skia 不支持的格式，尝试 DSH 自带的 sharp。
    try {
      const profile = process.env.DSH_PROFILE_DIR || path.join(DSH_HOME, 'profiles', 'desktop')
      const req = createRequire(path.join(profile, 'package.json'))
      const sharp = req('sharp')
      const png = await sharp(buffer).png().toBuffer()
      return await loadImage(png)
    } catch {}
    throw new Error(`无法读取图片：${err?.message || err}`)
  }
}

export async function imageMeta(buffer) {
  const img = await decodeImage(buffer)
  return { width: img.width, height: img.height }
}

export function normalizeUpload(buffer, settings) {
  const { createCanvas } = loadCanvasModule()
  return decodeImage(buffer).then((img) => {
    const max = 2400
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0B0F14'
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    return {
      png: canvas.toBuffer('image/png'),
      width: img.width,
      height: img.height,
      normalizedWidth: w,
      normalizedHeight: h,
    }
  })
}

export async function visionDataUrl(buffer, maxSide = 1400) {
  const { createCanvas } = loadCanvasModule()
  const img = await decodeImage(buffer)
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0B0F14'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const jpeg = canvas.toBuffer('image/jpeg', 0.86)
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width: img.width,
    height: img.height,
    sentWidth: w,
    sentHeight: h,
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function mix(a, b, t) {
  return a + (b - a) * t
}

function parseHex(hex) {
  const s = String(hex || '').replace('#', '')
  if (s.length === 3) return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) }
  if (s.length >= 6) return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) }
  return { r: 247, g: 243, b: 234 }
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function isAscii(ch) {
  return /[\x20-\x7E]/.test(ch)
}

const NO_LINE_START = new Set(Array.from('，。！？、；：）》」』】…—·,.!?;:)]}'))

function measure(ctx, text, tracking) {
  let w = 0
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) {
    w += ctx.measureText(chars[i]).width
    if (i < chars.length - 1) w += tracking
  }
  return w
}

export function wrapText(ctx, text, maxWidth, tracking) {
  const paragraphs = String(text ?? '').replace(/\r/g, '').split('\n')
  const lines = []
  for (const para of paragraphs) {
    if (!para) { lines.push(''); continue }
    const tokens = []
    let buf = ''
    for (const ch of Array.from(para)) {
      if (isAscii(ch) && ch !== ' ') {
        buf += ch
      } else {
        if (buf) { tokens.push(buf); buf = '' }
        tokens.push(ch)
      }
    }
    if (buf) tokens.push(buf)
    let line = ''
    for (const token of tokens) {
      const candidate = line + token
      if (line && measure(ctx, candidate, tracking) > maxWidth) {
        // 行首禁则：把标点留在上一行
        if (NO_LINE_START.has(token) && line.length > 1) {
          line = candidate
          continue
        }
        lines.push(line.trimEnd())
        line = token === ' ' ? '' : token
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line.trimEnd())
  }
  return lines.length ? lines : ['']
}

function fitHorizontal(ctx, text, box, baseSize, tracking, lineHeight, minSize, maxLines) {
  let size = Math.max(minSize, baseSize)
  for (let attempt = 0; attempt < 48; attempt++) {
    ctx.font = fontString(size, 'CoverSerif', 900)
    const lines = wrapText(ctx, text, box.w, tracking)
    const lineH = size * lineHeight
    const totalH = lines.length * lineH + Math.max(0, lines.length - 1) * 0
    const widest = Math.max(0, ...lines.map((l) => measure(ctx, l, tracking)))
    if (lines.length <= maxLines && totalH <= box.h + 1 && widest <= box.w + 1) {
      return { size, lines, lineH, totalH, widest }
    }
    if (size <= minSize) {
      return { size: minSize, lines: wrapText(ctx, text, box.w, tracking), lineH: minSize * lineHeight, totalH: wrapText(ctx, text, box.w, tracking).length * minSize * lineHeight, widest: 0 }
    }
    size *= 0.945
  }
  return { size, lines: wrapText(ctx, text, box.w, tracking), lineH: size * lineHeight, totalH: 0, widest: 0 }
}

function balanceTitle(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw.includes('\n')) return raw
  const chars = Array.from(raw)
  if (chars.length <= 5) return raw
  if (!/[\u3400-\u9fff]/.test(raw)) return raw
  const lines = chars.length <= 12 ? 2 : 3
  const per = Math.ceil(chars.length / lines)
  const parts = []
  for (let i = 0; i < chars.length; i += per) parts.push(chars.slice(i, i + per).join(''))
  for (let i = 1; i < parts.length; i++) {
    // 行首禁则：标点挪到上一行末尾
    while (parts[i] && NO_LINE_START.has(parts[i][0]) && parts[i - 1].length > 1) {
      parts[i - 1] += parts[i][0]
      parts[i] = parts[i].slice(1)
    }
  }
  return parts.filter(Boolean).join('\n')
}

function fitSubtitle(ctx, text, box, baseSize, tracking, lineHeight, minSize) {
  let size = Math.max(minSize, baseSize)
  for (let attempt = 0; attempt < 40; attempt++) {
    ctx.font = fontString(size, 'CoverSans', 500)
    const lines = wrapText(ctx, text, box.w, tracking)
    const widest = Math.max(0, ...lines.map((l) => measure(ctx, l, tracking)))
    if (lines.length <= 2 && widest <= box.w + 1) {
      return { size, lines, lineH: size * lineHeight, totalH: lines.length * size * lineHeight, widest }
    }
    if (size <= minSize) {
      const fallbackLines = wrapText(ctx, text, box.w, tracking)
      return { size: minSize, lines: fallbackLines, lineH: minSize * lineHeight, totalH: fallbackLines.length * minSize * lineHeight, widest: Math.max(0, ...fallbackLines.map((l) => measure(ctx, l, tracking))) }
    }
    size *= 0.95
  }
  const lines = wrapText(ctx, text, box.w, tracking)
  return { size, lines, lineH: size * lineHeight, totalH: lines.length * size * lineHeight, widest: 0 }
}

function fitVertical(ctx, text, box, baseSize, tracking, columns, lineHeight, minSize) {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ''))
  const colCount = columns === 2 ? 2 : 1
  const perCol = Math.ceil(chars.length / colCount)
  const cols = []
  for (let i = 0; i < colCount; i++) cols.push(chars.slice(i * perCol, (i + 1) * perCol).join(''))
  let size = Math.max(minSize, baseSize)
  for (let attempt = 0; attempt < 40; attempt++) {
    const colW = size * 1.02
    const gap = size * 0.18
    const totalW = colCount * colW + (colCount - 1) * gap
    const maxChars = Math.max(...cols.map((c) => Array.from(c).length), 1)
    const totalH = maxChars * size * lineHeight
    if (totalW <= box.w + 1 && totalH <= box.h + 1) {
      return { size, columns: cols, colW, gap, totalW, totalH }
    }
    if (size <= minSize) break
    size *= 0.94
  }
  const maxChars = Math.max(...cols.map((c) => Array.from(c).length), 1)
  return { size, columns: cols, colW: size * 1.02, gap: size * 0.18, totalW: colCount * size * 1.02 + (colCount - 1) * size * 0.18, totalH: maxChars * size * lineHeight }
}

function buildTitleLayer(variant, ratio, settings) {
  const { width, height } = targetSize(ratio)
  const portrait = isPortrait(ratio)
  const recipe = getRecipe(variant.layoutId, settings)
  const style = getStyle(variant.styleId, settings)
  const L = variant.layout || {}
  const box = {
    x: (L.titleX ?? recipe?.titleBox?.x ?? 0.055) * width,
    y: (L.titleY ?? recipe?.titleBox?.y ?? 0.26) * height,
    w: (L.titleW ?? recipe?.titleBox?.w ?? 0.52) * width,
    h: (L.titleH ?? recipe?.titleBox?.h ?? 0.36) * height,
  }
  if (parseRatio(ratio).id === '4:3') {
    box.w = Math.min(box.w, width * 0.58)
    box.h = Math.min(height * 0.62, box.h * 1.08)
  }
  if (portrait) {
    // 竖屏重新分配标题区：横向版式在 9:16 下会显得又窄又小
    box.x = Math.min(Math.max(box.x, width * 0.055), width * 0.1)
    box.w = Math.min(width * 0.9, Math.max(box.w, width * 0.78))
    box.h = Math.min(height * 0.54, Math.max(box.h, height * 0.3))
  }
  const vertical = typeof variant.vertical === 'boolean' ? variant.vertical : !!recipe?.vertical
  const typo = variant.typography || {}
  const baseSize = clamp(
    (typo.titleSize || recipe?.titleSize || 0.11) * width * (portrait ? 1.16 : 1),
    width * 0.065,
    width * (portrait ? 0.2 : 0.17),
  )
  const tracking = (typo.titleTracking ?? 0.025) * baseSize
  const lineHeight = typo.titleLineHeight ?? 1.02
  const minSize = width * 0.055
  const titleFont = typo.font === 'sans' || typo.fontFamily === 'CoverSans' ? 'CoverSans' : 'CoverSerif'
  const titleWeight = Math.max(400, Math.min(900, Number(typo.weight) || 900))
  const explicitColor = typo.titleColor && typo.titleColor !== 'auto' ? typo.titleColor : null
  const layer = {
    id: `title-${variant.id || 'v1'}`,
    type: vertical ? 'vertical-text' : 'text',
    role: 'title',
    text: vertical ? (variant.title || '') : balanceTitle(variant.title || ''),
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    fontSize: Math.round(baseSize),
    fontFamily: titleFont,
    fontWeight: titleWeight,
    color: explicitColor,
    align: typo.align || recipe?.align || 'left',
    tracking: Math.round(tracking * 100) / 100,
    lineHeight,
    opacity: 1,
    angle: 0,
    vertical,
    columns: null,
    maxLines: Math.max(1, Math.min(3, Number(typo.maxTitleLines || typo.titleLines) || exclusiveProfile()?.typography?.maxTitleLines || 3)),
    subtitleBar: false,
    scrim: typo.scrim === true,
    stroke: typo.stroke || '',
  }
  return { layer, box, tracking, lineHeight, minSize, baseSize, vertical }
}

function splitSubtitle(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  if (raw.includes('\n')) return raw
  const chars = Array.from(raw)
  // 优先在逗号/顿号处断成两行，像参考图那样自然
  const breaks = []
  for (let i = 0; i < chars.length; i++) {
    if ('，,、；;'.includes(chars[i])) breaks.push(i)
  }
  if (breaks.length) {
    const mid = chars.length / 2
    const idx = breaks.reduce((best, cur) => (Math.abs(cur - mid) < Math.abs(best - mid) ? cur : best), breaks[0])
    const left = chars.slice(0, idx + 1).join('').trim()
    const right = chars.slice(idx + 1).join('').trim()
    if (left.length >= 4 && right.length >= 4) return `${left}\n${right}`
  }
  if (chars.length >= 16 && chars.length <= 34) {
    const mid = Math.floor(chars.length / 2)
    let cut = mid
    while (cut < chars.length - 4 && '，,、；;。！？'.includes(chars[cut])) cut++
    const left = chars.slice(0, cut).join('').trim()
    const right = chars.slice(cut).join('').trim()
    if (left.length >= 4 && right.length >= 4) return `${left}\n${right}`
  }
  return raw
}

function buildSubtitleLayer(variant, ratio, settings) {
  const { width, height } = targetSize(ratio)
  const portrait = isPortrait(ratio)
  const recipe = getRecipe(variant.layoutId, settings)
  const L = variant.layout || {}
  const box = {
    x: (L.subtitleX ?? recipe?.subtitleBox?.x ?? 0.062) * width,
    y: (L.subtitleY ?? recipe?.subtitleBox?.y ?? 0.715) * height,
    w: (L.subtitleW ?? recipe?.subtitleBox?.w ?? 0.44) * width,
    h: (L.subtitleH ?? recipe?.subtitleBox?.h ?? 0.15) * height,
  }
  if (parseRatio(ratio).id === '4:3') box.w = Math.min(box.w, width * 0.62)
  if (portrait) {
    box.x = Math.min(Math.max(box.x, width * 0.06), width * 0.1)
    box.w = Math.min(width * 0.9, Math.max(box.w, width * 0.78))
  }
  const typo = variant.typography || {}
  const baseSize = clamp((typo.subtitleSize || 0.03) * width * (portrait ? 1.08 : 1), width * 0.018, width * 0.045)
  const tracking = baseSize * 0.02
  const lineHeight = 1.5
  const explicitColor = typo.subtitleColor && typo.subtitleColor !== 'auto' ? typo.subtitleColor : null
  return {
    layer: {
      id: `subtitle-${variant.id || 'v1'}`,
      type: 'text',
      role: 'subtitle',
      text: splitSubtitle(variant.subtitle),
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.w),
      h: Math.round(box.h),
      fontSize: Math.round(baseSize),
      fontFamily: typo.subtitleFont === 'serif' ? 'CoverSerif' : 'CoverSans',
      fontWeight: 500,
      color: explicitColor,
      align: typo.align === 'right' ? 'right' : (typo.align === 'center' ? 'center' : 'left'),
      tracking: Math.round(tracking * 100) / 100,
      lineHeight,
      opacity: 1,
      angle: 0,
      vertical: false,
      maxLines: 2,
      subtitleBar: !!L.subtitleBar,
    },
    box,
    tracking,
    lineHeight,
  }
}

export function buildTextLayers(variant, ratio, settings) {
  const { width, height } = targetSize(ratio)
  const { layer: title, box: titleBox, tracking: titleTracking, lineHeight: titleLH, minSize, baseSize, vertical } = buildTitleLayer(variant, ratio, settings)
  const { layer: subtitle, box: subBox } = buildSubtitleLayer(variant, ratio, settings)
  const { ctx } = scratchContext()
  ctx.fillStyle = '#fff'
  let titleResult
  if (vertical) {
    titleResult = fitVertical(ctx, title.text, titleBox, baseSize, titleTracking, exclusiveProfile()?.layoutRecipes?.find((r) => r.id === variant.layoutId)?.verticalColumns || 2, titleLH, minSize)
    title.fontSize = Math.round(titleResult.size)
    title.columns = titleResult.columns
    title.colW = Math.round(titleResult.colW)
    title.columnGap = Math.round(titleResult.gap)
    title.textW = Math.round(titleResult.totalW)
    title.textH = Math.round(titleResult.totalH)
  } else {
    const res = fitHorizontal(ctx, title.text, titleBox, baseSize, titleTracking, titleLH, minSize, title.maxLines)
    title.fontSize = Math.round(res.size)
    title.lines = res.lines
    title.textW = Math.round(res.widest)
    title.textH = Math.round(res.totalH)
  }
  const subRes = fitSubtitle(ctx, subtitle.text, subBox, subtitle.fontSize, subtitle.tracking, subtitle.lineHeight, width * 0.021)
  subtitle.fontSize = Math.round(subRes.size)
  subtitle.lines = subRes.lines
  subtitle.textW = Math.round(subRes.widest)
  subtitle.textH = Math.round(subRes.totalH)
  const layers = [title, subtitle].filter((l) => l.text && String(l.text).trim())
  return { layers, width, height }
}

let scratch = null
function scratchContext() {
  if (scratch) return scratch
  const { createCanvas } = loadCanvasModule()
  const canvas = createCanvas(16, 16)
  scratch = { canvas, ctx: canvas.getContext('2d') }
  return scratch
}

function sampleLuminance(ctx, x, y, w, h) {
  const step = Math.max(8, Math.floor(Math.min(w, h) / 12))
  let sum = 0
  let n = 0
  try {
    const data = ctx.getImageData(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))).data
    const stride = 4 * step
    for (let i = 0; i < data.length; i += stride) {
      sum += luminance(data[i], data[i + 1], data[i + 2])
      n++
    }
  } catch {}
  return n ? sum / n : 0.4
}

function drawTracked(ctx, text, x, y, font, size, tracking, color, alignWidth = 0, align = 'left', stroke = null) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  const w = measure(ctx, text, tracking)
  let cx = x
  if (align === 'center') cx = x + (alignWidth - w) / 2
  else if (align === 'right') cx = x + alignWidth - w
  if (stroke && stroke.width > 0) {
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
  }
  for (const ch of Array.from(text)) {
    if (stroke && stroke.width > 0) ctx.strokeText(ch, cx, y)
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + tracking
  }
  return w
}

function contrastRatio(lumA, lumB) {
  const a = lumA <= 0.03928 ? lumA / 12.92 : Math.pow((lumA + 0.055) / 1.055, 2.4)
  const b = lumB <= 0.03928 ? lumB / 12.92 : Math.pow((lumB + 0.055) / 1.055, 2.4)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

function drawTextScrim(ctx, layer, lightText, width) {
  if (layer.scrim === false) return
  const textH = Math.max(layer.fontSize || 12, layer.textH || layer.fontSize || 12)
  const padX = Math.max(14, (layer.fontSize || 12) * 0.22)
  const padY = Math.max(10, (layer.fontSize || 12) * 0.18)
  const w = Math.min(width - Math.max(0, layer.x) + padX, (layer.textW || layer.w || width * 0.4) + padX * 2)
  const h = textH + padY * 2
  const y = (layer.y || 0) + Math.max(0, ((layer.h || 0) - textH) / 2) - padY
  const x = Math.max(0, (layer.x || 0) - padX)
  const isTitle = layer.role === 'title'
  const strength = layer.scrimStrength ?? (isTitle ? 0.42 : 0.46)
  const color = lightText
    ? `rgba(3,8,14,${strength})`
    : `rgba(250,247,240,${Math.min(0.78, strength + 0.12)})`
  const clear = lightText ? 'rgba(3,8,14,0)' : 'rgba(250,247,240,0)'
  const cx = x + w / 2
  const cy = y + h / 2
  const radius = Math.max(w, h) * 0.74
  ctx.save()
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.1, cx, cy, radius)
  g.addColorStop(0, color)
  g.addColorStop(0.58, color.replace(/[\d.]+\)$/, `${strength * 0.55})`))
  g.addColorStop(1, clear)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

function drawTextLayer(ctx, layer, canvasWidth) {
  if (!layer.text) return
  const color = layer.color || '#F7F3EA'
  const isLight = luminance(...Object.values(parseHex(color)))
  const shadowColor = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.35)'
  ctx.save()
  ctx.globalAlpha = layer.opacity ?? 1
  ctx.shadowColor = layer.shadow === false ? 'transparent' : shadowColor
  ctx.shadowBlur = layer.role === 'title' ? Math.max(8, layer.fontSize * 0.13) : Math.max(4, layer.fontSize * 0.08)
  ctx.shadowOffsetY = layer.role === 'title' ? Math.max(5, layer.fontSize * 0.04) : 2
  if (layer.angle) {
    const cx = layer.x + layer.w / 2
    const cy = layer.y + layer.h / 2
    ctx.translate(cx, cy)
    ctx.rotate((layer.angle * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }
  const font = fontString(layer.fontSize, layer.fontFamily || 'CoverSerif', layer.fontWeight || 900)
  ctx.font = font
  ctx.fillStyle = color
  const align = layer.align || 'left'
  const tracking = layer.tracking || 0
  const stroke = layer.strokeWidth > 0
    ? { width: layer.strokeWidth, color: layer.stroke || (isLight ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.5)') }
    : null
  if (layer.type === 'vertical-text' || layer.vertical) {
    const cols = Array.isArray(layer.columns) && layer.columns.length
      ? layer.columns
      : [layer.text]
    const colW = layer.colW || layer.fontSize * 1.02
    const gap = layer.columnGap || layer.fontSize * 0.18
    const totalW = cols.length * colW + (cols.length - 1) * gap
    let baseX = layer.x
    if (align === 'center') baseX = layer.x + (layer.w - totalW) / 2
    else if (align === 'right') baseX = layer.x + layer.w - totalW
    const maxChars = Math.max(...cols.map((c) => Array.from(c).length), 1)
    const totalH = maxChars * layer.fontSize * (layer.lineHeight || 1)
    let baseY = layer.y + layer.fontSize
    if (layer.h > totalH) baseY = layer.y + (layer.h - totalH) / 2 + layer.fontSize * 0.82
    for (let c = 0; c < cols.length; c++) {
      // 与参考图一致：第一列在左、第二列在右，读者按左→右读
      const colX = baseX + c * (colW + gap) + (colW - layer.fontSize) / 2
      const chars = Array.from(cols[c])
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        const chW = ctx.measureText(ch).width
        const cx = colX + (layer.fontSize * 1.0 - chW) / 2
        const cy = baseY + i * layer.fontSize * (layer.lineHeight || 1)
        if (stroke) {
          ctx.lineJoin = 'round'
          ctx.miterLimit = 2
          ctx.strokeStyle = stroke.color
          ctx.lineWidth = stroke.width
          ctx.strokeText(ch, cx, cy)
        }
        ctx.fillText(ch, cx, cy)
      }
    }
  } else {
    const lines = Array.isArray(layer.lines) && layer.lines.length
      ? layer.lines
      : wrapText(ctx, layer.text, layer.w, tracking)
    const lineH = layer.fontSize * (layer.lineHeight || 1.1)
    const totalH = lines.length * lineH
    let y = layer.y + layer.fontSize * 0.82
    if (layer.h > totalH) y = layer.y + (layer.h - totalH) / 2 + layer.fontSize * 0.82
    for (const line of lines) {
      drawTracked(ctx, line, layer.x, y, font, layer.fontSize, tracking, color, layer.w, align, stroke)
      y += lineH
    }
  }
  ctx.restore()
}

function drawShapeLayer(ctx, layer) {
  ctx.save()
  ctx.globalAlpha = layer.opacity ?? 1
  if (layer.angle) {
    const cx = (layer.x || 0) + (layer.w || 0) / 2
    const cy = (layer.y || 0) + (layer.h || 0) / 2
    ctx.translate(cx, cy)
    ctx.rotate((layer.angle * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }
  ctx.lineWidth = layer.strokeWidth || 2
  ctx.strokeStyle = layer.stroke || 'rgba(255,255,255,.8)'
  ctx.fillStyle = layer.fill || 'transparent'
  if (layer.type === 'rect') {
    if (layer.fill && layer.fill !== 'transparent') ctx.fillRect(layer.x, layer.y, layer.w, layer.h)
    if (layer.strokeWidth) ctx.strokeRect(layer.x, layer.y, layer.w, layer.h)
  } else if (layer.type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(layer.x + layer.w / 2, layer.y + layer.h / 2, Math.abs(layer.w / 2), Math.abs(layer.h / 2), 0, 0, Math.PI * 2)
    if (layer.fill && layer.fill !== 'transparent') ctx.fill()
    if (layer.strokeWidth) ctx.stroke()
  } else if (layer.type === 'line' || layer.type === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(layer.x1, layer.y1)
    ctx.lineTo(layer.x2, layer.y2)
    ctx.stroke()
    if (layer.type === 'arrow') {
      const angle = Math.atan2(layer.y2 - layer.y1, layer.x2 - layer.x1)
      const len = Math.max(14, (layer.strokeWidth || 3) * 5)
      ctx.beginPath()
      ctx.moveTo(layer.x2, layer.y2)
      ctx.lineTo(layer.x2 - len * Math.cos(angle - Math.PI / 7), layer.y2 - len * Math.sin(angle - Math.PI / 7))
      ctx.lineTo(layer.x2 - len * Math.cos(angle + Math.PI / 7), layer.y2 - len * Math.sin(angle + Math.PI / 7))
      ctx.closePath()
      ctx.fillStyle = layer.stroke || 'rgba(255,255,255,.8)'
      ctx.fill()
    }
  } else if (layer.type === 'path' && Array.isArray(layer.points) && layer.points.length > 1) {
    ctx.beginPath()
    ctx.moveTo(layer.points[0].x, layer.points[0].y)
    for (const p of layer.points.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
  ctx.restore()
}

function filterCss(filter) {
  if (!filter || typeof filter !== 'object') return ''
  const parts = []
  const add = (name, value, min, max, suffix = '') => {
    const n = Number(value)
    if (!Number.isFinite(n)) return
    parts.push(`${name}(${Math.min(max, Math.max(min, n))}${suffix})`)
  }
  if (filter.brightness !== undefined && Number(filter.brightness) !== 100) add('brightness', filter.brightness, 0, 300, '%')
  if (filter.contrast !== undefined && Number(filter.contrast) !== 100) add('contrast', filter.contrast, 0, 300, '%')
  if (filter.saturate !== undefined && Number(filter.saturate) !== 100) add('saturate', filter.saturate, 0, 300, '%')
  if (filter.blur !== undefined && Number(filter.blur) > 0) add('blur', filter.blur, 0, 30, 'px')
  return parts.join(' ')
}

async function drawImageLayer(ctx, layer) {
  if (!layer.src) return
  try {
    const { loadImage } = loadCanvasModule()
    let data = null
    if (String(layer.src).startsWith('data:')) {
      const base64 = String(layer.src).split(',')[1]
      data = Buffer.from(base64, 'base64')
    } else if (String(layer.src).startsWith('/dsh-cover-studio/files/')) {
      const file = path.join(DATA_DIR, String(layer.src).slice('/dsh-cover-studio/files/'.length))
      if (isWithin(DATA_DIR, file) && fs.existsSync(file)) data = fs.readFileSync(file)
    } else if (String(layer.src).startsWith('/')) {
      if (fs.existsSync(layer.src)) data = fs.readFileSync(layer.src)
    }
    if (!data) return
    const img = await loadImage(data)
    ctx.save()
    ctx.globalAlpha = layer.opacity ?? 1
    const f = filterCss(layer.filter)
    if (f) {
      try { ctx.filter = f } catch {}
    }
    if (layer.angle) {
      const cx = layer.x + layer.w / 2
      const cy = layer.y + layer.h / 2
      ctx.translate(cx, cy)
      ctx.rotate((layer.angle * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }
    ctx.drawImage(img, layer.x, layer.y, layer.w, layer.h)
    ctx.restore()
  } catch {}
}

function applyGrade(ctx, W, H, grade) {
  if (!grade || grade === 'none') return
  ctx.save()
  ctx.globalCompositeOperation = 'soft-light'
  if (grade === 'cool') {
    ctx.fillStyle = 'rgba(52, 120, 170, 0.34)'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(10, 24, 40, 0.18)'
    ctx.fillRect(0, 0, W, H)
  } else if (grade === 'warm') {
    ctx.fillStyle = 'rgba(206, 132, 72, 0.28)'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(80, 40, 18, 0.12)'
    ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = 'rgba(80, 90, 105, 0.12)'
    ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
}

function applyGradient(ctx, W, H, direction, titleBox) {
  const stops = []
  let grad
  if (direction === 'left') {
    grad = ctx.createLinearGradient(0, 0, W * 0.66, 0)
    stops.push(['rgba(4,9,15,0.92)', 0], ['rgba(4,9,15,0.55)', 0.42], ['rgba(4,9,15,0.12)', 0.72], ['rgba(4,9,15,0)', 1])
  } else if (direction === 'right') {
    grad = ctx.createLinearGradient(W, 0, W * 0.34, 0)
    stops.push(['rgba(4,9,15,0.92)', 0], ['rgba(4,9,15,0.55)', 0.42], ['rgba(4,9,15,0.12)', 0.72], ['rgba(4,9,15,0)', 1])
  } else if (direction === 'bottom') {
    grad = ctx.createLinearGradient(0, H, 0, H * 0.36)
    stops.push(['rgba(4,9,15,0.94)', 0], ['rgba(4,9,15,0.62)', 0.38], ['rgba(4,9,15,0.12)', 0.72], ['rgba(4,9,15,0)', 1])
  } else if (direction === 'top') {
    grad = ctx.createLinearGradient(0, 0, 0, H * 0.56)
    stops.push(['rgba(4,9,15,0.84)', 0], ['rgba(4,9,15,0.42)', 0.45], ['rgba(4,9,15,0)', 1])
  } else if (direction === 'diagonal') {
    grad = ctx.createLinearGradient(0, H, W * 0.68, 0)
    stops.push(['rgba(4,9,15,0.92)', 0], ['rgba(4,9,15,0.48)', 0.48], ['rgba(4,9,15,0)', 1])
  } else {
    return
  }
  for (const [color, pos] of stops) grad.addColorStop(pos, color)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
}

function applyGrain(ctx, W, H, amount = 5) {
  if (!amount) return
  const { createCanvas } = loadCanvasModule()
  const tile = createCanvas(256, 256)
  const tc = tile.getContext('2d')
  const data = tc.createImageData(256, 256)
  for (let i = 0; i < data.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v
    data.data[i + 3] = 255
  }
  tc.putImageData(data, 0, 0)
  ctx.save()
  ctx.globalAlpha = clamp(amount / 28, 0.06, 0.3)
  ctx.globalCompositeOperation = 'overlay'
  const pattern = ctx.createPattern(tile, 'repeat')
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

function applyVignette(ctx, W, H, strength = 0.16) {
  if (!strength) return
  const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, `rgba(0,0,0,${clamp(strength, 0, 0.5)})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
}

function applyAccent(ctx, style, titleLayer, W, H) {
  const accent = style?.accent
  if (!accent || accent === 'none') return
  const color = 'rgba(247,243,234,0.85)'
  if (accent === 'short-line') {
    const x = titleLayer.x
    const y = Math.max(12, titleLayer.y - 26)
    ctx.fillStyle = color
    ctx.fillRect(x, y, Math.max(46, W * 0.034), 3)
  } else if (accent === 'thin-bar') {
    const x = titleLayer.x - 22
    const y = titleLayer.y + 4
    ctx.fillStyle = color
    ctx.fillRect(x, y, 3, Math.min(H * 0.16, titleLayer.h * 0.55))
  }
}

function drawSubtitleBar(ctx, layer) {
  if (!layer.subtitleBar) return
  const y = layer.y + Math.max(0, (layer.h - layer.textH) / 2) + 2
  const h = Math.min(layer.textH || layer.h, layer.h)
  ctx.save()
  ctx.fillStyle = 'rgba(247,243,234,0.82)'
  ctx.fillRect(layer.x - 22, y, 3, Math.max(24, h))
  ctx.restore()
}

export async function renderCover({ backgroundBuffer, variant, ratio, settings, layers: providedLayers, backgroundRect, backgroundFilter, backgroundVisible = true, plain = false }) {
  ensureFonts(settings)
  const { createCanvas } = loadCanvasModule()
  const { width: W, height: H } = targetSize(ratio)
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#0B0F14'
  ctx.fillRect(0, 0, W, H)
  if (backgroundVisible !== false) {
    const bg = await decodeImage(backgroundBuffer)
    const bgFilter = filterCss(backgroundFilter)
    if (bgFilter) {
      try { ctx.filter = bgFilter } catch {}
    }
    const rect = backgroundRect && Number.isFinite(Number(backgroundRect.w)) && Number(backgroundRect.w) > 0
      ? {
          x: Number(backgroundRect.x) || 0,
          y: Number(backgroundRect.y) || 0,
          w: Number(backgroundRect.w),
          h: Number(backgroundRect.h),
        }
      : null
    if (rect) {
      ctx.drawImage(bg, rect.x, rect.y, rect.w, rect.h)
    } else {
      const scale = Math.max(W / bg.width, H / bg.height)
      const dw = bg.width * scale
      const dh = bg.height * scale
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh)
    }
    if (bgFilter) {
      try { ctx.filter = 'none' } catch {}
    }
  }

  const recipe = getRecipe(variant.layoutId, settings)
  const style = getStyle(variant.styleId, settings)
  if (!plain) {
    const grade = recipe?.grade || style?.grade || 'neutral'
    applyGrade(ctx, W, H, grade)
    applyGradient(ctx, W, H, variant.layout?.gradient || recipe?.gradient || 'left')
    applyGrain(ctx, W, H, recipe?.grain ?? 5)
    applyVignette(ctx, W, H, recipe?.vignette ?? 0.14)
  }

  const built = providedLayers
    ? { layers: providedLayers, width: W, height: H }
    : buildTextLayers(variant, ratio, settings)
  const layers = built.layers

  // 可读性：同一张封面的标题/副标题共用一个自动文字色，避免一深一浅。
  // 模板模式(plain)完全按拆解出的颜色/描边绘制，不做自动改色。
  if (!plain) {
    let commonAutoColor = null
    const titleAuto = layers.find((l) => l.role === 'title' && (l.type === 'text' || l.type === 'vertical-text') && (!l.color || l.color === 'auto'))
    if (titleAuto) {
      const lum = sampleLuminance(ctx, titleAuto.x, titleAuto.y, titleAuto.w, titleAuto.h)
      commonAutoColor = contrastRatio(0.91, lum) >= contrastRatio(0.015, lum) ? '#F7F3EA' : '#0B0F14'
    }
    for (const layer of layers) {
      if (layer.visible === false) continue
      if (layer.type !== 'text' && layer.type !== 'vertical-text') continue
      const explicit = layer.color && layer.color !== 'auto'
      const lum = sampleLuminance(ctx, layer.x, layer.y, layer.w, layer.h)
      if (!explicit) {
        if (layer.role === 'subtitle' && commonAutoColor) layer.color = commonAutoColor
        else {
          const whiteContrast = contrastRatio(0.91, lum)
          const inkContrast = contrastRatio(0.015, lum)
          layer.color = whiteContrast >= inkContrast ? '#F7F3EA' : '#0B0F14'
          if (layer.role === 'title') commonAutoColor = layer.color
        }
      }
      const colorLum = luminance(...Object.values(parseHex(layer.color || '#F7F3EA')))
      const contrast = contrastRatio(colorLum, lum)
      const lightText = colorLum > 0.52
      const isSubtitle = layer.role === 'subtitle'
      const wantsScrim = !explicit || contrast < 6.2 || isSubtitle
      if (wantsScrim && layer.scrim !== false) {
        layer.scrim = true
        layer.scrimStrength = contrast < 3.2
          ? (lightText ? 0.72 : 0.78)
          : (contrast < 4.5 ? (lightText ? 0.52 : 0.62) : (isSubtitle ? 0.34 : 0.24))
      }
      if (!explicit && contrast < 4.8 && !layer.strokeWidth) {
        layer.strokeWidth = Math.max(2, (layer.fontSize || 40) * (isSubtitle ? 0.022 : 0.012))
        layer.stroke = lightText ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.55)'
      }
      layer._lightText = lightText
    }
  } else {
    for (const layer of layers) {
      if (layer.type !== 'text' && layer.type !== 'vertical-text') continue
      if (!layer.color || layer.color === 'auto') layer.color = '#F7F3EA'
      const colorLum = luminance(...Object.values(parseHex(layer.color || '#F7F3EA')))
      layer._lightText = colorLum > 0.52
      if (layer.stroke && !layer.strokeWidth) layer.strokeWidth = Math.max(2, (layer.fontSize || 40) * 0.015)
    }
  }

  const titleLayer = layers.find((l) => l.role === 'title')
  if (titleLayer && !plain) applyAccent(ctx, style, titleLayer, W, H)

  for (const layer of layers) {
    if (layer.visible === false) continue
    if (layer.type === 'text' || layer.type === 'vertical-text') {
      if (layer.scrim) drawTextScrim(ctx, layer, layer._lightText, W)
      if (layer.role === 'subtitle') drawSubtitleBar(ctx, layer)
      drawTextLayer(ctx, layer, W)
    } else if (layer.type === 'image') {
      await drawImageLayer(ctx, layer)
    } else {
      drawShapeLayer(ctx, layer)
    }
  }

  const buffer = canvas.toBuffer('image/png')
  const thumbW = Math.min(W, 1440)
  const thumbH = Math.round((H / W) * thumbW)
  const thumbCanvas = createCanvas(thumbW, thumbH)
  const tctx = thumbCanvas.getContext('2d')
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(canvas, 0, 0, thumbW, thumbH)
  const thumb = thumbCanvas.toBuffer('image/jpeg', 0.9)
  return { buffer, thumb, width: W, height: H, layers, layout: variant.layout, recipeId: recipe?.id }
}

export async function saveCoverFiles(dir, baseName, buffer, thumb) {
  fs.mkdirSync(dir, { recursive: true })
  const png = path.join(dir, `${baseName}.png`)
  fs.writeFileSync(png, buffer)
  const jpg = path.join(dir, `${baseName}.jpg`)
  fs.writeFileSync(jpg, await pngToJpeg(buffer))
  let thumbPath = ''
  if (thumb) {
    thumbPath = path.join(dir, `${baseName}_thumb.jpg`)
    fs.writeFileSync(thumbPath, thumb)
  }
  return { png, jpg, thumb: thumbPath }
}

export function blankBackground(ratio) {
  const { createCanvas } = loadCanvasModule()
  const { width: W, height: H } = targetSize(ratio)
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#0B1622')
  g.addColorStop(0.55, '#153248')
  g.addColorStop(1, '#09111A')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const light = ctx.createRadialGradient(W * 0.68, H * 0.3, 0, W * 0.68, H * 0.3, Math.max(W, H) * 0.65)
  light.addColorStop(0, 'rgba(127,196,230,.18)')
  light.addColorStop(1, 'rgba(127,196,230,0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, W, H)
  applyVignette(ctx, W, H, 0.28)
  return canvas.toBuffer('image/png')
}

export async function fitBackground(buffer, ratio) {
  const { createCanvas } = loadCanvasModule()
  const { width: W, height: H } = targetSize(ratio)
  const img = await decodeImage(buffer)
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  const scale = Math.max(W / img.width, H / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
  return canvas.toBuffer('image/png')
}

export async function pngToJpeg(pngBuffer, quality = 0.94) {
  const { createCanvas, loadImage } = loadCanvasModule()
  const img = await loadImage(pngBuffer)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0B0F14'
  ctx.fillRect(0, 0, img.width, img.height)
  ctx.drawImage(img, 0, 0)
  return canvas.toBuffer('image/jpeg', quality)
}

export async function resizeToThumb(buffer, maxWidth = 1440) {
  const { createCanvas } = loadCanvasModule()
  const img = await decodeImage(buffer)
  const scale = Math.min(1, maxWidth / img.width)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toBuffer('image/jpeg', 0.92)
}

export { parseHex, luminance, clamp }

// 把原图按 contain 放进目标画幅，四周用同一张图的高斯模糊铺满。
// 不裁切、不拉伸，原图内容 100% 保留，作为中转站失败时的兜底。
export async function localReframeBuffer({ buffer, ratio }) {
  const { createCanvas } = loadCanvasModule()
  const { width: W, height: H } = targetSize(ratio)
  const img = await decodeImage(buffer)
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#0B0F14'
  ctx.fillRect(0, 0, W, H)
  const coverScale = Math.max(W / img.width, H / img.height)
  const cw = img.width * coverScale
  const ch = img.height * coverScale
  ctx.save()
  try { ctx.filter = `blur(${Math.max(10, Math.round(Math.max(W, H) * 0.022))}px) brightness(.62) saturate(.92)` } catch {}
  ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch)
  ctx.restore()
  const shade = ctx.createLinearGradient(0, 0, 0, H)
  shade.addColorStop(0, 'rgba(8,12,18,.18)')
  shade.addColorStop(1, 'rgba(8,12,18,.34)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, W, H)
  const fit = Math.min(W / img.width, H / img.height)
  const dw = Math.round(img.width * fit)
  const dh = Math.round(img.height * fit)
  const dx = Math.round((W - dw) / 2)
  const dy = Math.round((H - dh) / 2)
  ctx.drawImage(img, dx, dy, dw, dh)
  return {
    buffer: canvas.toBuffer('image/png'),
    width: W,
    height: H,
    originalRect: { x: dx, y: dy, w: dw, h: dh },
  }
}

// 用 AI 生成的新画幅做背景，把原图原样叠回中心，边缘柔化过渡。
// 这样扩图区由 AI 补全，原图主体/产品/场景一个像素都不会丢。
export async function overlayOriginalOnReframe({ aiBuffer, sourceBuffer, ratio }) {
  const { createCanvas } = loadCanvasModule()
  const { width: W, height: H } = targetSize(ratio)
  const ai = await decodeImage(aiBuffer)
  const src = await decodeImage(sourceBuffer)
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  const aiScale = Math.max(W / ai.width, H / ai.height)
  const aw = ai.width * aiScale
  const ah = ai.height * aiScale
  ctx.drawImage(ai, (W - aw) / 2, (H - ah) / 2, aw, ah)

  const fit = Math.min(W / src.width, H / src.height)
  const dw = Math.round(src.width * fit)
  const dh = Math.round(src.height * fit)
  const dx = Math.round((W - dw) / 2)
  const dy = Math.round((H - dh) / 2)

  const overlay = createCanvas(W, H)
  const octx = overlay.getContext('2d')
  octx.drawImage(src, dx, dy, dw, dh)

  const mask = createCanvas(W, H)
  const mctx = mask.getContext('2d')
  const feather = Math.max(10, Math.round(Math.max(W, H) * 0.012))
  mctx.fillStyle = '#FFFFFF'
  mctx.fillRect(dx - feather * 3, dy - feather * 3, dw + feather * 6, dh + feather * 6)
  const soft = createCanvas(W, H)
  const sctx = soft.getContext('2d')
  try { sctx.filter = `blur(${feather}px)` } catch {}
  sctx.drawImage(mask, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(soft, 0, 0)
  octx.globalCompositeOperation = 'source-over'
  ctx.drawImage(overlay, 0, 0)
  return {
    buffer: canvas.toBuffer('image/png'),
    width: W,
    height: H,
    originalRect: { x: dx, y: dy, w: dw, h: dh },
  }
}

// 用周围模糊背景盖掉原封面文字，保留人物/场景像素，供可编辑模板使用。
export async function cleanTextAreas({ buffer, boxes }) {
  const { createCanvas } = loadCanvasModule()
  const img = await decodeImage(buffer)
  const W = img.width
  const H = img.height
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0)
  const blur = createCanvas(W, H)
  const bctx = blur.getContext('2d')
  try { bctx.filter = 'blur(22px) saturate(.95)' } catch {}
  bctx.drawImage(img, 0, 0)
  const mask = createCanvas(W, H)
  const mctx = mask.getContext('2d')
  const feather = Math.max(8, Math.round(Math.max(W, H) * 0.012))
  for (const box of Array.isArray(boxes) ? boxes : []) {
    const x = Math.max(0, Number(box.x) || 0) * W
    const y = Math.max(0, Number(box.y) || 0) * H
    const w = Math.max(4, Number(box.w) || 0) * W
    const h = Math.max(4, Number(box.h) || 0) * H
    mctx.fillStyle = '#FFFFFF'
    mctx.fillRect(x - feather, y - feather, w + feather * 2, h + feather * 2)
  }
  const soft = createCanvas(W, H)
  const sctx = soft.getContext('2d')
  try { sctx.filter = `blur(${feather}px)` } catch {}
  sctx.drawImage(mask, 0, 0)
  const patch = createCanvas(W, H)
  const pctx = patch.getContext('2d')
  pctx.drawImage(blur, 0, 0)
  pctx.globalCompositeOperation = 'destination-in'
  pctx.drawImage(soft, 0, 0)
  pctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(patch, 0, 0)
  return canvas.toBuffer('image/png')
}

// 把抠图后的透明背景叠回模糊原图：主体区域变成柔和补位，避免模板背景出现黑洞。
export async function fillCutoutBackground({ originalBuffer, cutoutBackgroundBuffer }) {
  const { createCanvas } = loadCanvasModule()
  const original = await decodeImage(originalBuffer)
  const cut = await decodeImage(cutoutBackgroundBuffer)
  const W = original.width
  const H = original.height
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  const blur = createCanvas(W, H)
  const bctx = blur.getContext('2d')
  try { bctx.filter = 'blur(28px) brightness(.72)' } catch {}
  bctx.drawImage(original, 0, 0)
  ctx.drawImage(blur, 0, 0)
  ctx.drawImage(cut, 0, 0, W, H)
  return canvas.toBuffer('image/png')
}

// 粗略判断两张图是否是同一画面；用于底图生图偏离过大时自动回退到底图。
export async function imageSimilarity(bufferA, bufferB) {
  if (!bufferA || !bufferB) return 0
  const { createCanvas } = loadCanvasModule()
  const a = await decodeImage(bufferA)
  const b = await decodeImage(bufferB)
  const size = 64
  const ca = createCanvas(size, size)
  const cb = createCanvas(size, size)
  const ga = ca.getContext('2d')
  const gb = cb.getContext('2d')
  ga.drawImage(a, 0, 0, size, size)
  gb.drawImage(b, 0, 0, size, size)
  const da = ga.getImageData(0, 0, size, size).data
  const db = gb.getImageData(0, 0, size, size).data
  let diff = 0
  for (let i = 0; i < da.length; i += 4) {
    diff += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
  }
  return Math.max(0, Math.min(1, 1 - diff / (da.length / 4 * 3 * 255)))
}
