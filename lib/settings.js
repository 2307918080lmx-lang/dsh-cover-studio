import fs from 'node:fs'
import path from 'node:path'
import {
  HOME,
  SETTINGS_FILE,
  SECRETS_FILE,
  readJson,
  writeJson,
  slugify,
} from './util.js'
import { normalizeRatioId } from './ratios.js'

function firstExisting(paths, fallback = '') {
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return fallback
}

export function defaultOutputDir() {
  return path.join(HOME, 'Pictures', '封面设计助手')
}

export const FONT_SERIF = firstExisting([
  'C:\\Windows\\Fonts\\Source Han Serif SC Heavy (TrueType).ttf',
  'C:\\Windows\\Fonts\\NotoSerifSC-VF.ttf',
  'C:\\Windows\\Fonts\\simsun.ttc',
])

export const FONT_SANS = firstExisting([
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\SourceHanSansCN-Medium.otf',
])

export function defaultCoverDownloadDir() {
  return path.join(defaultOutputDir(), '视频封面参考')
}

export const DEFAULT_SECTIONS = [
  { id: 'animation', name: '动画区', icon: '动', rid: 1, keywords: ['动画杂谈', '番剧推荐', '动画解说'], order: 0 },
  { id: 'life', name: '生活区', icon: '生', rid: 160, keywords: ['生活vlog', '美食', '旅行'], order: 1 },
  { id: 'tech', name: '科技区', icon: '科', rid: 188, keywords: ['数码评测', '科技', 'AI'], order: 2 },
  { id: 'knowledge', name: '知识区', icon: '知', rid: 36, keywords: ['知识科普', '历史', '学习'], order: 3 },
  { id: 'game', name: '游戏区', icon: '游', rid: 4, keywords: ['游戏实况', '单机游戏', '游戏解说'], order: 4 },
]

export const DEFAULT_RELAY = {
  id: 'default',
  name: '我的中转站',
  baseUrl: '',
  protocol: 'openai-images',
  models: [],
  defaultModel: '',
  fallbackModels: [],
  size169: '1536x1024',
  size43: '1536x1152',
  size916: '1024x1536',
  size11: '1024x1024',
  quality: 'high',
  extraParams: {},
}

export const DEFAULT_SETTINGS = {
  version: 1,
  enabled: true,
  outputDir: defaultOutputDir(),
  defaultRatio: '16:9',
  coverDownloadDir: defaultCoverDownloadDir(),
  defaultCount: 3,
  defaultStyles: ['exclusive'],
  autoSave: true,
  fontSerif: FONT_SERIF,
  fontSans: FONT_SANS,
  mainModel: {
    mode: 'dsh',
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    visionModel: 'deepseek-flash',
    reasoningEffort: 'high',
  },
  relays: [DEFAULT_RELAY],
  defaultRelayId: 'default',
  defaultModel: '',
  customStyles: [],
  sections: DEFAULT_SECTIONS,
  customFonts: [],
  learned: { notes: [], updatedAt: null, references: [] },
  ui: { lastTab: 'create', createMode: 'ai' },
}

