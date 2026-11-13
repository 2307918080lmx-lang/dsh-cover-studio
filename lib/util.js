import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const HOME = os.homedir()
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DATA_DIR = path.join(DSH_HOME, 'cover-studio')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
export const TRASH_DIR = path.join(DATA_DIR, 'trash')
export const CACHE_DIR = path.join(DATA_DIR, 'cache')
export const LOGS_DIR = path.join(DATA_DIR, 'logs')
export const FONTS_DIR = path.join(DATA_DIR, 'fonts')
export const SETTINGS_FILE = path.join(DSH_HOME, 'cover-studio.json')
export const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json')

export function ensureDirs() {
  for (const dir of [DATA_DIR, PROJECTS_DIR, UPLOADS_DIR, TRASH_DIR, CACHE_DIR, LOGS_DIR, FONTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function readJson(file, fallback = null) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  try {
    fs.renameSync(tmp, file)
  } catch {
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
    try { fs.rmSync(tmp, { force: true }) } catch {}
  }
}

export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, data)
  try {
    fs.renameSync(tmp, file)
  } catch {
    fs.writeFileSync(file, data)
    try { fs.rmSync(tmp, { force: true }) } catch {}
  }
}

export function newId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export function slugify(value, max = 42) {
  const base = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/[，。！？、；：“”‘’（）《》【】…—·,.!?;:'"()\[\]{}]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (base || 'cover').slice(0, max)
}

export function safeName(name, fallback = 'file') {
  const base = path.basename(String(name ?? ''))
  const cleaned = base.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/^\.+/, '')
  return (cleaned || fallback).slice(0, 120)
}

export function isWithin(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: '.png' }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' }
  }
  if (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') {
    return { mime: 'image/gif', ext: '.gif' }
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: '.webp' }
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mime: 'image/bmp', ext: '.bmp' }
  }
  if (buffer.toString('ascii', 4, 12).includes('ftypavif') || buffer.toString('ascii', 4, 12).includes('ftypavis')) {
    return { mime: 'image/avif', ext: '.avif' }
  }
  if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a) {
    return { mime: 'image/tiff', ext: '.tiff' }
  }
  if (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[3] === 0x2a) {
    return { mime: 'image/tiff', ext: '.tiff' }
  }
  if (buffer.toString('ascii', 4, 12).includes('ftypheic') || buffer.toString('ascii', 4, 12).includes('ftypheix')) {
    return { mime: 'image/heic', ext: '.heic' }
  }
  return null
}

export const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.heic': 'image/heic',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

export function redact(value) {
  const s = String(value ?? '')
  if (!s) return ''
  if (s.length <= 8) return '***'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

export function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl ?? ''))
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  const base64 = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3]), 'utf8').toString('base64')
  return { mime, buffer: Buffer.from(base64, 'base64') }
}

export function truncate(text, max = 600) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function extractJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) throw new Error('empty model output')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw
  try { return JSON.parse(candidate) } catch {}
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1))
  }
  throw new Error('model output is not valid JSON')
}

export function splitLines(text, maxChars) {
  const s = String(text ?? '').replace(/\r/g, '')
  if (!s) return []
  const hard = s.split('\n')
  const out = []
  for (const line of hard) {
    if (!line) { out.push(''); continue }
    let current = ''
    for (const ch of Array.from(line)) {
      current += ch
      if (current.length >= maxChars) { out.push(current); current = '' }
    }
    if (current) out.push(current)
  }
  return out
}
