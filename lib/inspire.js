import { ensureFonts, fontString, loadCanvasModule, targetSize } from './render.js'

function safePalette(list) {
  const out = (Array.isArray(list) ? list : []).filter((x) => /^#[0-9a-f]{6}$/i.test(String(x))).slice(0, 3)
  while (out.length < 3) out.push(['#0B1722', '#1D4260', '#F7F3EA'][out.length])
  return out
}

function splitTitle(text) {
  const chars = Array.from(String(text || '').trim())
  if (chars.length <= 6) return [chars.join('')]
  const lines = chars.length > 12 ? 3 : 2
  const per = Math.ceil(chars.length / lines)
  const out = []
  for (let i = 0; i < chars.length; i += per) out.push(chars.slice(i, i + per).join(''))
  return out
}

function drawWrapped(ctx, lines, x, y, maxW, size, lineH, color) {
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  for (const line of lines) {
    ctx.font = fontString(size, 'CoverSerif', 900)
    let s = size
    while (ctx.measureText(line).width > maxW && s > 14) {
      s *= 0.94
      ctx.font = fontString(s, 'CoverSerif', 900)
    }
    ctx.fillText(line, x, y)
    y += s * lineH
  }
}

export async function renderDirectionSketch({ direction, ratio, settings }) {
  ensureFonts(settings)
  const { createCanvas } = loadCanvasModule()
  const target = targetSize(ratio)
  const maxSide = 960
  const scale = Math.min(maxSide / target.width, maxSide / target.height)
  const W = Math.max(320, Math.round(target.width * scale))
  const H = Math.max(240, Math.round(target.height * scale))
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  const palette = safePalette(direction.palette)
  ctx.fillStyle = palette[0]
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = palette[1]
  ctx.beginPath()
  ctx.arc(W * 0.72, H * 0.3, Math.max(W, H) * 0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#05090E'
  ctx.beginPath()
  ctx.ellipse(W * 0.55, H * 1.05, W * 0.8, H * 0.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const layout = direction.layoutId || 'left-stack'
  const characterRight = !/right-title|edge-poster/.test(layout)
  const cx = characterRight ? W * 0.69 : W * 0.33
  const cy = H * 0.47
  const headR = Math.min(W, H) * (layout === 'bottom-title' ? 0.2 : 0.17)
  ctx.save()
  ctx.fillStyle = 'rgba(4,9,14,.5)'
  ctx.beginPath()
  ctx.ellipse(cx, cy - headR * 0.9, headR, headR * 1.05, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx, cy + headR * 1.8, headR * 2.25, headR * 2.3, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,.35)'
  ctx.lineWidth = Math.max(2, W * 0.004)
  ctx.beginPath()
  ctx.ellipse(cx, cy - headR * 0.9, headR, headR * 1.05, 0, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.fillStyle = 'rgba(3,8,14,.56)'
  if (characterRight) ctx.fillRect(0, 0, W * 0.7, H)
  else ctx.fillRect(W * 0.3, 0, W * 0.7, H)
  ctx.restore()

  const left = W * 0.07
  const maxW = W * 0.62
  const titleLines = splitTitle(direction.title)
  let titleSize = W * (H > W ? 0.13 : 0.1)
  const titleY = H * (layout === 'bottom-title' ? 0.66 : 0.34)
  drawWrapped(ctx, titleLines, left, titleY, maxW, titleSize, 1.04, '#F7F3EA')
  const subSize = Math.max(12, W * 0.026)
  ctx.font = fontString(subSize, 'CoverSans', 500)
  ctx.fillStyle = 'rgba(247,243,234,.88)'
  ctx.fillText(String(direction.subtitle || '').slice(0, 32), left, Math.min(H * 0.92, titleY + titleLines.length * titleSize * 1.04 + H * 0.1))

  ctx.font = fontString(Math.max(10, W * 0.018), 'CoverSans', 600)
  ctx.fillStyle = 'rgba(247,243,234,.65)'
  ctx.fillText('构图草图 · ' + (direction.name || '方向'), left, H * 0.09)
  ctx.font = fontString(Math.max(9, W * 0.014), 'CoverSans', 400)
  ctx.fillStyle = 'rgba(247,243,234,.45)'
  ctx.fillText(String(direction.why || direction.composition || '').slice(0, 44), left, H * 0.13)

  return { buffer: canvas.toBuffer('image/png'), width: W, height: H }
}