function str(value, fallback = '', max = 4000) {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function normalizeBoxSpec(raw) {
  if (!raw || typeof raw !== 'object') return null
  const num = (v, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
  }
  const x = num(raw.x, 0)
  const y = num(raw.y, 0)
  return { x, y, w: Math.min(1 - x, Math.max(0.04, num(raw.w, 0.4))), h: Math.min(1 - y, Math.max(0.04, num(raw.h, 0.2))) }
}

function normalizeLayoutSpec(raw) {
  if (!raw || typeof raw !== 'object') return null
  const num = (v, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
  }
  return {
    titleX: num(raw.titleX, 0.05), titleY: num(raw.titleY, 0.1),
    titleW: num(raw.titleW, 0.55), titleH: num(raw.titleH, 0.3),
    subtitleX: num(raw.subtitleX, 0.06), subtitleY: num(raw.subtitleY, 0.72),
    subtitleW: num(raw.subtitleW, 0.42), subtitleH: num(raw.subtitleH, 0.12),
    gradient: oneOf(raw.gradient, ['left', 'right', 'bottom', 'top', 'none'], 'left'),
    subtitleBar: raw.subtitleBar === true,
  }
}

function normalizeSection(input, index = 0) {
  const raw = input && typeof input === 'object' ? input : {}
  const name = str(raw.name, '分区 ' + (index + 1), 40).trim() || ('分区 ' + (index + 1))
  let id = str(raw.id, '', 60).trim()
  if (!id) id = slugify(name, 32).toLowerCase() || ('section-' + (index + 1))
  const refs = Array.isArray(raw.refs) ? raw.refs.map((r) => {
    if (typeof r === 'string') return { uploadId: r }
    if (!r || typeof r !== 'object') return null
    return {
      uploadId: str(r.uploadId || r.id, '', 80),
      title: str(r.title, '', 200),
      author: str(r.author, '', 120),
      views: Math.max(0, Number(r.views) || 0),
      bvid: str(r.bvid, '', 40),
      sourceUrl: str(r.sourceUrl, '', 800),
      downloadPath: str(r.downloadPath, '', 1000),
      createdAt: str(r.createdAt, '', 40),
    }
  }).filter((r) => r && r.uploadId).slice(0, 80) : []
  const types = Array.isArray(raw.types) ? raw.types.map((t, i) => {
    if (!t || typeof t !== 'object') return null
    const tname = str(t.name, '', 80).trim()
    if (!tname) return null
    return {
      id: str(t.id, 'type-' + (i + 1), 60),
      name: tname,
      description: str(t.description, '', 1200),
      refUploadId: str(t.refUploadId, '', 80) || (refs[i]?.uploadId || ''),
    }
  }).filter(Boolean).slice(0, 12) : []
  const creator = str(raw.creator, '', 80)
  const harvestCursor = Math.max(1, Number(raw.harvestCursor) || 1)
  const l = raw.learned && typeof raw.learned === 'object' ? raw.learned : null
  const learned = l ? {
    summary: str(l.summary, '', 3000),
    visualDNA: Array.isArray(l.visualDNA) ? l.visualDNA.map((x) => str(x, '', 500)).filter(Boolean).slice(0, 12) : [],
    titlePatterns: Array.isArray(l.titlePatterns) ? l.titlePatterns.map((x) => str(x, '', 500)).filter(Boolean).slice(0, 12) : [],
    palette: Array.isArray(l.palette) ? l.palette.map((x) => str(x, '', 30)).filter(Boolean).slice(0, 8) : [],
    typography: l.typography && typeof l.typography === 'object' ? l.typography : {},
    layoutPool: Array.isArray(l.layoutPool) ? l.layoutPool.map((x) => str(x, '', 60)).filter(Boolean).slice(0, 10) : [],
    stylePrompt: str(l.stylePrompt, '', 8000),
    coverTypes: types,
    updatedAt: str(l.updatedAt, '', 40) || null,
  } : null
  return {
    id,
    name,
    icon: str(raw.icon, name.slice(0, 1), 4),
    rid: Math.max(0, Math.min(9999, Number.parseInt(raw.rid, 10) || 0)),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map((x) => str(x, '', 60)).filter(Boolean).slice(0, 20) : [],
    enabled: raw.enabled === false ? false : true,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    refs,
    types,
    creator,
    harvestCursor,
    learned,
    createdAt: str(raw.createdAt, '', 40) || new Date().toISOString(),
  }
}

function normalizeCustomFont(input, index = 0) {
  const raw = input && typeof input === 'object' ? input : {}
  const family = str(raw.family, '', 80).trim()
  if (!family) return null
  return {
    id: str(raw.id, 'font-' + (index + 1), 60),
    family,
    file: str(raw.file, '', 200),
    mime: str(raw.mime, 'font/ttf', 80),
    path: str(raw.path, '', 1000),
    createdAt: str(raw.createdAt, '', 40) || new Date().toISOString(),
  }
}

const CONSOLE_PATH = /^\/(dashboard|console|home|account|api-?keys?|playground|login|signin|sign-in|user|profile|billing|usage|docs?)(\/.*)?$/i
const ENDPOINT_SUFFIX = /(\/images\/(generations|edits)|\/chat\/completions|\/models)$/i
const KNOWN_V1_HOST = /(^|\.)(api\.openai\.com|api\.deepseek\.com|api\.siliconflow\.cn|api\.302\.ai)$/i

export function normalizeRelayBaseUrl(input) {
  let url = String(input || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url) ? 'http://' + url : 'https://' + url
  }
  url = url.replace(ENDPOINT_SUFFIX, '').replace(/\/+$/, '')
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path || path === '/') {
      if (KNOWN_V1_HOST.test(parsed.hostname)) parsed.pathname = '/v1'
      return parsed.toString().replace(/\/+$/, '')
    }
    if (CONSOLE_PATH.test(path)) {
      parsed.pathname = '/v1'
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString().replace(/\/+$/, '')
    }
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return url
  }
}

