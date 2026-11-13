import fs from 'node:fs'
import path from 'node:path'
import {
  DATA_DIR,
  PROJECTS_DIR,
  UPLOADS_DIR,
  TRASH_DIR,
  ensureDirs,
  readJson,
  writeJson,
  writeFileAtomic,
  newId,
  slugify,
  safeName,
  stamp,
  isWithin,
  MIME_BY_EXT,
  FONTS_DIR,
} from './util.js'
import { resizeToThumb, pngToJpeg } from './render.js'

const ROUTE = '/dsh-cover-studio'

export function publicProject(project) {
  if (!project) return null
  const v = encodeURIComponent(project.updatedAt || project.createdAt || '')
  const base = `${ROUTE}/files/projects/${project.id}`
  return {
    ...project,
    coverUrl: project.cover ? `${base}/${project.cover}?v=${v}` : '',
    thumbUrl: project.thumb ? `${base}/${project.thumb}?v=${v}` : (project.cover ? `${base}/${project.cover}?v=${v}` : ''),
    backgroundUrl: (project.backgroundFit || project.background) ? `${base}/${project.backgroundFit || project.background}?v=${v}` : '',
    rawBackgroundUrl: project.background ? `${base}/${project.background}?v=${v}` : '',
    reframeOriginalUrl: project.reframeOriginal ? `${base}/${project.reframeOriginal}?v=${v}` : '',
  }
}

export function projectDir(id) {
  return path.join(PROJECTS_DIR, safeName(id, 'project'))
}

export function ensureProjectDir(id) {
  const dir = projectDir(id)
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'versions'), { recursive: true })
  return dir
}

export function createProject(data) {
  ensureDirs()
  const now = new Date().toISOString()
  const id = data.id || newId('p')
  const project = {
    id,
    createdAt: now,
    updatedAt: now,
    title: data.title || '',
    subtitle: data.subtitle || '',
    brief: data.brief || '',
    ratio: data.ratio || '16:9',
    manual: !!data.manual,
    backgroundRect: data.backgroundRect || null,
    backgroundFilter: data.backgroundFilter || null,
    backgroundVisible: data.backgroundVisible !== false,
    styleId: data.styleId || 'exclusive',
    styleName: data.styleName || '',
    layoutId: data.layoutId || 'left-stack',
    variant: data.variant || null,
    layers: data.layers || [],
    background: data.background || '',
    backgroundFit: data.backgroundFit || '',
    cover: data.cover || '',
    thumb: data.thumb || '',
    relay: data.relay || '',
    relayId: data.relayId || '',
    model: data.model || '',
    via: data.via || '',
    references: data.references || [],
    baseReferenceId: data.baseReferenceId || '',
    customFonts: data.customFonts || [],
    versions: data.versions || [],
    notes: data.notes || '',
  }
  ensureProjectDir(id)
  writeJson(path.join(projectDir(id), 'project.json'), project)
  return project
}

export function saveProject(project) {
  const dir = ensureProjectDir(project.id)
  project.updatedAt = new Date().toISOString()
  writeJson(path.join(dir, 'project.json'), project)
  return project
}

export function getProject(id) {
  const file = path.join(projectDir(id), 'project.json')
  return readJson(file, null)
}

export function listProjects() {
  ensureDirs()
  const out = []
  let entries = []
  try { entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }) } catch { return out }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const p = readJson(path.join(PROJECTS_DIR, ent.name, 'project.json'), null)
    if (p) out.push(publicProject(p))
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return out
}

export function writeProjectFile(id, name, buffer) {
  const dir = ensureProjectDir(id)
  const file = path.join(dir, safeName(name))
  writeFileAtomic(file, buffer)
  return file
}

export async function saveProjectCover(project, pngBuffer) {
  const dir = ensureProjectDir(project.id)
  const cover = 'cover.png'
  writeFileAtomic(path.join(dir, cover), pngBuffer)
  writeFileAtomic(path.join(dir, 'cover.jpg'), await pngToJpeg(pngBuffer))
  const thumb = await resizeToThumb(pngBuffer, 1920)
  writeFileAtomic(path.join(dir, 'thumb.jpg'), thumb)
  const versionName = `versions/cover_${stamp()}.png`
  try {
    fs.mkdirSync(path.join(dir, 'versions'), { recursive: true })
    fs.writeFileSync(path.join(dir, versionName), pngBuffer)
  } catch {}
  project.cover = cover
  project.thumb = 'thumb.jpg'
  project.versions = Array.isArray(project.versions) ? project.versions : []
  project.versions.push({ file: versionName, at: new Date().toISOString() })
  project.versions = project.versions.slice(-20)
  saveProject(project)
  return project
}

export function saveBackground(projectId, buffer, ext = '.png', base = 'background') {
  const dir = ensureProjectDir(projectId)
  const name = `${base}${ext}`
  writeFileAtomic(path.join(dir, name), buffer)
  return name
}

