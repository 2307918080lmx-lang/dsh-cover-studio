import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import {
  DATA_DIR,
  PLUGIN_ROOT,
  MIME_BY_EXT,
  ensureDirs,
  detectImageType,
  parseDataUrl,
  safeName,
  isWithin,
  readJson,
  truncate,
  newId,
} from './util.js'
import {
  loadSettings,
  saveSettings,
  publicSettings,
  normalizeRelay,
} from './settings.js'
import {
  listProjects,
  getProject,
  publicProject,
  deleteProject,
  listUploads,
  getUpload,
  saveUpload,
  saveUploadAnalysis,
  deleteUpload,
  updateUploadMeta,
  uploadPath,
  saveProject,
  saveProjectCover,
  copyToOutput,
  resolveFile,
  projectDir,
  saveFontFile,
  fontFilePath,
} from './store.js'
import { trashProject, trashUpload, listTrash, restoreTrash, destroyTrash, emptyTrash, purgeTrash } from './trash.js'
import {
  runGeneration,
  regenerateProject,
  reframeProject,
  editProject,
  exportProject,
  createManualProject,
} from './generate.js'
import { LlmClient } from './llm.js'
import { RelayClient } from './relay.js'
import { renderCover } from './render.js'
import { allStyles, exclusiveProfile, getStyle } from './styles.js'
import { saveBackground as saveBgFile } from './store.js'
import { RATIO_PRESETS } from './ratios.js'
import { downloadVideoCover } from './platforms.js'
import { harvestSection, harvestCreator, findReferenceImages } from './harvest.js'
import { extractDocumentText } from './document.js'
import { renderDirectionSketch } from './inspire.js'
import { cutoutImage } from './cutout.js'
import { publicCreator, publicCreatorLive, fetchCreatorAvatar } from './creator.js'
import { createTemplateProject, remixTemplateProject } from './template.js'
import { REPO_URL, checkForUpdate, applyUpdate } from './update.js'

const execFileAsync = promisify(execFile)
const ROUTE = '/dsh-cover-studio'
const UPDATE_TOKEN = randomBytes(16).toString('hex')

function pluginVersion() {
  return String(readJson(path.join(PLUGIN_ROOT, 'package.json'), {})?.version || '1.3.1')
}
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function isTrusted(req) {
  try {
    const headers = req?.headers ?? {}
    if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false
    const origin = headers.origin
    if (typeof origin !== 'string' || !origin || origin === 'null') return true
    if (origin === 'dsh-app://app') return true
    let hostUrl
    let originUrl
    try { hostUrl = new URL(`http://${String(headers.host ?? '')}`) } catch { return false }
    try { originUrl = new URL(origin) } catch { return false }
    return originUrl.host.toLowerCase() === hostUrl.host.toLowerCase()
  } catch {
    return false
  }
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function sendError(res, code, message) {
  sendJson(res, code, { ok: false, error: truncate(String(message || 'unknown error'), 1600) })
}

function serveFile(req, res, file, cache = 'no-cache') {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  const stat = fs.statSync(file)
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'content-type': MIME_BY_EXT[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': cache,
  })
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(file).pipe(res)
}

function parseMultipart(buffer, boundary) {
  const parts = []
  const delim = Buffer.from(`--${boundary}`)
  let start = buffer.indexOf(delim)
  while (start >= 0) {
    start += delim.length
    if (buffer.slice(start, start + 2).toString() === '--') break
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2
    const headerEnd = buffer.indexOf('\r\n\r\n', start)
    if (headerEnd < 0) break
    const headers = buffer.slice(start, headerEnd).toString('utf8')
    const next = buffer.indexOf(delim, headerEnd + 4)
    if (next < 0) break
    let contentEnd = next
    if (buffer[contentEnd - 2] === 0x0d && buffer[contentEnd - 1] === 0x0a) contentEnd -= 2
    const content = buffer.slice(headerEnd + 4, contentEnd)
    const name = /name="([^"]+)"/.exec(headers)?.[1] || ''
    const filename = /filename="([^"]*)"/.exec(headers)?.[1] || ''
    const type = /Content-Type:\s*([^\r\n]+)/i.exec(headers)?.[1] || ''
    parts.push({ name, filename, type, content })
    start = next
  }
  return parts
}

function mergePatch(current, patch) {
  const next = { ...current }
  const scalar = ['enabled', 'outputDir', 'coverDownloadDir', 'defaultRatio', 'defaultCount', 'autoSave', 'fontSerif', 'fontSans', 'defaultRelayId', 'defaultModel']
  for (const key of scalar) if (patch[key] !== undefined) next[key] = patch[key]
  if (Array.isArray(patch.defaultStyles)) next.defaultStyles = patch.defaultStyles
  if (Array.isArray(patch.customStyles)) next.customStyles = patch.customStyles
  if (Array.isArray(patch.sections)) next.sections = patch.sections
  if (Array.isArray(patch.customFonts)) next.customFonts = patch.customFonts
  if (patch.mainModel && typeof patch.mainModel === 'object') next.mainModel = { ...current.mainModel, ...patch.mainModel }
  if (patch.ui && typeof patch.ui === 'object') next.ui = { ...current.ui, ...patch.ui }
  if (patch.learned && typeof patch.learned === 'object') next.learned = { ...current.learned, ...patch.learned }
  if (Array.isArray(patch.relays)) next.relays = patch.relays
  return next
}

async function pickFolder(initial) {
  const safeInitial = String(initial || '').replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '选择封面保存位置'",
    `$d.SelectedPath = '${safeInitial}'`,
    "$r = $d.ShowDialog()",
    "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }",
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 180000, windowsHide: true })
    return String(stdout || '').trim()
  } catch (err) {
    throw new Error(`无法打开文件夹选择器：${err?.message || err}`)
  }
}