export function normalizeRelay(input, index = 0) {
  const raw = input && typeof input === 'object' ? input : {}
  const name = str(raw.name, `中转站 ${index + 1}`, 80).trim() || `中转站 ${index + 1}`
  let id = str(raw.id, '', 80).trim()
  if (!id) id = slugify(name, 32).toLowerCase() || `relay-${index + 1}`
  const models = Array.isArray(raw.models)
    ? raw.models.map((m) => str(m, '', 120).trim()).filter(Boolean).slice(0, 40)
    : []
  const fallbackModels = Array.isArray(raw.fallbackModels)
    ? raw.fallbackModels.map((m) => str(m, '', 120).trim()).filter(Boolean).slice(0, 20)
    : []
  const defaultModel = str(raw.defaultModel, models[0] || '', 120)
  const modelList = models.slice()
  if (defaultModel && !modelList.includes(defaultModel)) modelList.unshift(defaultModel)
  return {
    id,
    name,
    baseUrl: normalizeRelayBaseUrl(str(raw.baseUrl, '', 500)),
    protocol: oneOf(raw.protocol, ['openai-images', 'openai-chat'], 'openai-images'),
    models: modelList,
    defaultModel,
    fallbackModels,
    size169: str(raw.size169, '1536x1024', 32),
    size43: str(raw.size43, '1536x1152', 32),
    size916: str(raw.size916, '1024x1536', 32),
    size11: str(raw.size11, '1024x1024', 32),
    quality: str(raw.quality, 'high', 32),
    extraParams: raw.extraParams && typeof raw.extraParams === 'object' && !Array.isArray(raw.extraParams)
      ? raw.extraParams
      : {},
  }
}

