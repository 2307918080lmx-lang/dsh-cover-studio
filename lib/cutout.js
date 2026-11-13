import { loadCanvasModule, decodeImage, visionDataUrl } from './render.js'
import { extractJson } from './util.js'
import { segmentAlpha } from './segmentation.js'

function clampBox(box, width, height) {
  const raw = box && typeof box === 'object' ? box : {}
  let x0 = Number(raw.x0 ?? raw.left ?? raw.x ?? 0)
  let y0 = Number(raw.y0 ?? raw.top ?? raw.y ?? 0)
  let x1 = Number(raw.x1 ?? raw.right ?? (raw.x != null ? Number(raw.x) + Number(raw.w || 0) : width))
  let y1 = Number(raw.y1 ?? raw.bottom ?? (raw.y != null ? Number(raw.y) + Number(raw.h || 0) : height))
  if (!Number.isFinite(x0)) x0 = 0
  if (!Number.isFinite(y0)) y0 = 0
  if (!Number.isFinite(x1)) x1 = width
  if (!Number.isFinite(y1)) y1 = height
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  x0 = Math.max(0, Math.min(width - 1, Math.round(x0)))
  y0 = Math.max(0, Math.min(height - 1, Math.round(y0)))
  x1 = Math.max(x0 + 1, Math.min(width, Math.round(x1)))
  y1 = Math.max(y0 + 1, Math.min(height, Math.round(y1)))
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

function normalizedPolygon(raw, width, height) {
  if (!Array.isArray(raw) || raw.length < 3) return null
  const pts = raw.map((p) => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length < 3) return null
  const max = Math.max(...pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))))
  const sx = max <= 1.0001 ? width : 1
  const sy = max <= 1.0001 ? height : 1
  return pts.map((p) => [Math.max(0, Math.min(width, p[0] * sx)), Math.max(0, Math.min(height, p[1] * sy))])
}

function pointInPolygon(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1]
    const xj = pts[j][0], yj = pts[j][1]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

function normalizedBox(raw, width, height) {
  if (!raw || !Array.isArray(raw) || raw.length < 4) return null
  const nums = raw.map((n) => Number(n))
  if (nums.some((n) => !Number.isFinite(n))) return null
  const [a, b, c, d] = nums
  if (Math.max(a, b, c, d) <= 1.0001) {
    return { x0: a * width, y0: b * height, x1: c * width, y1: d * height }
  }
  return { x0: a, y0: b, x1: c, y1: d }
}

