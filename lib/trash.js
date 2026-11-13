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
  newId,
  safeName,
  stamp,
  isWithin,
} from './util.js'

const ROUTE = '/dsh-cover-studio'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function expiresIso(deletedAt) {
  return new Date(new Date(deletedAt).getTime() + RETENTION_MS).toISOString()
}

function itemDir(id) {
  const clean = safeName(id)
  const dir = path.join(TRASH_DIR, clean)
  return isWithin(TRASH_DIR, dir) ? dir : ''
}

function moveDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    fs.cpSync(from, to, { recursive: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    fs.copyFileSync(from, to)
    try { fs.rmSync(from, { force: true }) } catch {}
  }
}

function writeItem(meta) {
  const dir = itemDir(meta.id)
  if (!dir) throw new Error('回收站 id 无效')
  writeJson(path.join(dir, 'meta.json'), meta)
  return meta
}

function publicItem(meta) {
  const base = `${ROUTE}/files/trash/${encodeURIComponent(meta.id)}/payload`
  return {
    ...meta,
    previewUrl: meta.preview ? `${base}/${encodeURIComponent(meta.preview)}?v=${encodeURIComponent(meta.deletedAt || '')}` : '',
    daysLeft: Math.max(0, Math.ceil((new Date(meta.expiresAt).getTime() - Date.now()) / 86400000)),
  }
}

export function trashProject(project) {
  ensureDirs()
  if (!project?.id) throw new Error('项目不存在')
  const from = path.join(PROJECTS_DIR, safeName(project.id))
  if (!fs.existsSync(from)) throw new Error('项目文件不存在')
  const id = `${safeName(project.id)}_${stamp()}_${Math.random().toString(36).slice(2, 6)}`
  const dir = itemDir(id)
  const payload = path.join(dir, 'payload')
  moveDir(from, payload)
  const deletedAt = nowIso()
  return publicItem(writeItem({
    id,
    type: 'project',
    originalId: project.id,
    title: project.title || '未命名封面',
    createdAt: project.createdAt || '',
    deletedAt,
    expiresAt: expiresIso(deletedAt),
    preview: project.cover || project.thumb || '',
  }))
}

export function trashUpload(meta, extra = {}) {
  ensureDirs()
  if (!meta?.id) throw new Error('参考图不存在')
  const id = `${safeName(meta.id)}_${stamp()}_${Math.random().toString(36).slice(2, 6)}`
  const dir = itemDir(id)
  const payload = path.join(dir, 'payload')
  fs.mkdirSync(payload, { recursive: true })
  const files = [meta.file, meta.thumb, `${meta.id}.json`].filter(Boolean)
  for (const f of files) {
    const src = path.join(UPLOADS_DIR, safeName(f))
    if (fs.existsSync(src)) moveFile(src, path.join(payload, safeName(f)))
  }
  const deletedAt = nowIso()
  return publicItem(writeItem({
    id,
    type: 'upload',
    originalId: meta.id,
    name: meta.name || meta.title || '参考图',
    title: meta.title || '',
    platform: meta.platform || '',
    width: meta.width || null,
    height: meta.height || null,
    createdAt: meta.createdAt || '',
    deletedAt,
    expiresAt: expiresIso(deletedAt),
    preview: meta.file || meta.thumb || '',
    ...extra,
  }))
}

export function purgeTrash(days = 7) {
  ensureDirs()
  const cutoff = Date.now() - Math.max(1, Number(days) || 7) * 86400000
  let removed = 0
  let entries = []
  try { entries = fs.readdirSync(TRASH_DIR, { withFileTypes: true }) } catch { return 0 }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = path.join(TRASH_DIR, ent.name)
    const meta = readJson(path.join(dir, 'meta.json'), null)
    if (!meta) continue
    const at = new Date(meta.deletedAt || meta.expiresAt || 0).getTime()
    if (!Number.isFinite(at) || at > cutoff) continue
    try { fs.rmSync(dir, { recursive: true, force: true }); removed++ } catch {}
  }
  return removed
}