export function normalizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const base = DEFAULT_SETTINGS
  const mainRaw = raw.mainModel && typeof raw.mainModel === 'object' ? raw.mainModel : {}
  const mainModel = {
    mode: oneOf(mainRaw.mode, ['dsh', 'custom'], base.mainModel.mode),
    provider: str(mainRaw.provider, base.mainModel.provider, 120),
    model: str(mainRaw.model, base.mainModel.model, 120),
    baseUrl: str(mainRaw.baseUrl, base.mainModel.baseUrl, 500).replace(/\/+$/, ''),
    visionModel: str(mainRaw.visionModel, base.mainModel.visionModel, 120),
    reasoningEffort: oneOf(mainRaw.reasoningEffort, ['low', 'high', 'max'], base.mainModel.reasoningEffort),
  }
  const relaysRaw = Array.isArray(raw.relays) && raw.relays.length ? raw.relays : base.relays
  const seen = new Set()
  const relays = relaysRaw.map((r, i) => {
    const n = normalizeRelay(r, i)
    let id = n.id
    let n2 = 2
    while (seen.has(id)) id = `${n.id}-${n2++}`
    seen.add(id)
    return { ...n, id }
  })
  const relayIds = new Set(relays.map((r) => r.id))
  const defaultRelayId = relayIds.has(raw.defaultRelayId) ? raw.defaultRelayId : relays[0]?.id || ''
  const relay = relays.find((r) => r.id === defaultRelayId) || relays[0]
  const requestedModel = str(raw.defaultModel, '', 120)
  const defaultModel = requestedModel && (!relay || !relay.models.length || relay.models.includes(requestedModel))
    ? requestedModel
    : relay?.defaultModel || relay?.models[0] || ''
  if (defaultModel && relay && !relay.models.includes(defaultModel)) relay.models.unshift(defaultModel)

  const learnedRaw = raw.learned && typeof raw.learned === 'object' ? raw.learned : {}
  const learned = {
    notes: Array.isArray(learnedRaw.notes)
      ? learnedRaw.notes.map((n) => str(n, '', 2000)).filter(Boolean).slice(0, 60)
      : [],
    updatedAt: str(learnedRaw.updatedAt, '', 40) || null,
    references: Array.isArray(learnedRaw.references)
      ? learnedRaw.references.slice(0, 60)
      : [],
  }

  const customStyles = Array.isArray(raw.customStyles)
    ? raw.customStyles
        .filter((s) => s && typeof s === 'object')
        .slice(0, 80)
        .map((s, i) => ({
          id: str(s.id, `custom-${i + 1}`, 80),
          name: str(s.name, '自定义风格', 60),
          tagline: str(s.tagline, '', 160),
          directive: str(s.directive, '', 9000),
          prompt: str(s.prompt, '', 9000),
          negativePrompt: str(s.negativePrompt, '', 1600),
          layoutPool: Array.isArray(s.layoutPool) ? s.layoutPool.map((x) => str(x, '', 60)).filter(Boolean).slice(0, 10) : [],
          palette: Array.isArray(s.palette) ? s.palette.map((x) => str(x, '', 30)).filter(Boolean).slice(0, 8) : [],
          typography: s.typography && typeof s.typography === 'object' ? s.typography : {},
          layout: normalizeLayoutSpec(s.layout),
          vertical: typeof s.vertical === 'boolean' ? s.vertical : null,
          references: Array.isArray(s.references) ? s.references.map((x) => str(x, '', 80)).filter(Boolean).slice(0, 12) : [],
          replica: !!s.replica,
          replicaSource: s.replicaSource && typeof s.replicaSource === 'object' ? {
            uploadId: str(s.replicaSource.uploadId, '', 80),
            coverUrl: str(s.replicaSource.coverUrl, '', 1000),
            title: str(s.replicaSource.title, '', 200),
            summary: str(s.replicaSource.summary, '', 2000),
            layoutId: str(s.replicaSource.layoutId, '', 60),
            composition: str(s.replicaSource.composition, '', 3000),
            subjectPlacement: str(s.replicaSource.subjectPlacement, '', 1600),
            titlePlacement: str(s.replicaSource.titlePlacement, '', 1600),
            lighting: str(s.replicaSource.lighting, '', 1600),
            decorations: str(s.replicaSource.decorations, '', 1200),
            backgroundPrompt: str(s.replicaSource.backgroundPrompt, '', 9000),
            negativePrompt: str(s.replicaSource.negativePrompt, '', 1600),
            palette: Array.isArray(s.replicaSource.palette) ? s.replicaSource.palette.map((x) => str(x, '', 30)).filter(Boolean).slice(0, 8) : [],
            typography: s.replicaSource.typography && typeof s.replicaSource.typography === 'object' ? s.replicaSource.typography : {},
            layout: normalizeLayoutSpec(s.replicaSource.layout),
            titleBox: normalizeBoxSpec(s.replicaSource.titleBox),
            subBox: normalizeBoxSpec(s.replicaSource.subBox),
            subjectBox: normalizeBoxSpec(s.replicaSource.subjectBox),
            vertical: typeof s.replicaSource.vertical === 'boolean' ? s.replicaSource.vertical : null,
            styleTags: Array.isArray(s.replicaSource.styleTags) ? s.replicaSource.styleTags.map((x) => str(x, '', 40)).filter(Boolean).slice(0, 12) : [],
            learnedAt: str(s.replicaSource.learnedAt, '', 40) || null,
          } : null,
          createdAt: str(s.createdAt, '', 40) || null,
        }))
    : []

  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : base.sections
  const sectionSeen = new Set()
  const sections = (Array.isArray(sectionsRaw) ? sectionsRaw : []).map((x, i) => normalizeSection(x, i)).filter(Boolean).map((x) => {
    let id = x.id
    let n = 2
    while (sectionSeen.has(id)) id = x.id + '-' + (n++)
    sectionSeen.add(id)
    return { ...x, id }
  }).sort((a, b) => a.order - b.order)
  const customFonts = (Array.isArray(raw.customFonts) ? raw.customFonts : []).map((x, i) => normalizeCustomFont(x, i)).filter(Boolean).slice(0, 40)
  return {
    version: 1,
    enabled: bool(raw.enabled, base.enabled),
    outputDir: str(raw.outputDir, base.outputDir, 1000) || base.outputDir,
    defaultRatio: normalizeRatioId(raw.defaultRatio, base.defaultRatio),
    coverDownloadDir: str(raw.coverDownloadDir, base.coverDownloadDir, 1000) || base.coverDownloadDir,
    defaultCount: Math.min(6, Math.max(1, Number.parseInt(raw.defaultCount, 10) || base.defaultCount)),
    defaultStyles: Array.isArray(raw.defaultStyles)
      ? raw.defaultStyles.map((s) => str(s, '', 80)).filter(Boolean).slice(0, 12)
      : base.defaultStyles.slice(),
    autoSave: bool(raw.autoSave, base.autoSave),
    fontSerif: str(raw.fontSerif, base.fontSerif, 1000) || base.fontSerif,
    fontSans: str(raw.fontSans, base.fontSans, 1000) || base.fontSans,
    mainModel,
    relays,
    defaultRelayId,
    defaultModel,
    customStyles,
    sections,
    customFonts,
    learned,
    ui: {
      lastTab: oneOf(raw.ui?.lastTab, ['create', 'projects', 'references', 'styles', 'trash', 'usage', 'faq', 'changelog', 'producer', 'settings'], 'create'),
      createMode: oneOf(raw.ui?.createMode, ['ai', 'manual'], 'ai'),
    },
  }
}

