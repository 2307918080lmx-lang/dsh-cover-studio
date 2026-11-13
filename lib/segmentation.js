import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { loadCanvasModule } from './render.js'

const MODEL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'silueta.onnx')
const MODEL_SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let ort = null
let sessionPromise = null
let unavailable = false

function loadOrt() {
  if (ort) return ort
  const req = createRequire(import.meta.url)
  ort = req('onnxruntime-node')
  return ort
}

function loadSession(log) {
  if (unavailable) return Promise.resolve(null)
  if (!sessionPromise) {
    sessionPromise = (async () => {
      if (!fs.existsSync(MODEL_FILE)) {
        log?.('[segment] 未找到本地分割模型，使用边缘算法兜底')
        unavailable = true
        return null
      }
      try {
        const runtime = loadOrt()
        const session = await runtime.InferenceSession.create(MODEL_FILE, { executionProviders: ['cpu'] })
        log?.('[segment] 分割模型已加载')
        return session
      } catch (err) {
        unavailable = true
        log?.(`[segment] 分割模型不可用：${err?.message || err}`)
        return null
      }
    })()
  }
  return sessionPromise
}

function inputName(session) {
  return session.inputNames?.[0] || 'input.1'
}

function outputName(session) {
  return session.outputNames?.[0] || ''
}

async function maskScores(buffer, log) {
  const session = await loadSession(log)
  if (!session) return null
  const { createCanvas, loadImage } = loadCanvasModule()
  const img = await loadImage(buffer)
  const canvas = createCanvas(MODEL_SIZE, MODEL_SIZE)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, MODEL_SIZE, MODEL_SIZE)
  const data = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data
  const plane = MODEL_SIZE * MODEL_SIZE
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    input[i] = (data[i * 4] / 255 - MEAN[0]) / STD[0]
    input[plane + i] = (data[i * 4 + 1] / 255 - MEAN[1]) / STD[1]
    input[plane * 2 + i] = (data[i * 4 + 2] / 255 - MEAN[2]) / STD[2]
  }
  const runtime = loadOrt()
  const feeds = { [inputName(session)]: new runtime.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]) }
  const output = await session.run(feeds)
  const first = output[outputName(session)] || output[Object.keys(output).find((k) => output[k]?.data?.length === plane)]
  if (!first || !first.data || first.data.length < plane) return null
  const scores = first.data
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < plane; i++) {
    if (scores[i] < min) min = scores[i]
    if (scores[i] > max) max = scores[i]
  }
  const span = max - min || 1
  const alpha = new Uint8ClampedArray(plane)
  for (let i = 0; i < plane; i++) {
    const v = Math.max(0, Math.min(1, (scores[i] - min) / span))
    alpha[i] = v <= 0.035 ? 0 : Math.round(Math.pow(v, 0.82) * 255)
  }
  return alpha
}

export async function segmentAlpha({ buffer, width, height, box, log }) {
  try {
    const scores = await maskScores(buffer, log)
    if (!scores) return null
    const { createCanvas } = loadCanvasModule()
    const maskCanvas = createCanvas(MODEL_SIZE, MODEL_SIZE)
    const mctx = maskCanvas.getContext('2d')
    const image = mctx.createImageData(MODEL_SIZE, MODEL_SIZE)
    for (let i = 0; i < scores.length; i++) {
      image.data[i * 4] = 255
      image.data[i * 4 + 1] = 255
      image.data[i * 4 + 2] = 255
      image.data[i * 4 + 3] = scores[i]
    }
    mctx.putImageData(image, 0, 0)
    const full = createCanvas(width, height)
    const fctx = full.getContext('2d')
    fctx.imageSmoothingEnabled = true
    fctx.imageSmoothingQuality = 'high'
    fctx.drawImage(maskCanvas, 0, 0, width, height)
    const pixels = fctx.getImageData(0, 0, width, height).data
    const alpha = new Uint8ClampedArray(width * height)
    const limit = box ? {
      x0: Math.max(0, Math.floor(box.x0)),
      y0: Math.max(0, Math.floor(box.y0)),
      x1: Math.min(width, Math.ceil(box.x1)),
      y1: Math.min(height, Math.ceil(box.y1)),
    } : null
    let kept = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (limit && (x < limit.x0 || x >= limit.x1 || y < limit.y0 || y >= limit.y1)) continue
        const v = pixels[i * 4 + 3]
        if (v > 8) { alpha[i] = v; kept++ }
      }
    }
    if (!kept) return null
    return { alpha, coverage: kept / Math.max(1, width * height) }
  } catch (err) {
    log?.(`[segment] 推理失败，使用边缘算法兜底：${err?.message || err}`)
    return null
  }
}