export function deleteProject(id) {
  ensureDirs()
  const from = projectDir(id)
  if (!fs.existsSync(from)) return false
  const to = path.join(TRASH_DIR, `${safeName(id)}_${stamp()}`)
  try {
    fs.renameSync(from, to)
    return true
  } catch {
    // 跨盘/占用时退回复制后删除
    try {
      fs.cpSync(from, to, { recursive: true })
      fs.rmSync(from, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
}

export async function saveUpload(buffer, { name, mime, ext, width, height, normalized, sourceUrl, platform, title, author, views, downloadPath, referer, inReferenceLibrary = true, temporary = false, hash = '' } = {}) {
  ensureDirs()
  const id = newId('u')
  const e = ext || '.png'
  const fileName = `${id}${e}`
  const file = path.join(UPLOADS_DIR, fileName)
  writeFileAtomic(file, buffer)
  let thumbName = ''
  try {
    const thumb = await resizeToThumb(normalized || buffer, 1600)
    thumbName = `${id}_thumb.jpg`
    writeFileAtomic(path.join(UPLOADS_DIR, thumbName), thumb)
  } catch {}
  const meta = {
    id,
    name: name || fileName,
    file: fileName,
    thumb: thumbName,
    mime: mime || MIME_BY_EXT[e] || 'application/octet-stream',
    width: width || null,
    height: height || null,
    size: buffer.length,
    createdAt: new Date().toISOString(),
    analysis: null,
    sourceUrl: sourceUrl || '',
    platform: platform || '',
    title: title || '',
    author: author || '',
    views: Number(views) || 0,
    downloadPath: downloadPath || '',
    referer: referer || '',
    inReferenceLibrary: inReferenceLibrary !== false,
    temporary: temporary === true,
    hash: hash || '',
  }
  writeJson(path.join(UPLOADS_DIR, `${id}.json`), meta)
  return publicUpload(meta)
}

export function saveFontFile(buffer, file) {
  ensureDirs()
  const safe = safeName(file)
  const target = path.join(FONTS_DIR, safe)
  writeFileAtomic(target, buffer)
  return target
}

export function fontFilePath(meta) {
  if (!meta?.file) return ''
  const target = path.join(FONTS_DIR, safeName(meta.file))
  return isWithin(FONTS_DIR, target) && fs.existsSync(target) ? target : ''
}

export function publicUpload(meta) {
  if (!meta) return null
  const base = `${ROUTE}/files/uploads`
  return {
    ...meta,
    url: `${base}/${meta.file}`,
    thumbUrl: meta.thumb ? `${base}/${meta.thumb}` : `${base}/${meta.file}`,
  }
}

export function updateUploadMeta(id, patch = {}) {
  const clean = safeName(id)
  const file = path.join(UPLOADS_DIR, `${clean}.json`)
  const meta = readJson(file, null)
  if (!meta) return null
  const next = { ...meta, ...patch, id: meta.id }
  writeJson(file, next)
  return publicUpload(next)
}

export function getUpload(id) {
  const clean = safeName(id)
  const meta = readJson(path.join(UPLOADS_DIR, `${clean}.json`), null)
  return meta ? publicUpload(meta) : null
}

export function listUploads() {
  ensureDirs()
  const out = []
  let entries = []
  try { entries = fs.readdirSync(UPLOADS_DIR) } catch { return out }
  for (const f of entries) {
    if (!f.endsWith('.json')) continue
    const meta = readJson(path.join(UPLOADS_DIR, f), null)
    if (meta) out.push(publicUpload(meta))
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

export function saveUploadAnalysis(id, analysis) {
  const clean = safeName(id)
  const file = path.join(UPLOADS_DIR, `${clean}.json`)
  const meta = readJson(file, null)
  if (!meta) return null
  meta.analysis = analysis
  writeJson(file, meta)
  return publicUpload(meta)
}

export function deleteUpload(id) {
  const clean = safeName(id)
  const meta = readJson(path.join(UPLOADS_DIR, `${clean}.json`), null)
  if (!meta) return false
  for (const f of [meta.file, meta.thumb, `${clean}.json`]) {
    if (!f) continue
    try { fs.rmSync(path.join(UPLOADS_DIR, safeName(f)), { force: true }) } catch {}
  }
  return true
}

export function uploadPath(meta) {
  if (!meta?.file) return ''
  return path.join(UPLOADS_DIR, safeName(meta.file))
}

export function resolveFile(rel) {
  // rel 形如 projects/<id>/cover.png 或 uploads/<file>
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const file = path.join(DATA_DIR, clean)
  if (!isWithin(DATA_DIR, file)) return null
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null
  return file
}

export function copyToOutput(project, outputDir) {
  const dir = outputDir || path.join(DATA_DIR, 'output')
  fs.mkdirSync(dir, { recursive: true })
  const base = [
    slugify(project.title || 'cover', 36),
    slugify(project.styleName || project.styleId || 'style', 18),
    String(project.ratio || '').replace(/[:/]/g, '比') || '16比9',
    stamp(),
  ].filter(Boolean).join('_')
  const srcPng = path.join(projectDir(project.id), safeName(project.cover || 'cover.png'))
  const srcJpg = path.join(projectDir(project.id), 'cover.jpg')
  const png = path.join(dir, `${base}.png`)
  const jpg = path.join(dir, `${base}.jpg`)
  if (fs.existsSync(srcPng)) fs.copyFileSync(srcPng, png)
  if (fs.existsSync(srcJpg)) fs.copyFileSync(srcJpg, jpg)
  return { png: fs.existsSync(png) ? png : '', jpg: fs.existsSync(jpg) ? jpg : '', dir }
}

export function projectForAgent(project) {
  if (!project) return null
  return {
    id: project.id,
    title: project.title,
    subtitle: project.subtitle,
    ratio: project.ratio,
    styleId: project.styleId,
    styleName: project.styleName,
    layoutId: project.layoutId,
    cover: project.cover ? path.join(projectDir(project.id), project.cover) : '',
    thumb: project.thumb ? path.join(projectDir(project.id), project.thumb) : '',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    notes: project.notes,
  }
}