export function listTrash() {
  purgeTrash(7)
  ensureDirs()
  const out = []
  let entries = []
  try { entries = fs.readdirSync(TRASH_DIR, { withFileTypes: true }) } catch { return out }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = path.join(TRASH_DIR, ent.name)
    const meta = readJson(path.join(dir, 'meta.json'), null)
    if (!meta) continue
    let preview = meta.preview || ''
    try {
      if (meta.type === 'project') {
        const project = readJson(path.join(dir, 'payload', 'project.json'), null)
        if (project) preview = project.cover || project.thumb || preview
      } else if (meta.type === 'upload') {
        const upload = readJson(path.join(dir, 'payload', `${safeName(meta.originalId)}.json`), null)
        if (upload) preview = upload.file || upload.thumb || preview
      }
    } catch {}
    out.push(publicItem({ ...meta, preview }))
  }
  out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
  return out
}

export function restoreTrash(id) {
  const dir = itemDir(id)
  const meta = dir ? readJson(path.join(dir, 'meta.json'), null) : null
  if (!meta) throw new Error('回收站项目不存在或已过期')
  const payload = path.join(dir, 'payload')
  if (!fs.existsSync(payload)) throw new Error('回收站文件已丢失')
  if (meta.type === 'project') {
    const project = readJson(path.join(payload, 'project.json'), null)
    let targetId = safeName(project?.id || meta.originalId || newId('p'))
    let target = path.join(PROJECTS_DIR, targetId)
    if (fs.existsSync(target)) {
      targetId = newId('p')
      target = path.join(PROJECTS_DIR, targetId)
      if (project) {
        project.id = targetId
        writeJson(path.join(payload, 'project.json'), project)
      }
    }
    moveDir(payload, target)
    fs.rmSync(dir, { recursive: true, force: true })
    return { type: 'project', id: targetId, title: meta.title }
  }
  if (meta.type === 'upload') {
    const upload = readJson(path.join(payload, `${safeName(meta.originalId)}.json`), null)
    let targetId = safeName(upload?.id || meta.originalId || newId('u'))
    if (fs.existsSync(path.join(UPLOADS_DIR, `${targetId}.json`))) targetId = newId('u')
    const oldFile = safeName(upload?.file || meta.preview || '')
    const oldThumb = safeName(upload?.thumb || '')
    const ext = path.extname(oldFile) || '.png'
    const file = `${targetId}${ext}`
    const thumb = oldThumb ? `${targetId}_thumb.jpg` : ''
    if (oldFile && fs.existsSync(path.join(payload, oldFile))) moveFile(path.join(payload, oldFile), path.join(UPLOADS_DIR, safeName(file)))
    if (oldThumb && fs.existsSync(path.join(payload, oldThumb))) moveFile(path.join(payload, oldThumb), path.join(UPLOADS_DIR, safeName(thumb)))
    if (upload) {
      upload.id = targetId
      upload.file = file
      upload.thumb = thumb || upload.thumb || ''
      upload.temporary = false
      writeJson(path.join(UPLOADS_DIR, `${targetId}.json`), upload)
    }
    fs.rmSync(dir, { recursive: true, force: true })
    return { type: 'upload', id: targetId, name: meta.name, title: meta.title, refs: Array.isArray(meta.refs) ? meta.refs : [], learnedRefs: Array.isArray(meta.learnedRefs) ? meta.learnedRefs : [] }
  }
  throw new Error('未知回收站类型')
}

export function destroyTrash(id) {
  const dir = itemDir(id)
  if (!dir || !fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

export function emptyTrash() {
  ensureDirs()
  let entries = []
  try { entries = fs.readdirSync(TRASH_DIR, { withFileTypes: true }) } catch { return 0 }
  let removed = 0
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = path.join(TRASH_DIR, ent.name)
    if (!fs.existsSync(path.join(dir, 'meta.json'))) continue
    try { fs.rmSync(dir, { recursive: true, force: true }); removed++ } catch {}
  }
  return removed
}