export function createServer({ ctx, secrets, jobs, log, getOpenState, setOpenState }) {
  ensureDirs()
  const imageQueryCache = new Map()
  try { purgeTrash(7) } catch {}

  function pruneMissingUploads(settings) {
    const uploads = listUploads()
    const uploadMap = new Map(uploads.map((u) => [u.id, u]))
    let changed = false
    const sections = (settings.sections || []).map((sec) => {
      const refs = (sec.refs || []).filter((r) => {
        const u = uploadMap.get(r.uploadId)
        if (!u) return false
        if (u.width && u.width < 900) return false
        if (u.height && u.height < 450) return false
        return true
      })
      let types = Array.isArray(sec.types) ? sec.types.slice() : []
      if (refs.length !== (sec.refs || []).length) changed = true
      types = types.map((t) => {
        if (t.refUploadId && !uploadMap.has(t.refUploadId)) {
          changed = true
          return { ...t, refUploadId: refs[0]?.uploadId || '' }
        }
        return t
      })
      return { ...sec, refs, types }
    })
    const learnedRefs = Array.isArray(settings.learned?.references)
      ? settings.learned.references.filter((r) => !r.id || uploadMap.has(r.id))
      : []
    if (learnedRefs.length !== (settings.learned?.references || []).length) changed = true
    if (changed) {
      settings.sections = sections
      settings.learned = { ...(settings.learned || {}), references: learnedRefs }
      saveSettings(settings)
    }
    return settings
  }

  function cleanupUploadRefs(uploadId) {
    const settings = loadSettings()
    let changed = false
    for (const sec of settings.sections || []) {
      const before = (sec.refs || []).length
      sec.refs = (sec.refs || []).filter((r) => r.uploadId !== uploadId)
      if (sec.refs.length !== before) changed = true
      const types = Array.isArray(sec.types) ? sec.types : []
      for (const t of types) {
        if (t.refUploadId === uploadId) {
          t.refUploadId = sec.refs[0]?.uploadId || ''
          changed = true
        }
      }
      sec.types = types
    }
    if (Array.isArray(settings.learned?.references)) {
      const before = settings.learned.references.length
      settings.learned.references = settings.learned.references.filter((r) => r.id !== uploadId)
      if (settings.learned.references.length !== before) changed = true
    }
    if (changed) saveSettings(settings)
  }

  async function current() {
    const settings = pruneMissingUploads(loadSettings())
    return { settings, public: await publicSettings(settings, secrets) }
  }

  async function handleState(req, res) {
    if (req.method === 'GET') {
      const { settings, public: pub } = await current()
      const llm = new LlmClient({ ctx, settings, secrets, log })
      pub.mainModel.dshLlmAvailable = !!llm.llmService()
      let models = { providers: [], models: [], source: 'none' }
      try { models = await llm.listDshModels() } catch {}
      sendJson(res, 200, {
        ok: true,
        settings: pub,
        styles: allStyles(settings),
        exclusive: {
          name: exclusiveProfile()?.name,
          tagline: exclusiveProfile()?.tagline,
          summary: exclusiveProfile()?.summary,
          principles: exclusiveProfile()?.principles || [],
          typography: exclusiveProfile()?.typography || {},
          learned: settings.learned,
        },
        projects: listProjects(),
        uploads: listUploads(),
        models,
        ratios: RATIO_PRESETS,
        outputDirExists: fs.existsSync(settings.outputDir),
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        version: pluginVersion(),
        repoUrl: REPO_URL,
        updateToken: UPDATE_TOKEN,
        creator: publicCreator(),
      })
      return
    }
    if (req.method !== 'POST' && req.method !== 'PUT') return sendError(res, 405, 'method not allowed')
    const raw = await readBody(req, 2 * 1024 * 1024)
    let patch
    try { patch = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    if (!patch || typeof patch !== 'object') return sendError(res, 400, 'payload 无效')
    const settings = loadSettings()
    const keyUpdates = []
    let mainKeyUpdate = null
    if (Array.isArray(patch.relays)) {
      patch.relays = patch.relays.map((r) => {
        const copy = { ...r }
        if (typeof copy.apiKey === 'string' && copy.apiKey.trim()) keyUpdates.push([copy.id, copy.apiKey.trim()])
        if (copy.clearKey) keyUpdates.push([copy.id, ''])
        delete copy.apiKey
        delete copy.clearKey
        return copy
      })
    }
    if (typeof patch.mainModelApiKey === 'string') {
      if (patch.mainModelApiKey.trim()) mainKeyUpdate = patch.mainModelApiKey.trim()
      else if (patch.clearMainKey) mainKeyUpdate = ''
    }
    if (patch.clearMainKey && mainKeyUpdate === null) mainKeyUpdate = ''
    delete patch.mainModelApiKey
    delete patch.clearMainKey
    const merged = mergePatch(settings, patch)
    const saved = saveSettings(merged)
    for (const [id, key] of keyUpdates) {
      if (!id) continue
      if (key) await secrets.setRelayKey(id, key)
      else await secrets.deleteRelayKey(id)
    }
    if (mainKeyUpdate !== null) await secrets.setMainKey(mainKeyUpdate)
    const after = loadSettings()
    const pub = await publicSettings(after, secrets)
    pub.mainModel.dshLlmAvailable = !!new LlmClient({ ctx, settings: after, secrets, log }).llmService()
    sendJson(res, 200, { ok: true, settings: pub, styles: allStyles(after) })
  }

  async function handleUpload(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const ctype = String(req.headers['content-type'] || '')
    let buffer = null
    let name = 'upload.png'
    let mime = ''
    if (ctype.includes('application/json')) {
      const raw = await readBody(req, 60 * 1024 * 1024)
      let body
      try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
      const parsed = parseDataUrl(body.dataUrl)
      if (!parsed) return sendError(res, 400, 'dataUrl 无效')
      buffer = parsed.buffer
      mime = parsed.mime
      name = body.name || name
    } else if (ctype.includes('multipart/form-data')) {
      const boundary = /boundary=([^;]+)/.exec(ctype)?.[1]?.replace(/^"|"$/g, '')
      if (!boundary) return sendError(res, 400, '缺少 multipart boundary')
      const raw = await readBody(req, 60 * 1024 * 1024)
      const parts = parseMultipart(raw, boundary)
      const filePart = parts.find((p) => p.name === 'file') || parts.find((p) => p.filename)
      if (!filePart) return sendError(res, 400, '没有收到文件')
      buffer = filePart.content
      mime = filePart.type
      name = safeName(filePart.filename || name)
    } else {
      return sendError(res, 415, '请用 multipart/form-data 或 JSON dataUrl 上传')
    }
    if (!buffer || !buffer.length) return sendError(res, 400, '空文件')
    if (buffer.length > 50 * 1024 * 1024) return sendError(res, 413, '图片超过 50MB')
    const type = detectImageType(buffer)
    if (!type) return sendError(res, 415, '暂不支持这个图片格式（支持 PNG/JPG/WebP/GIF/BMP/AVIF/TIFF/HEIC）')
    const { normalizeUpload } = await import('./render.js')
    const normalized = await normalizeUpload(buffer, loadSettings())
    const meta = await saveUpload(normalized.png, {
      name,
      mime: 'image/png',
      ext: '.png',
      width: normalized.width,
      height: normalized.height,
      normalized: normalized.png,
    })
    sendJson(res, 200, { ok: true, upload: meta })
  }

  async function handleAnalyze(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const raw = await readBody(req, 1024 * 1024)
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : [])
    if (!ids.length) return sendError(res, 400, '缺少参考图 id')
    const settings = loadSettings()
    const llm = new LlmClient({ ctx, settings, secrets, log })
    const out = []
    for (const id of ids.slice(0, 8)) {
      const meta = getUpload(id)
      if (!meta) { out.push({ id, ok: false, error: '参考图不存在' }); continue }
      try {
        const buffer = fs.readFileSync(uploadPath(meta))
        const result = await llm.analyzeReference({ buffer, name: meta.name, index: out.length })
        saveUploadAnalysis(meta.id, result.analysis)
        out.push({ id, ok: true, analysis: result.analysis, model: result.model })
      } catch (err) {
        out.push({ id, ok: false, error: String(err?.message || err) })
      }
    }
    sendJson(res, 200, { ok: true, results: out, uploads: listUploads() })
  }

  async function handleGenerate(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const raw = await readBody(req, 2 * 1024 * 1024)
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const settings = loadSettings()
    const count = Math.min(6, Math.max(1, Number.parseInt(body.count, 10) || settings.defaultCount))
    const job = jobs.create('generate', { total: count })
    jobs.run(job.id, ({ signal, progress }) => runGeneration({
      ctx, settings, secrets, log, body, jobManager: jobs, jobId: job.id, signal, progress,
    }))
    sendJson(res, 200, { ok: true, jobId: job.id })
  }

  async function handleJob(req, res, id, action) {
    if (action === 'cancel') {
      const ok = jobs.cancel(id)
      sendJson(res, 200, { ok })
      return
    }
    const job = jobs.get(id)
    if (!job) return sendError(res, 404, '任务不存在')
    sendJson(res, 200, { ok: true, job })
  }

  async function handleDownload(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const settings = loadSettings()
    const dir = String(body.dir || settings.coverDownloadDir || '').trim()
    const got = await downloadVideoCover(body.url, { dir, saveToLibrary: true })
    let upload = got.upload
    if (body.analyze && upload) {
      try {
        const meta = getUpload(upload.id)
        const buffer = fs.readFileSync(uploadPath(meta))
        const llm = new LlmClient({ ctx, settings, secrets, log })
        const result = await llm.analyzeReference({ buffer, name: meta.name, index: 0 })
        saveUploadAnalysis(upload.id, result.analysis)
        upload = getUpload(upload.id)
      } catch (err) {
        log(`[download] analyze failed: ${err?.message || err}`)
      }
    }
    sendJson(res, 200, {
      ok: true,
      upload,
      dir,
      file: got.downloadPath || '',
      platform: got.platform,
      title: got.title,
      author: got.author,
      views: got.views,
      size: got.buffer.length,
    })
  }

  async function handleSearchImages(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const query = String(body.query || '').trim()
    if (!query) return sendError(res, 400, '缺少搜索关键词')
    const settings = loadSettings()
    const provider = String(body.provider || 'auto')
    const site = String(body.site || '').trim().slice(0, 300)
    const cacheKey = query + '|' + provider + '|' + site
    let expanded = imageQueryCache.get(cacheKey)
    if (!expanded) {
      try {
        const llm = new LlmClient({ ctx, settings, secrets, log })
        expanded = await llm.expandImageQuery({ query })
      } catch (err) {
        expanded = { queries: [query], avoid: [] }
      }
      imageQueryCache.set(cacheKey, expanded)
      if (imageQueryCache.size > 80) imageQueryCache.delete(imageQueryCache.keys().next().value)
    }
    const result = await findReferenceImages({
      query,
      queries: expanded.queries,
      avoid: expanded.avoid,
      settings,
      provider,
      site,
      count: Math.min(12, Math.max(1, Number(body.count) || 4)),
      page: Math.max(1, Number(body.page) || 1),
      temporary: body.temporary === true,
      log,
    })
    sendJson(res, 200, { ok: true, uploads: result.uploads, candidates: result.candidates, page: result.page, duplicateOnly: !!result.duplicateOnly, queries: expanded.queries, avoid: expanded.avoid })
  }

  async function handleCutout(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const ctype = String(req.headers['content-type'] || '')
    if (!ctype.includes('multipart/form-data')) return sendError(res, 415, '请用 multipart/form-data 上传要抠图的画面')
    const boundary = /boundary=([^;]+)/.exec(ctype)?.[1]?.replace(/^"|"$/g, '')
    if (!boundary) return sendError(res, 400, '缺少 boundary')
    const raw = await readBody(req, 32 * 1024 * 1024)
    const parts = parseMultipart(raw, boundary)
    const filePart = parts.find((p) => p.name === 'file') || parts.find((p) => p.filename)
    if (!filePart?.content?.length) return sendError(res, 400, '没有收到图片')
    const type = detectImageType(filePart.content)
    if (!type) return sendError(res, 415, '上传内容不是图片')
    const modePart = parts.find((p) => p.name === 'mode')
    const promptPart = parts.find((p) => p.name === 'prompt')
    const boxPart = parts.find((p) => p.name === 'box')
    const maskPart = parts.find((p) => p.name === 'mask')
    const mode = String(modePart?.content?.toString('utf8') || 'smart').trim()
    const prompt = String(promptPart?.content?.toString('utf8') || '').slice(0, 300)
    let box = null
    if (boxPart?.content?.length) {
      try { box = JSON.parse(boxPart.content.toString('utf8')) } catch { box = null }
    }
    if (mode === 'brush' && !maskPart?.content?.length) return sendError(res, 400, '画笔抠图缺少蒙版')
    const settings = loadSettings()
    const llm = new LlmClient({ ctx, settings, secrets, log })
    const result = await cutoutImage({
      buffer: filePart.content,
      mode,
      box,
      prompt,
      maskBuffer: maskPart?.content || null,
      llm: mode === 'smart' ? llm : null,
      log,
    })
    const upload = await saveUpload(result.buffer, {
      name: `抠图_${result.subject || Date.now().toString(36)}.png`,
      mime: 'image/png',
      ext: '.png',
      width: result.width,
      height: result.height,
      platform: 'cutout',
      title: result.subject ? `抠图 · ${result.subject}` : '抠图结果',
      author: '本地抠图',
      views: 0,
    })
    let backgroundUpload = null
    if (result.backgroundBuffer) {
      backgroundUpload = await saveUpload(result.backgroundBuffer, {
        name: `抠图背景_${Date.now().toString(36)}.png`,
        mime: 'image/png',
        ext: '.png',
        width: result.sourceWidth || result.width,
        height: result.sourceHeight || result.height,
        platform: 'cutout',
        title: '背景 · 已去主体',
        author: '本地抠图',
        views: 0,
      })
    }
    sendJson(res, 200, {
      ok: true,
      upload,
      backgroundUpload,
      box: result.box,
      crop: result.crop || null,
      sourceWidth: result.sourceWidth || result.width,
      sourceHeight: result.sourceHeight || result.height,
      subject: result.subject,
      method: result.method,
      coverage: result.coverage,
      note: result.note,
    })
  }

  async function handleSections(req, res, action) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const settings = loadSettings()
    const sections = settings.sections || []
    if (action === 'harvest') {
      const section = sections.find((s) => s.id === body.sectionId)
      if (!section) return sendError(res, 404, '分区不存在')
      const page = Math.max(1, Number(body.page) || 1)
      const result = await harvestSection({ section, settings, count: Math.min(8, Math.max(1, Number(body.count) || 4)), page, log })
      const seen = new Set()
      section.refs = [...result.refs, ...(section.refs || [])].filter((r) => {
        const key = String(r.bvid || r.sourceUrl || r.uploadId || '')
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 80)
      section.harvestCursor = page + 1
      section.learned = null
      section.types = []
      saveSettings({ ...settings, sections })
      return sendJson(res, 200, { ok: true, section, sections, uploads: listUploads(), failed: result.failed, dir: result.dir, page, added: result.refs.length })
    }
    if (action === 'creator') {
      const section = sections.find((s) => s.id === body.sectionId)
      if (!section) return sendError(res, 404, '分区不存在')
      const creator = String(body.creator || '').trim()
      if (!creator) return sendError(res, 400, '先填写 UP 主名字或空间链接')
      const result = await harvestCreator({
        section,
        settings,
        creator,
        count: Math.min(12, Math.max(1, Number(body.count) || 6)),
        page: Math.max(1, Number(body.page) || 1),
        log,
      })
      const seen = new Set()
      section.refs = [...result.refs, ...(section.refs || [])].filter((r) => {
        const key = String(r.bvid || r.sourceUrl || r.uploadId || '')
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 80)
      section.creator = result.creator
      section.learned = null
      section.types = []
      saveSettings({ ...settings, sections })
      return sendJson(res, 200, { ok: true, section, sections, uploads: listUploads(), failed: result.failed, creator: result.creator, mid: result.mid, dir: result.dir, added: result.refs.length })
    }
    if (action === 'learn') {
      const section = sections.find((s) => s.id === body.sectionId)
      if (!section) return sendError(res, 404, '分区不存在')
      const requested = Array.isArray(body.uploadIds) ? body.uploadIds.map(String) : []
      const selectedRefs = requested.length
        ? (section.refs || []).filter((r) => requested.includes(r.uploadId)).slice(0, 8)
        : []
      const refs = selectedRefs.length ? selectedRefs : (section.refs || []).slice(0, 8)
      if (!refs.length) return sendError(res, 400, '这个分区还没有参考封面，先抓取或添加参考图')
      const llm = new LlmClient({ ctx, settings, secrets, log })
      const enriched = []
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i]
        const meta = getUpload(ref.uploadId)
        if (!meta) continue
        let analysis = meta.analysis
        if (!analysis?.summary) {
          try {
            const buffer = fs.readFileSync(uploadPath(meta))
            const result = await llm.analyzeReference({ buffer, name: meta.name, index: i })
            analysis = result.analysis
            saveUploadAnalysis(meta.id, analysis)
          } catch (err) {
            log(`[section learn] ${meta.name}: ${err?.message || err}`)
            analysis = { summary: '参考图（未能自动分析）' }
          }
        }
        enriched.push({ uploadId: meta.id, upload: meta, title: ref.title || meta.title, author: ref.author, views: ref.views, analysis })
      }
      if (!enriched.length) return sendError(res, 400, '参考图都不存在了，请重新抓取')
      const result = await llm.learnSection({ section, references: enriched })
      section.learned = result.learned
      section.types = result.learned.coverTypes || []
      saveSettings({ ...settings, sections })
      return sendJson(res, 200, { ok: true, section, sections, learned: result.learned, via: result.via, model: result.model, uploads: listUploads() })
    }
    if (action === 'remove') {
      const section = sections.find((s) => s.id === body.sectionId)
      if (!section) return sendError(res, 404, '分区不存在')
      const ids = new Set((Array.isArray(body.uploadIds) ? body.uploadIds : []).map(String))
      if (!ids.size) return sendError(res, 400, '先勾选要移除的封面')
      const before = (section.refs || []).length
      section.refs = (section.refs || []).filter((r) => !ids.has(String(r.uploadId || '')))
      const fallback = section.refs[0]?.uploadId || ''
      section.types = (section.types || []).map((t) => ids.has(String(t.refUploadId || '')) ? { ...t, refUploadId: fallback } : t)
      const removed = before - section.refs.length
      saveSettings({ ...settings, sections })
      return sendJson(res, 200, { ok: true, removed, section, sections, uploads: listUploads() })
    }
    if (action === 'save') {
      const input = body.section && typeof body.section === 'object' ? body.section : {}
      const id = String(input.id || '').trim()
      if (id) {
        const idx = sections.findIndex((s) => s.id === id)
        if (idx < 0) return sendError(res, 404, '分区不存在')
        sections[idx] = { ...sections[idx], ...input, id, refs: sections[idx].refs, learned: sections[idx].learned }
      } else {
        const newSection = { ...input, id: '', order: sections.length, refs: [], types: [], learned: null }
        sections.push(newSection)
      }
      const saved = saveSettings({ ...settings, sections })
      return sendJson(res, 200, { ok: true, sections: saved.sections, section: saved.sections.find((s) => s.name === input.name) || null })
    }
    if (action === 'delete') {
      const id = String(body.sectionId || '').trim()
      const next = sections.filter((s) => s.id !== id)
      if (next.length === sections.length) return sendError(res, 404, '分区不存在')
      const saved = saveSettings({ ...settings, sections: next })
      return sendJson(res, 200, { ok: true, sections: saved.sections })
    }
    return sendError(res, 404, 'unknown section action')
  }

  async function handleInspire(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const settings = loadSettings()
    const llm = new LlmClient({ ctx, settings, secrets, log })
    const result = await llm.inspire({
      brief: body.brief || '',
      title: body.title || '',
      subtitle: body.subtitle || '',
      ratio: body.ratio || settings.defaultRatio || '16:9',
      styles: Array.isArray(body.styles) && body.styles.length ? body.styles : settings.defaultStyles,
      count: 4,
      documentText: String(body.documentText || '').slice(0, 8000),
    })
    const directions = []
    for (let i = 0; i < result.directions.length; i++) {
      const d = result.directions[i]
      try {
        const sketch = await renderDirectionSketch({ direction: d, ratio: body.ratio || settings.defaultRatio || '16:9', settings })
        const upload = await saveUpload(sketch.buffer, {
          name: `灵感板_${d.name || i + 1}.png`,
          mime: 'image/png',
          ext: '.png',
          platform: 'inspire',
          title: d.name || `方向 ${i + 1}`,
          author: 'AI 灵感板',
          views: 0,
        })
        directions.push({ ...d, uploadId: upload.id, sketchUrl: upload.url, thumbUrl: upload.thumbUrl, width: sketch.width, height: sketch.height })
      } catch (err) {
        log(`[inspire] sketch ${i + 1}: ${err?.message || err}`)
        directions.push({ ...d, sketchUrl: '', thumbUrl: '', uploadId: '' })
      }
    }
    sendJson(res, 200, { ok: true, directions, via: result.via, model: result.model, uploads: listUploads() })
  }

  async function handleDocument(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const ctype = String(req.headers['content-type'] || '')
    if (!ctype.includes('multipart/form-data')) return sendError(res, 415, '请用 multipart/form-data 上传文档')
    const boundary = /boundary=([^;]+)/.exec(ctype)?.[1]?.replace(/^"|"$/g, '')
    if (!boundary) return sendError(res, 400, '缺少 boundary')
    const raw = await readBody(req, 15 * 1024 * 1024)
    const parts = parseMultipart(raw, boundary)
    const filePart = parts.find((p) => p.name === 'file') || parts.find((p) => p.filename)
    if (!filePart?.content?.length) return sendError(res, 400, '没有收到文档')
    const result = extractDocumentText(filePart.content, filePart.filename || 'document.txt')
    sendJson(res, 200, { ok: true, name: filePart.filename || 'document', text: result.text, chars: result.text.length, kind: result.kind })
  }

  async function handleFontImport(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const ctype = String(req.headers['content-type'] || '')
    if (!ctype.includes('multipart/form-data')) return sendError(res, 415, '请用 multipart/form-data 上传字体')
    const boundary = /boundary=([^;]+)/.exec(ctype)?.[1]?.replace(/^"|"$/g, '')
    if (!boundary) return sendError(res, 400, '缺少 boundary')
    const raw = await readBody(req, 24 * 1024 * 1024)
    const parts = parseMultipart(raw, boundary)
    const filePart = parts.find((p) => p.name === 'file') || parts.find((p) => p.filename)
    if (!filePart?.content?.length) return sendError(res, 400, '没有收到字体文件')
    const ext = path.extname(filePart.filename || '').toLowerCase()
    if (!['.ttf', '.otf', '.woff2'].includes(ext)) return sendError(res, 415, '只支持 TTF / OTF / WOFF2 字体')
    const familyPart = parts.find((p) => p.name === 'family')
    const family = String(familyPart?.content?.toString('utf8') || '').trim().slice(0, 60)
      || path.basename(filePart.filename || '自定义字体', ext).slice(0, 40)
    const settings = loadSettings()
    const id = newId('f')
    const fileName = `${safeName(id)}${ext}`
    saveFontFile(filePart.content, fileName)
    const mime = MIME_BY_EXT[ext] || 'font/ttf'
    const font = { id, family, file: fileName, mime, path: path.join(DATA_DIR, 'fonts', fileName), createdAt: new Date().toISOString() }
    settings.customFonts = [...(settings.customFonts || []), font]
    saveSettings(settings)
    const pub = await publicSettings(loadSettings(), secrets)
    sendJson(res, 200, { ok: true, font: pub.customFonts.find((f) => f.id === id), customFonts: pub.customFonts })
  }

  async function handleManualCreate(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const settings = loadSettings()
    const upload = body.uploadId ? getUpload(body.uploadId) : null
    if (body.uploadId && !upload) return sendError(res, 404, '底图不存在')
    const project = await createManualProject({
      settings,
      title: String(body.title || '手动创作').slice(0, 60),
      ratio: body.ratio || settings.defaultRatio,
      upload,
    })
    sendJson(res, 200, { ok: true, project })
  }

  async function handleProjects(req, res, id, action) {
    if (!id) {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, projects: listProjects() })
      return sendError(res, 405, 'method not allowed')
    }
    if (action === 'export') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      const project = getProject(id)
      if (!project) return sendError(res, 404, '项目不存在')
      const settings = loadSettings()
      const raw = await readBody(req, 1024 * 1024).catch(() => Buffer.from('{}'))
      let body = {}
      try { body = JSON.parse(raw.toString('utf8') || '{}') } catch {}
      const out = copyToOutput(project, body.outputDir || settings.outputDir)
      return sendJson(res, 200, { ok: true, ...out })
    }
    if (action === 'remix-template') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      let body = {}
      try { body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
      try {
        const settings = loadSettings()
        const relay = new RelayClient({ settings, secrets, log })
        const result = await remixTemplateProject({
          settings,
          secrets,
          relay,
          log,
          projectId: id,
          prompt: body.prompt,
          subjectDescription: body.subjectDescription,
          subjectUploadId: body.subjectUploadId,
        })
        return sendJson(res, 200, { ok: true, ...result, projects: listProjects() })
      } catch (err) {
        return sendError(res, 500, 'AI 重绘失败：' + err.message)
      }
    }
    if (action === 'reframe') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      const raw = await readBody(req, 1024 * 1024).catch(() => Buffer.from('{}'))
      let body = {}
      try { body = JSON.parse(raw.toString('utf8') || '{}') } catch {}
      const mode = body.mode === 'local' ? 'local' : 'ai'
      const job = jobs.create('reframe', { total: 1, projectId: id, ratio: body.ratio, mode })
      jobs.run(job.id, async ({ signal, progress }) => {
        const result = await reframeProject({
          settings: loadSettings(),
          secrets,
          log,
          projectId: id,
          ratio: body.ratio,
          mode,
          preserve: body.preserve !== false,
          signal,
          progress,
        })
        return [{ ok: true, ...result }]
      })
      return sendJson(res, 200, { ok: true, jobId: job.id })
    }
    if (action === 'regenerate') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      const raw = await readBody(req, 1024 * 1024).catch(() => Buffer.from('{}'))
      let body = {}
      try { body = JSON.parse(raw.toString('utf8') || '{}') } catch {}
      const job = jobs.create('regenerate', { total: 1, projectId: id })
      jobs.run(job.id, async () => {
        const project = await regenerateProject({ ctx, settings: loadSettings(), secrets, log, projectId: id, body })
        return [{ ok: true, project }]
      })
      return sendJson(res, 200, { ok: true, jobId: job.id })
    }
    if (action === 'edit') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      const raw = await readBody(req, 1024 * 1024)
      let body
      try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
      const instruction = String(body.instruction || '').trim()
      if (!instruction) return sendError(res, 400, '缺少修改要求')
      const result = await editProject({ ctx, settings: loadSettings(), secrets, log, projectId: id, instruction })
      return sendJson(res, 200, { ok: true, ...result })
    }
    if (action === 'layers') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      const raw = await readBody(req, 30 * 1024 * 1024)
      let body
      try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
      const project = getProject(id)
      if (!project) return sendError(res, 404, '项目不存在')
      const layers = Array.isArray(body.layers) ? body.layers : project.layers
      if (body.backgroundRect && typeof body.backgroundRect === 'object') project.backgroundRect = body.backgroundRect
      else if (body.backgroundRect === null) project.backgroundRect = null
      if (body.backgroundFilter && typeof body.backgroundFilter === 'object') project.backgroundFilter = body.backgroundFilter
      if (typeof body.backgroundVisible === 'boolean') project.backgroundVisible = body.backgroundVisible
      if (body.dataUrl) {
        const parsed = parseDataUrl(body.dataUrl)
        if (!parsed?.buffer?.length) return sendError(res, 400, '导出图无效')
        project.layers = layers
        saveProject(project)
        await saveProjectCover(project, parsed.buffer)
        return sendJson(res, 200, { ok: true, project: publicProject(getProject(id)) })
      }
      const bg = project.background ? path.join(projectDir(id), project.background) : ''
      if (!bg || !fs.existsSync(bg)) return sendError(res, 400, '项目缺少背景图')
      const variant = { ...(project.variant || {}), title: body.title || project.title, subtitle: body.subtitle || project.subtitle }
      const rendered = await renderCover({
        backgroundBuffer: fs.readFileSync(bg),
        variant,
        ratio: project.ratio,
        settings: loadSettings(),
        layers,
        backgroundRect: project.backgroundRect,
        backgroundFilter: project.backgroundFilter,
        backgroundVisible: project.backgroundVisible !== false,
      })
      project.layers = rendered.layers
      if (body.title) project.title = body.title
      if (body.subtitle) project.subtitle = body.subtitle
      saveProject(project)
      await saveProjectCover(project, rendered.buffer)
      return sendJson(res, 200, { ok: true, project: publicProject(getProject(id)) })
    }
    const project = getProject(id)
    if (!project) return sendError(res, 404, '项目不存在')
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, project: publicProject(project) })
    if (req.method === 'DELETE') {
      try {
        const item = trashProject(project)
        return sendJson(res, 200, { ok: true, trash: item })
      } catch (err) {
        return sendError(res, 500, '移入回收站失败：' + err.message)
      }
    }
    return sendError(res, 405, 'method not allowed')
  }

  async function handleRelay(req, res, action) {
    if (action === 'test') {
      const raw = await readBody(req, 1024 * 1024)
      let body
      try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
      const settings = loadSettings()
      const result = await new RelayClient({ settings, secrets, log }).test(body.relayId || settings.defaultRelayId)
      return sendJson(res, 200, { ok: true, result })
    }
    if (action === 'models') {
      const raw = await readBody(req, 1024 * 1024).catch(() => Buffer.from('{}'))
      let body = {}
      try { body = JSON.parse(raw.toString('utf8') || '{}') } catch {}
      const settings = loadSettings()
      const result = await new RelayClient({ settings, secrets, log }).listModels(body.relayId || settings.defaultRelayId)
      return sendJson(res, 200, { ok: true, ...result })
    }
    return sendError(res, 404, 'unknown relay action')
  }

  async function handleMain(req, res, action) {
    if (action === 'test') {
      const settings = loadSettings()
      const result = await new LlmClient({ ctx, settings, secrets, log }).testMain()
      return sendJson(res, 200, { ok: true, result })
    }
    if (action === 'models') {
      const settings = loadSettings()
      const result = await new LlmClient({ ctx, settings, secrets, log }).listDshModels()
      return sendJson(res, 200, { ok: true, ...result })
    }
    return sendError(res, 404, 'unknown main action')
  }

  async function handleUpdate(req, res, action) {
    if (action === 'check') {
      if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
      const force = new URL(req.url || '/', 'http://localhost').searchParams.get('force') === '1'
      const result = await checkForUpdate({ force, currentVersion: pluginVersion(), log })
      return sendJson(res, 200, result)
    }
    if (action === 'apply') {
      if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
      let body = {}
      try { body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}') } catch { return sendError(res, 400, 'JSON 无效') }
      if (String(body.token || '') !== UPDATE_TOKEN) return sendError(res, 403, '更新令牌无效，请刷新界面重试')
      const result = await applyUpdate({ version: String(body.version || ''), log })
      return sendJson(res, 200, result)
    }
    return sendError(res, 404, 'unknown update action')
  }

  async function handleLearn(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    const raw = await readBody(req, 1024 * 1024)
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const ids = Array.isArray(body.ids) ? body.ids : []
    if (!ids.length) return sendError(res, 400, '缺少参考图 id')
    const settings = loadSettings()
    const llm = new LlmClient({ ctx, settings, secrets, log })
    const notes = []
    const refs = []
    for (const id of ids.slice(0, 6)) {
      const meta = getUpload(id)
      if (!meta) continue
      try {
        const buffer = fs.readFileSync(uploadPath(meta))
        const result = await llm.analyzeReference({ buffer, name: meta.name, index: refs.length })
        saveUploadAnalysis(id, result.analysis)
        const a = result.analysis || {}
        notes.push(`参考「${meta.name}」：${truncate(a.summary || '', 300)}；构图：${truncate(a.composition || '', 300)}；字体：${truncate(a.typography || '', 200)}`)
        refs.push({ id, name: meta.name, summary: truncate(a.summary || '', 300), at: new Date().toISOString() })
      } catch (err) {
        log(`[learn] ${meta.name}: ${err?.message || err}`)
      }
    }
    settings.learned.notes = [...(settings.learned.notes || []), ...notes].slice(-40)
    settings.learned.references = [...(settings.learned.references || []), ...refs].slice(-40)
    settings.learned.updatedAt = new Date().toISOString()
    saveSettings(settings)
    return sendJson(res, 200, { ok: true, learned: settings.learned, notes })
  }

  async function handleCreateReplica(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const uploadId = String(body.uploadId || '').trim()
    if (!uploadId) return sendError(res, 400, '缺少参考封面 id')
    const meta = getUpload(uploadId)
    if (!meta) return sendError(res, 404, '参考封面不存在了')
    const settings = loadSettings()
    const llm = new LlmClient({ ctx, settings, secrets, log })
    let buffer
    try { buffer = fs.readFileSync(uploadPath(meta)) } catch { return sendError(res, 404, '参考封面文件丢了') }
    const ratio = meta.width && meta.height ? `${meta.width}:${meta.height}` : '16:9'
    let result
    try {
      result = await llm.learnReplica({ buffer, name: meta.title || meta.name || '参考封面', ratio })
    } catch (err) {
      return sendError(res, 500, '拆解这张封面失败：' + (err?.message || err))
    }
    const recipe = result.recipe
    const baseName = String(body.name || meta.title || meta.name || '参考封面').replace(/\.[^.]+$/, '').trim().slice(0, 34) || '参考封面'
    const directive = [
      recipe.summary,
      recipe.composition ? '构图：' + recipe.composition : '',
      recipe.subjectPlacement ? '主体：' + recipe.subjectPlacement : '',
      recipe.titlePlacement ? '标题：' + recipe.titlePlacement : '',
      recipe.lighting ? '光影：' + recipe.lighting : '',
      recipe.decorations && recipe.decorations !== 'none' ? '装饰：' + recipe.decorations : '',
      '复刻说明：只复刻这张封面的版式、文字层级、配色和画面气质，不复刻原人物与原文案；换成用户的主题和人物。',
    ].filter(Boolean).join('\n').slice(0, 9000)
    const style = {
      id: 'replica-' + Date.now().toString(36),
      name: baseName + ' · 复刻',
      tagline: String(recipe.summary || '从单张封面拆解出的同款配方').slice(0, 160),
      directive,
      prompt: recipe.backgroundPrompt,
      negativePrompt: recipe.negativePrompt || '',
      layoutPool: [recipe.layoutId],
      layout: recipe.layout || null,
      vertical: recipe.typography?.vertical === true,
      palette: recipe.palette || [],
      typography: recipe.typography || {},
      references: [uploadId],
      replica: true,
      replicaSource: {
        uploadId,
        coverUrl: meta.url || '',
        title: meta.title || meta.name || '',
        ...recipe,
        learnedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    }
    const current = Array.isArray(settings.customStyles) ? settings.customStyles.slice() : []
    const existingIdx = current.findIndex((s) => s && s.replica && s.replicaSource && s.replicaSource.uploadId === uploadId)
    if (existingIdx >= 0) {
      style.id = current[existingIdx].id || style.id
      style.createdAt = current[existingIdx].createdAt || style.createdAt
      current[existingIdx] = style
    } else {
      current.push(style)
    }
    settings.customStyles = current.slice(-80)
    saveSettings(settings)
    return sendJson(res, 200, {
      ok: true,
      style,
      updated: existingIdx >= 0,
      via: result.via,
      model: result.model,
      styles: allStyles(loadSettings()),
      settings: await publicSettings(loadSettings(), secrets),
    })
  }

  async function handleCreateStyle(req, res) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    let body
    try { body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
    const name = String(body.name || '').trim().slice(0, 60)
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 8) : []
    if (!name) return sendError(res, 400, '给新风格起个名字')
    if (!ids.length) return sendError(res, 400, '先选择至少一张参考图')
    const settings = loadSettings()
    const llm = new LlmClient({ ctx, settings, secrets, log })
    const references = []
    for (let i = 0; i < ids.length; i++) {
      const meta = getUpload(ids[i])
      if (!meta) continue
      let analysis = meta.analysis
      if (!analysis?.summary) {
        try {
          const buffer = fs.readFileSync(uploadPath(meta))
          const analyzed = await llm.analyzeReference({ buffer, name: meta.name, index: i })
          analysis = analyzed.analysis
          saveUploadAnalysis(meta.id, analysis)
        } catch (err) {
          log(`[style create] ${meta.name}: ${err?.message || err}`)
          analysis = { summary: '参考图（未能自动分析）' }
        }
      }
      references.push({ uploadId: meta.id, upload: meta, name: meta.name, title: meta.title, analysis })
    }
    if (!references.length) return sendError(res, 400, '参考图都不存在了，请重新选择')
    const learnedResult = await llm.learnSection({
      section: { name: '自定义风格「' + name + '」', keywords: ['参考图归纳', name] },
      references,
    })
    const learned = learnedResult.learned || {}
    const directive = [
      learned.stylePrompt || '',
      learned.summary || '',
      ...(learned.visualDNA || []),
      ...(learned.titlePatterns || []),
    ].filter(Boolean).join('\n').slice(0, 9000)
    const style = {
      id: 'custom-' + Date.now().toString(36),
      name,
      tagline: String(body.tagline || learned.summary || '从参考图归纳的新风格').slice(0, 160),
      directive,
      layoutPool: Array.isArray(learned.layoutPool) ? learned.layoutPool : [],
      palette: Array.isArray(learned.palette) ? learned.palette : [],
      typography: learned.typography && typeof learned.typography === 'object' ? learned.typography : {},
      references: references.map((r) => r.uploadId),
      createdAt: new Date().toISOString(),
    }
    settings.customStyles = [...(settings.customStyles || []), style].slice(-80)
    saveSettings(settings)
    return sendJson(res, 200, {
      ok: true,
      style,
      learned,
      via: learnedResult.via,
      model: learnedResult.model,
      styles: allStyles(loadSettings()),
      settings: await publicSettings(loadSettings(), secrets),
    })
  }

  async function handlePicker(req, res, action) {
    if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
    if (action === 'pick-folder') {
      const settings = loadSettings()
      const p = await pickFolder(settings.outputDir)
      return sendJson(res, 200, { ok: true, path: p })
    }
    if (action === 'open-folder') {
      const raw = await readBody(req, 1024 * 1024).catch(() => Buffer.from('{}'))
      let body = {}
      try { body = JSON.parse(raw.toString('utf8') || '{}') } catch {}
      const settings = loadSettings()
      let dir = settings.outputDir
      if (body.which === 'data') dir = DATA_DIR
      if (body.which === 'project' && body.id) dir = projectDir(body.id)
      if (!dir) return sendError(res, 400, '目录无效')
      fs.mkdirSync(dir, { recursive: true })
      try {
        execFile('explorer.exe', [dir], { windowsHide: false }, () => {})
      } catch (err) {
        return sendError(res, 500, String(err?.message || err))
      }
      return sendJson(res, 200, { ok: true, path: dir })
    }
    return sendError(res, 404, 'unknown picker action')
  }

  async function handleFiles(req, res, rel) {
    const file = resolveFile(rel)
    if (!file) return sendError(res, 404, '文件不存在')
    serveFile(req, res, file, 'private, max-age=60')
  }

  async function handleFonts(req, res, kind) {
    const settings = loadSettings()
    if (kind.startsWith('custom/')) {
      const id = decodeURIComponent(kind.slice('custom/'.length))
      const font = (settings.customFonts || []).find((f) => f.id === id)
      const file = font ? fontFilePath(font) : ''
      if (!file) return sendError(res, 404, '字体不存在')
      return serveFile(req, res, file, 'public, max-age=86400')
    }
    const file = kind === 'sans' ? settings.fontSans : settings.fontSerif
    serveFile(req, res, file, 'public, max-age=86400')
  }

  async function handleStatic(req, res, name) {
    const map = {
      'client.js': path.join(PLUGIN_ROOT, 'web', 'client.js'),
      'studio.js': path.join(PLUGIN_ROOT, 'web', 'studio.js'),
      'studio.css': path.join(PLUGIN_ROOT, 'web', 'studio.css'),
      'vendor/fabric.min.js': path.join(PLUGIN_ROOT, 'web', 'vendor', 'fabric.min.js'),
      'icon.svg': path.join(PLUGIN_ROOT, 'icon.svg'),
    }
    const file = map[name]
    if (!file) return sendError(res, 404, 'not found')
    serveFile(req, res, file, name.includes('vendor') ? 'public, max-age=86400' : 'no-cache')
  }

  async function route(req, res) {
    if (!isTrusted(req)) {
      res.writeHead(403, JSON_HEADERS)
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
      return
    }
    let pathname = '/'
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname } catch {}
    const sub = pathname.startsWith(ROUTE) ? pathname.slice(ROUTE.length) : pathname
    const clean = sub.replace(/^\/+/, '')
    try {
      if (!clean) {
        serveFile(req, res, path.join(PLUGIN_ROOT, 'web', 'standalone.html'), 'no-cache')
        return
      }
      if (clean === 'state.json') return await handleState(req, res)
      if (clean === 'creator/profile') {
        if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
        const refresh = /[?&]refresh=1/.test(String(req.url || ''))
        return sendJson(res, 200, { ok: true, creator: await publicCreatorLive(log, refresh) })
      }
      if (clean === 'creator/avatar') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method not allowed')
        try {
          const avatar = await fetchCreatorAvatar(log)
          res.writeHead(200, {
            'content-type': avatar.type || 'image/webp',
            'content-length': avatar.buffer.length,
            'cache-control': 'public, max-age=600',
          })
          if (req.method === 'HEAD') return res.end()
          return res.end(avatar.buffer)
        } catch (err) {
          log(`[creator] avatar: ${err?.message || err}`)
          return sendError(res, 404, 'avatar unavailable')
        }
      }
      if (clean === 'styles.json') {
        const settings = loadSettings()
        return sendJson(res, 200, { ok: true, styles: allStyles(settings), exclusive: exclusiveProfile() })
      }
      if (clean === 'styles/learn') return await handleLearn(req, res)
      if (clean === 'styles/create') return await handleCreateStyle(req, res)
      if (clean === 'styles/replica') return await handleCreateReplica(req, res)
      if (clean === 'upload') return await handleUpload(req, res)
      if (clean === 'analyze') return await handleAnalyze(req, res)
      if (clean === 'download') return await handleDownload(req, res)
      if (clean === 'search/images') return await handleSearchImages(req, res)
      if (clean === 'cutout') return await handleCutout(req, res)
      if (clean.startsWith('sections/')) return await handleSections(req, res, clean.slice('sections/'.length))
      if (clean === 'inspire') return await handleInspire(req, res)
      if (clean === 'document') return await handleDocument(req, res)
      if (clean === 'fonts/import') return await handleFontImport(req, res)
      if (clean === 'generate') return await handleGenerate(req, res)
      if (clean === 'open-request') {
        if (req.method === 'POST') {
          setOpenState({ at: Date.now() })
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 200, { ok: true, ...getOpenState() })
      }
      if (clean === 'trash') {
        if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
        return sendJson(res, 200, { ok: true, items: listTrash() })
      }
      if (clean === 'trash/restore' || clean === 'trash/destroy' || clean === 'trash/empty') {
        if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
        let body = {}
        if (clean !== 'trash/empty') {
          try { body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
        }
        try {
          if (clean === 'trash/empty') return sendJson(res, 200, { ok: true, removed: emptyTrash(), items: [] })
          const id = String(body.id || '').trim()
          if (!id) return sendError(res, 400, '缺少回收站 id')
          if (clean === 'trash/restore') {
            const item = restoreTrash(id)
            if (item.type === 'upload') {
              const settings = loadSettings()
              let changed = false
              for (const snap of item.refs || []) {
                const sec = (settings.sections || []).find((s) => s.id === snap.sectionId)
                if (!sec) continue
                if (!(sec.refs || []).some((r) => r.uploadId === item.id)) {
                  sec.refs = [{ ...(snap.ref || {}), uploadId: item.id }, ...(sec.refs || [])]
                  changed = true
                }
              }
              for (const learned of item.learnedRefs || []) {
                settings.learned = settings.learned || {}
                settings.learned.references = Array.isArray(settings.learned.references) ? settings.learned.references : []
                if (!settings.learned.references.some((r) => r.id === item.id)) {
                  settings.learned.references.push({ ...learned, id: item.id })
                  changed = true
                }
              }
              if (changed) saveSettings(settings)
            }
            return sendJson(res, 200, { ok: true, item, projects: listProjects(), uploads: listUploads(), sections: loadSettings().sections })
          }
          const ok = destroyTrash(id)
          if (!ok) return sendError(res, 404, '回收站项目不存在')
          return sendJson(res, 200, { ok: true, items: listTrash() })
        } catch (err) {
          return sendError(res, 500, err.message)
        }
      }
      if (clean === 'files') return await handleFiles(req, res, '')
      if (clean.startsWith('files/')) return await handleFiles(req, res, clean.slice('files/'.length))
      if (clean.startsWith('fonts/custom/')) return await handleFonts(req, res, clean.slice('fonts/'.length))
      if (clean === 'fonts/serif') return await handleFonts(req, res, 'serif')
      if (clean === 'fonts/sans') return await handleFonts(req, res, 'sans')
      if (clean.startsWith('vendor/')) return await handleStatic(req, res, clean)
      if (clean.startsWith('assets/')) {
        const file = path.join(PLUGIN_ROOT, clean)
        if (!isWithin(path.join(PLUGIN_ROOT, 'assets'), file)) return sendError(res, 404, 'not found')
        return serveFile(req, res, file, 'public, max-age=3600')
      }
      if (clean === 'uploads/discard') {
        if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
        let body
        try { body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
        let removed = 0
        for (const id of ids) {
          const meta = getUpload(id)
          if (!meta || meta.inReferenceLibrary === true || meta.temporary !== true) continue
          if (deleteUpload(id)) removed++
        }
        return sendJson(res, 200, { ok: true, removed, uploads: listUploads() })
      }
      if (clean === 'uploads/library') {
        if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
        let body
        try { body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8')) } catch { return sendError(res, 400, 'JSON 无效') }
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
        const flag = body.inLibrary !== false
        const updated = []
        for (const id of ids) {
          const row = updateUploadMeta(id, { inReferenceLibrary: flag })
          if (row) updated.push(row)
        }
        return sendJson(res, 200, { ok: true, updated: updated.length, uploads: listUploads() })
      }
      if (clean.startsWith('uploads/') && clean.endsWith('/template')) {
        if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
        const id = clean.slice('uploads/'.length, -('/template'.length))
        if (!id) return sendError(res, 400, '缺少参考图 id')
        try {
          const settings = loadSettings()
          const llm = new LlmClient({ ctx, settings, secrets, log })
          const relay = new RelayClient({ settings, secrets, log })
          const result = await createTemplateProject({ settings, relay, llm, log, uploadId: id })
          return sendJson(res, 200, { ok: true, ...result, projects: listProjects() })
        } catch (err) {
          return sendError(res, 500, '拆解模板失败：' + err.message)
        }
      }
      if (clean.startsWith('uploads/')) {
        const id = clean.slice('uploads/'.length)
        if (req.method === 'DELETE') {
          const meta = getUpload(id)
          if (!meta) return sendError(res, 404, '参考图不存在')
          const before = loadSettings()
          const refs = []
          for (const sec of before.sections || []) {
            for (const ref of sec.refs || []) {
              if (ref.uploadId === id) refs.push({ sectionId: sec.id, ref })
            }
          }
          const learnedRefs = (before.learned?.references || []).filter((r) => r.id === id)
          try {
            const item = trashUpload(meta, { refs, learnedRefs })
            cleanupUploadRefs(id)
            return sendJson(res, 200, { ok: true, trash: item, uploads: listUploads(), sections: loadSettings().sections })
          } catch (err) {
            return sendError(res, 500, '移入回收站失败：' + err.message)
          }
        }
        return sendError(res, 405, 'method not allowed')
      }
      if (['client.js', 'studio.js', 'studio.css', 'icon.svg'].includes(clean)) return await handleStatic(req, res, clean)
      if (clean.startsWith('jobs/')) {
        const rest = clean.slice('jobs/'.length).split('/')
        return await handleJob(req, res, rest[0], rest[1] || '')
      }
      if (clean === 'projects/manual') return await handleManualCreate(req, res)
      if (clean.startsWith('projects')) {
        const rest = clean.slice('projects'.length).replace(/^\/+/, '').split('/')
        const id = rest[0] || ''
        const action = rest[1] || ''
        return await handleProjects(req, res, id, action)
      }
      if (clean.startsWith('relay/')) return await handleRelay(req, res, clean.slice('relay/'.length))
      if (clean.startsWith('main/')) return await handleMain(req, res, clean.slice('main/'.length))
      if (clean.startsWith('update/')) return await handleUpdate(req, res, clean.slice('update/'.length))
      if (['pick-folder', 'open-folder'].includes(clean)) return await handlePicker(req, res, clean)
      sendError(res, 404, `unknown route ${pathname}`)
    } catch (err) {
      log(`[server] ${pathname}: ${err?.stack || err}`)
      if (!res.headersSent) sendError(res, 500, String(err?.message || err))
    }
  }

  return { route }
}