function colorDistance(data, i, j) {
  const dr = data[i] - data[j]
  const dg = data[i + 1] - data[j + 1]
  const db = data[i + 2] - data[j + 2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

async function aiBox({ llm, buffer, prompt, log, width, height }) {
  if (!llm) return null
  try {
    const img = await visionDataUrl(buffer, 1100)
    const ask = prompt?.trim()
      ? `用户想抠出：${prompt.trim()}`
      : '自动识别画面中最重要的主体（人物、角色、动物或产品）。'
    const result = await llm.vision({
      imageDataUrl: img.dataUrl,
      maxTokens: 1800,
      prompt: `你是抠图定位助手。${ask}
只输出 JSON，不要 Markdown：
{"box":[x0,y0,x1,y1],"polygon":[[x,y],...],"subject":"主体名称","note":"一句说明"}
box 是归一化坐标（0-1），必须紧贴主体，包含头发、耳朵、肩膀等边缘，不要包含大片背景。
polygon 是主体轮廓，按顺时针 20-30 个归一化点，尽量贴合头发、肩膀、手臂和衣服；不要只给矩形。
如果没有明确主体，就框住画面中心最有视觉重量的物体。只输出 JSON。`,
    })
    const parsed = extractJson(result.text)
    const box = parsed?.box
    if (!Array.isArray(box) || box.length < 4) return null
    return {
      box: normalizedBox(box, width, height),
      polygon: normalizedPolygon(parsed?.polygon, width, height),
      subject: String(parsed.subject || ''),
      note: String(parsed.note || ''),
    }
  } catch (err) {
    log?.(`[cutout] AI 定位失败，改用本地主体估计：${err?.message || err}`)
    return null
  }
}

function estimateBox(width, height) {
  return { x0: width * 0.08, y0: height * 0.04, x1: width * 0.92, y1: height * 0.96 }
}

function expandBox(box, ratio, width, height) {
  const mx = Math.max(8, box.w * ratio)
  const my = Math.max(8, box.h * ratio)
  return clampBox({ x0: box.x0 - mx, y0: box.y0 - my, x1: box.x1 + mx, y1: box.y1 + my }, width, height)
}

function borderSeedsOutside(width, height, target, step = 4) {
  const seeds = []
  const inside = (x, y) => x >= target.x0 - 4 && x <= target.x1 + 4 && y >= target.y0 - 4 && y <= target.y1 + 4
  for (let x = 2; x < width - 2; x += step) {
    if (!inside(x, 2)) seeds.push([x, 2])
    if (!inside(x, height - 3)) seeds.push([x, height - 3])
  }
  for (let y = 2; y < height - 2; y += step) {
    if (!inside(2, y)) seeds.push([2, y])
    if (!inside(width - 3, y)) seeds.push([width - 3, y])
  }
  return seeds
}

function paletteFromSeeds(data, width, seeds) {
  const buckets = new Map()
  for (const idx of seeds) {
    const o = idx * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
    cur.n++; cur.r += r; cur.g += g; cur.b += b
    buckets.set(key, cur)
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((c) => ({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }))
}

function colorDistanceTo(data, i, color) {
  const dr = data[i] - color.r
  const dg = data[i + 1] - color.g
  const db = data[i + 2] - color.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function floodBackground({ data, width, height, seedPoints, limitBox, tolerance = 26 }) {
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const seeds = []
  for (const p of seedPoints) {
    const x = Math.max(limitBox.x0, Math.min(limitBox.x1 - 1, p[0] | 0))
    const y = Math.max(limitBox.y0, Math.min(limitBox.y1 - 1, p[1] | 0))
    const idx = y * width + x
    if (!visited[idx]) { visited[idx] = 1; queue[tail++] = idx; seeds.push(idx) }
  }
  const palette = paletteFromSeeds(data, width, seeds)
  const isBg = new Uint8Array(total)
  for (const idx of seeds) isBg[idx] = 1
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % width
    const y = (idx / width) | 0
    const base = idx * 4
    const neighbors = [
      x > limitBox.x0 ? idx - 1 : -1,
      x < limitBox.x1 - 1 ? idx + 1 : -1,
      y > limitBox.y0 ? idx - width : -1,
      y < limitBox.y1 - 1 ? idx + width : -1,
    ]
    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue
      visited[n] = 1
      const ni = n * 4
      if (data[base + 3] < 16 && data[ni + 3] < 16) { isBg[n] = 1; queue[tail++] = n; continue }
      const local = colorDistance(data, base, ni)
      if (local > tolerance) continue
      // 必须同时接近边框采样到的背景色，避免沿着抗锯齿边缘一路吞进主体。
      let closeToPalette = false
      for (const color of palette) {
        if (colorDistanceTo(data, ni, color) <= 52) { closeToPalette = true; break }
      }
      if (!closeToPalette) continue
      isBg[n] = 1
      queue[tail++] = n
    }
  }
  return isBg
}

function erodeAlpha(alpha, width, height) {
  const out = new Uint8ClampedArray(alpha.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let v = alpha[i]
      if (x > 0) v = Math.min(v, alpha[i - 1])
      if (x < width - 1) v = Math.min(v, alpha[i + 1])
      if (y > 0) v = Math.min(v, alpha[i - width])
      if (y < height - 1) v = Math.min(v, alpha[i + width])
      out[i] = v
    }
  }
  return out
}

function keepMaskComponents(alpha, width, height, target) {
  const total = width * height
  const visited = new Uint8Array(total)
  const keep = new Uint8Array(total)
  const queue = new Int32Array(total)
  let kept = 0
  for (let seed = 0; seed < total; seed++) {
    if (visited[seed] || alpha[seed] <= 20) continue
    let head = 0
    let tail = 0
    let count = 0
    let overlap = 0
    let sumX = 0
    let sumY = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    queue[tail++] = seed
    visited[seed] = 1
    while (head < tail) {
      const idx = queue[head++]
      const x = idx % width
      const y = (idx / width) | 0
      count++
      sumX += x
      sumY += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x >= target.x0 && x < target.x1 && y >= target.y0 && y < target.y1) overlap++
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ]
      for (const n of neighbors) {
        if (n < 0 || visited[n] || alpha[n] <= 20) continue
        visited[n] = 1
        queue[tail++] = n
      }
    }
    // 主体质心必须落在框内；只有明显向框内延伸的大连通域才允许例外。
    const cx = sumX / Math.max(1, count)
    const cy = sumY / Math.max(1, count)
    const centerInside = cx >= target.x0 && cx < target.x1 && cy >= target.y0 && cy < target.y1
    const overlapRatio = overlap / Math.max(1, count)
    if (centerInside || overlapRatio > 0.35 || (overlap > 0 && count < width * height * 0.005)) {
      for (let i = 0; i < tail; i++) keep[queue[i]] = 1
      kept += count
    }
  }
  if (!kept) return null
  const out = new Uint8ClampedArray(total)
  for (let i = 0; i < total; i++) if (keep[i]) out[i] = alpha[i]
  return { alpha: out, coverage: kept / Math.max(1, total) }
}