export function loadSettings() {
  return normalizeSettings(readJson(SETTINGS_FILE, {}))
}

export function saveSettings(settings) {
  writeJson(SETTINGS_FILE, normalizeSettings(settings))
  return loadSettings()
}

export async function publicSettings(settings, secrets) {
  const relays = await Promise.all(
    settings.relays.map(async (r) => ({
      ...r,
      keySet: !!(await secrets.getRelayKey(r.id)),
    })),
  )
  return {
    ...settings,
    relays,
    mainModel: {
      ...settings.mainModel,
      customKeySet: !!(await secrets.getMainKey()),
      dshKeyAvailable: !!(await secrets.getDshKey()),
    },
    customFonts: (settings.customFonts || []).map((f) => ({
      id: f.id,
      family: f.family,
      mime: f.mime,
      createdAt: f.createdAt,
      url: '/dsh-cover-studio/fonts/custom/' + encodeURIComponent(f.id),
    })),
  }
}

/**
 * 中转站密钥与自定义主模型密钥。优先走 DSH 的 credentials 服务；
 * 服务不可用时退回 $DSH_HOME/cover-studio/secrets.json（仅本机、不回显）。
 */
export class Secrets {
  constructor(ctx) {
    this.ctx = ctx
    this.mod = null
    this.modTried = false
    this.local = null
    this.cache = new Map()
    this.dshKeyCache = { at: 0, value: '' }
  }

  async loadModule() {
    if (this.modTried) return this.mod
    this.modTried = true
    try { this.mod = await import('@deepseek-ai/dsh-credentials') } catch { this.mod = null }
    if (!this.mod) this.local = readJson(SECRETS_FILE, { relays: {}, mainKey: '' }) || { relays: {}, mainKey: '' }
    return this.mod
  }

  service() {
    try {
      return this.ctx?.get?.('credentials') || this.ctx?.credentials || null
    } catch {
      return null
    }
  }

  recordKey(idType, id) {
    // DSH credentials 要求每个 key 段匹配 /^[a-z][a-z0-9-]*$/。
    // 之前的 relay:<id> / main:model 带冒号，会让整个 DSH 启动失败。
    const safe = (value) => {
      let s = String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
      if (!/^[a-z]/.test(s)) s = 'x-' + s
      return (s || 'default').slice(0, 64)
    }
    const segment = `${safe(idType)}-${safe(id)}`
    if (this.mod?.credentialKey) return this.mod.credentialKey('dsh-cover-studio', segment)
    return `dsh-cover-studio/${segment}`
  }

  localRecordKey(recordKey) {
    const s = String(recordKey || '')
    const slash = s.lastIndexOf('/')
    if (slash >= 0) return s.slice(slash + 1)
    const colon = s.indexOf(':')
    return colon >= 0 ? s.slice(colon + 1) : s
  }

  legacyLocalKeys(key) {
    const out = [key]
    if (key.startsWith('relay-')) out.push('relay:' + key.slice('relay-'.length))
    if (key.startsWith('main-')) out.push('main:' + key.slice('main-'.length))
    return out
  }

