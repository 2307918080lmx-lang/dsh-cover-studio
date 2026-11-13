export const RATIO_PRESETS = [
  { id: '16:9', label: '16:9 横屏', width: 1920, height: 1080, group: '视频' },
  { id: '9:16', label: '9:16 竖屏', width: 1080, height: 1920, group: '短视频' },
  { id: '4:3', label: '4:3 横屏', width: 1536, height: 1152, group: '视频' },
  { id: '3:4', label: '3:4 竖屏', width: 1080, height: 1440, group: '短视频' },
  { id: '1:1', label: '1:1 方形', width: 1080, height: 1080, group: '通用' },
  { id: '3:2', label: '3:2 横屏', width: 1620, height: 1080, group: '通用' },
  { id: '5:4', label: '5:4 横屏', width: 1350, height: 1080, group: '通用' },
  { id: '2.35:1', label: '2.35:1 电影', width: 1920, height: 817, group: '电影' },
  { id: '21:9', label: '21:9 宽银幕', width: 2560, height: 1080, group: '电影' },
]

const PRESET_MAP = new Map(RATIO_PRESETS.map((r) => [r.id, r]))

function cleanNumber(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 1000) / 1000
}

export function parseRatio(value, fallback = '16:9') {
  const raw = String(value ?? '').trim().replace(/[：×xX]/g, ':').replace(/\s+/g, '')
  if (PRESET_MAP.has(raw)) return PRESET_MAP.get(raw)
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(raw)
  if (!m) return PRESET_MAP.get(fallback) || RATIO_PRESETS[0]
  const w = cleanNumber(m[1])
  const h = cleanNumber(m[2])
  if (!w || !h) return PRESET_MAP.get(fallback) || RATIO_PRESETS[0]
  const a = w / h
  if (a < 0.2 || a > 8) return PRESET_MAP.get(fallback) || RATIO_PRESETS[0]
  return { id: `${w}:${h}`, label: `${w}:${h} 自定义`, width: w, height: h, group: '自定义', custom: true }
}

export function normalizeRatioId(value, fallback = '16:9') {
  return parseRatio(value, fallback).id
}

export function targetSize(ratio) {
  const r = parseRatio(ratio)
  if (!r.custom) return { width: r.width, height: r.height }
  const aspect = r.width / r.height
  const long = 1920
  if (aspect >= 1) {
    const width = long
    return { width, height: Math.max(360, Math.round(width / aspect)) }
  }
  const height = long
  return { width: Math.max(360, Math.round(height * aspect)), height }
}

export function ratioCss(ratio) {
  const { width, height } = targetSize(ratio)
  return `${width} / ${height}`
}

export function isPortrait(ratio) {
  const { width, height } = targetSize(ratio)
  return height > width * 1.04
}

export function relaySize(ratio, relay) {
  const r = parseRatio(ratio)
  if (r.id === '4:3') return relay?.size43 || '1536x1152'
  if (r.id === '16:9') return relay?.size169 || '1536x1024'
  if (r.id === '9:16') return relay?.size916 || '1024x1536'
  if (r.id === '3:4') return relay?.size916 || '1024x1536'
  if (r.id === '1:1') return relay?.size11 || '1024x1024'
  const aspect = r.width / r.height
  if (aspect < 0.8) return '1024x1536'
  if (aspect > 1.25) return '1536x1024'
  return '1024x1024'
}

export function ratioText(ratio) {
  const { width, height } = targetSize(ratio)
  const r = parseRatio(ratio)
  if (height > width) return `${r.id} 竖幅（不是把横屏图拉高）`
  if (r.id === '2.35:1' || r.id === '21:9') return `${r.id} 超宽银幕（不是把普通横屏裁掉一点）`
  return `${r.id} 横幅`
}