function featherAlpha(alpha, width, height, radius = 1) {
  if (radius <= 0) return alpha
  const out = new Uint8ClampedArray(alpha.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          sum += alpha[yy * width + xx]
          count++
        }
      }
      out[y * width + x] = count ? sum / count : alpha[y * width + x]
    }
  }
  return out
}

export async function cutoutImage({ buffer, mode = 'smart', box = null, prompt = '', maskBuffer = null, llm = null, log = () => {} }) {
  const img = await decodeImage(buffer)
  const maxSide = 2200
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const { createCanvas } = loadCanvasModule()
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const sourceData = new Uint8ClampedArray(data)

  let target = null
  if (box) {
    const sx = width / Math.max(1, img.width)
    const sy = height / Math.max(1, img.height)
    target = clampBox({
      x0: (Number(box.x0 ?? box.x) || 0) * sx,
      y0: (Number(box.y0 ?? box.y) || 0) * sy,
      x1: (Number(box.x1 ?? ((Number(box.x) || 0) + (Number(box.w) || 0))) || 0) * sx,
      y1: (Number(box.y1 ?? ((Number(box.y) || 0) + (Number(box.h) || 0))) || 0) * sy,
    }, width, height)
  }
  let subject = ''
  let polygon = null
  let method = mode === 'box' || mode === 'erase' ? 'manual-box' : 'local-edge'
  if (mode === 'smart' && !target) {
    const ai = await aiBox({ llm, buffer, prompt, log, width, height })
    if (ai?.box) {
      target = clampBox(ai.box, width, height)
      polygon = ai.polygon || null
      subject = ai.subject || ''
      method = 'ai-box+local-edge'
    }
  }
  if (!target) target = clampBox(estimateBox(width, height), width, height)

  const erase = mode === 'erase'
  let alpha = new Uint8ClampedArray(width * height)
  let usedModel = false

  if (mode === 'brush' && maskBuffer) {
    try {
      const maskImg = await decodeImage(maskBuffer)
      const maskCanvas = createCanvas(width, height)
      const maskCtx = maskCanvas.getContext('2d')
      maskCtx.drawImage(maskImg, 0, 0, width, height)
      const maskData = maskCtx.getImageData(0, 0, width, height).data
      let transparent = false
      for (let i = 3; i < maskData.length; i += 4) {
        if (maskData[i] < 245) { transparent = true; break }
      }
      let painted = 0
      for (let i = 0; i < width * height; i++) {
        const o = i * 4
        const a = maskData[o + 3]
        const lum = (maskData[o] * 0.299 + maskData[o + 1] * 0.587 + maskData[o + 2] * 0.114)
        const v = transparent ? a : lum
        if (v > 20) { alpha[i] = Math.min(255, Math.round((v / 255) * 255)); painted++ }
      }
      if (painted) {
        usedModel = true
        method = 'brush-mask'
      }
    } catch (err) {
      log?.(`[cutout] 画笔蒙版读取失败：${err?.message || err}`)
    }
  }

  if (!usedModel && mode === 'box-smart') {
    // PS 式对象选择：只在框选附近裁一块给分割模型，模型只看到框内主体，
    // 不会把画面另一侧不相关的手机/人物一起带出来。
    const work = expandBox(target, 0.12, width, height)
    try {
      const crop = createCanvas(work.w, work.h)
      const cropCtx = crop.getContext('2d')
      const sx = img.width / Math.max(1, width)
      const sy = img.height / Math.max(1, height)
      cropCtx.drawImage(img, work.x0 * sx, work.y0 * sy, work.w * sx, work.h * sy, 0, 0, work.w, work.h)
      const seg = await segmentAlpha({ buffer: crop.toBuffer('image/png'), width: work.w, height: work.h, box: null, log })
      if (seg && seg.coverage > 0.002 && seg.coverage < 0.97) {
        for (let y = 0; y < work.h; y++) {
          for (let x = 0; x < work.w; x++) {
            const v = seg.alpha[y * work.w + x]
            if (v > 8) alpha[(work.y0 + y) * width + work.x0 + x] = v
          }
        }
        usedModel = true
        method = 'silueta-object'
      }
    } catch (err) {
      log?.(`[cutout] 框选裁剪分割失败：${err?.message || err}`)
    }
    if (!usedModel) {
      const full = await segmentAlpha({ buffer, width, height, box: null, log })
      if (full) {
        const picked = keepMaskComponents(full.alpha, width, height, expandBox(target, 0.04, width, height))
        if (picked && picked.coverage > 0.002 && picked.coverage < 0.97) {
          alpha = picked.alpha
          usedModel = true
          method = 'silueta-object'
        }
      }
    }
  }
  if (!usedModel && mode === 'smart') {
    const limit = expandBox(target, 0.08, width, height)
    const seg = await segmentAlpha({ buffer, width, height, box: limit, log })
    if (seg && seg.coverage > 0.002 && seg.coverage < 0.97) {
      alpha = seg.alpha
      usedModel = true
      method = 'silueta'
    }
  }

  if (!usedModel) {
  if (mode === 'box' || mode === 'erase') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inside = x >= target.x0 && x < target.x1 && y >= target.y0 && y < target.y1
        alpha[y * width + x] = erase ? (inside ? 0 : data[(y * width + x) * 4 + 3]) : (inside ? 255 : 0)
      }
    }
  } else if (mode === 'box-smart') {
    // 手动框选 + 自动去边：框只负责限定范围，边缘按背景色/连通区域重新计算，不是截矩形。
    const work = expandBox(target, 0.08, width, height)
    const seeds = borderSeedsOutside(width, height, target, Math.max(2, Math.round(Math.min(width, height) / 160)))
    const full = { x0: 0, y0: 0, x1: width, y1: height, w: width, h: height }
    const bg = seeds.length ? floodBackground({ data, width, height, seedPoints: seeds, limitBox: full, tolerance: 26 }) : null
    let bgCount = 0
    if (bg) for (let y = work.y0; y < work.y1; y++) for (let x = work.x0; x < work.x1; x++) if (bg[y * width + x]) bgCount++
    const bgRatio = bg ? bgCount / Math.max(1, work.w * work.h) : 1
    if (!bg || bgRatio > 0.94) {
      method = 'box-smart-fallback'
      for (let y = target.y0; y < target.y1; y++) for (let x = target.x0; x < target.x1; x++) alpha[y * width + x] = 255
    } else {
      method = 'box-smart'
      for (let y = work.y0; y < work.y1; y++) {
        for (let x = work.x0; x < work.x1; x++) {
          if (!bg[y * width + x]) alpha[y * width + x] = 255
        }
      }
    }
  } else {
    // 智能模式：从略大于 AI 框的边缘采样背景，再向内吞掉连通的背景区域。
    // 如果直接拿 AI 框边缘做种子，种子往往落在主体本身上，会把主体当成背景吃掉。
    const work = expandBox(target, 0.14, width, height)
    const seeds = borderSeedsOutside(width, height, target, Math.max(2, Math.round(Math.min(width, height) / 160)))
    const full = { x0: 0, y0: 0, x1: width, y1: height, w: width, h: height }
    const bg = seeds.length ? floodBackground({ data, width, height, seedPoints: seeds, limitBox: full, tolerance: 26 }) : null
    let bgCount = 0
    if (bg) for (let y = work.y0; y < work.y1; y++) {
      for (let x = work.x0; x < work.x1; x++) {
        if (bg[y * width + x]) bgCount++
      }
    }
    const bgRatio = bg ? bgCount / Math.max(1, work.w * work.h) : 1
    if (!bg || bgRatio > 0.94) {
      // 背景和主体颜色太接近：优先用 AI 轮廓，不要让结果退回一个矩形。
      let painted = 0
      if (polygon && polygon.length >= 3) {
        for (let y = work.y0; y < work.y1; y++) {
          for (let x = work.x0; x < work.x1; x++) {
            if (pointInPolygon(x, y, polygon)) { alpha[y * width + x] = 255; painted++ }
          }
        }
      }
      const polyRatio = painted / Math.max(1, work.w * work.h)
      if (polyRatio > 0.01) {
        method = 'ai-polygon'
      } else {
        method = 'ai-box'
        for (let y = target.y0; y < target.y1; y++) {
          for (let x = target.x0; x < target.x1; x++) alpha[y * width + x] = 255
        }
      }
    } else {
      method = method === 'ai-box+local-edge' ? 'ai-box+local-edge' : 'local-edge'
      for (let y = work.y0; y < work.y1; y++) {
        for (let x = work.x0; x < work.x1; x++) {
          if (!bg[y * width + x]) alpha[y * width + x] = 255
        }
      }
    }
  }
  }

  const trimmed = mode === 'box' || mode === 'erase' || usedModel ? alpha : erodeAlpha(alpha, width, height)
  const feathered = featherAlpha(trimmed, width, height, 1)
  for (let i = 0; i < feathered.length; i++) {
    data[i * 4 + 3] = feathered[i]
  }
  ctx.putImageData(imageData, 0, 0)
  let kept = 0
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (feathered[y * width + x] > 10) {
        kept++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  let output = canvas
  let crop = { x: 0, y: 0, w: 1, h: 1 }
  if (kept > 0 && (minX > 0 || minY > 0 || maxX < width - 1 || maxY < height - 1)) {
    const cw = maxX - minX + 1
    const ch = maxY - minY + 1
    output = createCanvas(cw, ch)
    const octx = output.getContext('2d')
    octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch)
    crop = { x: minX / width, y: minY / height, w: cw / width, h: ch / height }
  }
  let backgroundBuffer = null
  if (!erase) {
    const bgCanvas = createCanvas(width, height)
    const bgCtx = bgCanvas.getContext('2d')
    const bgImage = bgCtx.createImageData(width, height)
    const bg = bgImage.data
    for (let i = 0; i < feathered.length; i++) {
      const o = i * 4
      bg[o] = sourceData[o]
      bg[o + 1] = sourceData[o + 1]
      bg[o + 2] = sourceData[o + 2]
      bg[o + 3] = Math.round(sourceData[o + 3] * (1 - feathered[i] / 255))
    }
    bgCtx.putImageData(bgImage, 0, 0)
    backgroundBuffer = bgCanvas.toBuffer('image/png')
  }
  return {
    buffer: output.toBuffer('image/png'),
    backgroundBuffer,
    width: output.width,
    height: output.height,
    sourceWidth: width,
    sourceHeight: height,
    crop,
    box: target,
    subject,
    method,
    coverage: kept / Math.max(1, width * height),
    note: erase ? '已擦除框内区域' : (method === 'brush-mask' ? '已按画笔涂抹区域抠图' : (method === 'silueta-object' ? '已按框选识别完整主体并精细去背' : (method === 'silueta-box' ? '已用本地分割模型精细去背（框选范围）' : (method === 'silueta' ? '已用本地分割模型精细去背' : (method === 'manual-box' ? '已按框选保留矩形区域' : (method === 'box-smart' ? '已按框选智能去边' : (method === 'box-smart-fallback' ? '背景太复杂，已保留框内内容' : (method === 'ai-polygon' ? '已按 AI 轮廓精细去背' : '已自动识别主体并去背')))))))),
  }
}