  async readRecord(recordKey) {
    const svc = this.service()
    if (svc?.readRecord) {
      try {
        const rec = await svc.readRecord(recordKey)
        if (rec?.kind === 'api-key') return rec.key || ''
        return rec?.payload?.apiKey || rec?.payload?.value || ''
      } catch { return '' }
    }
    await this.loadModule()
    const key = this.localRecordKey(recordKey)
    for (const k of this.legacyLocalKeys(key)) {
      if (this.local?.relays?.[k]) return this.local.relays[k]
    }
    return ''
  }

  async writeRecord(recordKey, apiKey) {
    const svc = this.service()
    if (svc?.modifyRecord) {
      try {
        await svc.modifyRecord(recordKey, async () => ({ kind: 'api-key', key: apiKey }))
        return true
      } catch { /* fall through */ }
    }
    await this.loadModule()
    if (!this.local) this.local = { relays: {}, mainKey: '' }
    const key = this.localRecordKey(recordKey)
    if (!this.local.relays) this.local.relays = {}
    this.local.relays[key] = apiKey
    this.persistLocal()
    return true
  }

  async deleteRecord(recordKey) {
    const svc = this.service()
    if (svc?.deleteRecord) {
      try { await svc.deleteRecord(recordKey) } catch {}
    }
    await this.loadModule()
    if (this.local?.relays) {
      const key = this.localRecordKey(recordKey)
      for (const k of this.legacyLocalKeys(key)) delete this.local.relays[k]
      this.persistLocal()
    }
    return true
  }

  persistLocal() {
    try {
      writeJson(SECRETS_FILE, this.local)
      try { fs.chmodSync(SECRETS_FILE, 0o600) } catch {}
    } catch {}
  }

  hasRelayKey(id) {
    return this.cache.has(`relay:${id}`) ? true : false
  }

  async getRelayKey(id) {
    const ck = `relay:${id}`
    if (this.cache.has(ck)) return this.cache.get(ck)
    await this.loadModule()
    const key = await this.readRecord(this.recordKey('relay', id))
    if (key) this.cache.set(ck, key)
    return key || ''
  }

  async setRelayKey(id, apiKey) {
    const key = String(apiKey ?? '').trim()
    if (!key) return this.deleteRelayKey(id)
    await this.loadModule()
    await this.writeRecord(this.recordKey('relay', id), key)
    this.cache.set(`relay:${id}`, key)
    return true
  }

  async deleteRelayKey(id) {
    await this.loadModule()
    await this.deleteRecord(this.recordKey('relay', id))
    this.cache.delete(`relay:${id}`)
    return true
  }

  async hasMainKey() {
    return !!(await this.getMainKey())
  }

  async getMainKey() {
    const ck = 'main'
    if (this.cache.has(ck)) return this.cache.get(ck)
    await this.loadModule()
    const key = await this.readRecord(this.recordKey('main', 'model'))
    if (key) this.cache.set(ck, key)
    return key || ''
  }

  async setMainKey(apiKey) {
    const key = String(apiKey ?? '').trim()
    if (!key) {
      await this.loadModule()
      await this.deleteRecord(this.recordKey('main', 'model'))
      this.cache.delete('main')
      return true
    }
    await this.loadModule()
    await this.writeRecord(this.recordKey('main', 'model'), key)
    this.cache.set('main', key)
    return true
  }

  /** DSH 的官方 DeepSeek key：优先 credentials，其次环境变量，最后 Codex 配置。 */
  async getDshKey() {
    const now = Date.now()
    if (this.dshKeyCache.value && now - this.dshKeyCache.at < 5 * 60 * 1000) return this.dshKeyCache.value
    await this.loadModule()
    let key = ''
    try {
      const svc = this.service()
      if (svc?.resolve && this.mod?.credentialRef) {
        const hit = await svc.resolve(this.mod.credentialRef('DEEPSEEK_API_KEY'))
        key = hit?.value || ''
      }
    } catch {}
    if (!key) key = process.env.DEEPSEEK_API_KEY || ''
    if (!key) {
      try {
        const cfg = fs.readFileSync(path.join(HOME, '.codex', 'config.toml'), 'utf8')
        const section = cfg.split('[model_providers.deepseek]')[1]?.split(/\n\[/)[0] || ''
        key = section.match(/experimental_bearer_token\s*=\s*"([^"]+)"/)?.[1] || ''
      } catch {}
    }
    if (key) this.dshKeyCache = { at: now, value: key }
    return key
  }

  hasDshKey() {
    return !!this.dshKeyCache.value
  }
}
