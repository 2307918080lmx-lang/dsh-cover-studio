import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { PLUGIN_ROOT, readJson, truncate } from './util.js'

export const REPO = '2307918080lmx-lang/dsh-cover-studio'
export const REPO_URL = `https://github.com/${REPO}`
const API_ROOT = `https://api.github.com/repos/${REPO}`
const CHECK_TTL = 30 * 60 * 1000
const MAX_TARBALL = 24 * 1024 * 1024
const cache = { at: 0, current: '', data: null }

export function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(String(value || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i]
  }
  return 0
}

function packageVersion(root = PLUGIN_ROOT) {
  return String(readJson(path.join(root, 'package.json'), {})?.version || '0.0.0')
}

async function githubJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-cover-studio-updater',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  if (!res.ok) {
    const msg = data?.message || truncate(text, 300)
    const err = new Error(`GitHub ${res.status}: ${msg}`)
    err.status = res.status
    throw err
  }
  if (!data) throw new Error('GitHub 返回了非 JSON 数据')
  return data
}

function bestTag(tags) {
  const list = Array.isArray(tags) ? tags : []
  let best = ''
  for (const item of list) {
    const tag = String(item?.name || '')
    if (!parseVersion(tag)) continue
    if (!best || compareVersions(tag, best) > 0) best = tag
  }
  return best
}

export async function checkForUpdate({ force = false, currentVersion = '', log = () => {} } = {}) {
  const current = String(currentVersion || packageVersion())
  if (!force && cache.data && cache.current === current && Date.now() - cache.at < CHECK_TTL) return cache.data
  let release = null
  let tag = ''
  let notes = ''
  let publishedAt = ''
  let releaseUrl = `${REPO_URL}/releases`
  try {
    release = await githubJson(`${API_ROOT}/releases/latest`)
    tag = String(release?.tag_name || '')
    notes = String(release?.body || '')
    publishedAt = String(release?.published_at || '')
    releaseUrl = String(release?.html_url || releaseUrl)
  } catch (err) {
    log(`[update] latest release check failed: ${err?.message || err}`)
  }
  if (!tag) {
    try {
      const tags = await githubJson(`${API_ROOT}/tags?per_page=30`)
      tag = bestTag(tags)
      if (tag) releaseUrl = `${REPO_URL}/releases/tag/${encodeURIComponent(tag)}`
    } catch (err) {
      const data = {
        ok: false,
        currentVersion: current,
        latestVersion: current,
        hasUpdate: false,
        error: String(err?.message || err),
        repoUrl: REPO_URL,
        checkedAt: new Date().toISOString(),
      }
      cache.at = Date.now()
      cache.current = current
      cache.data = data
      return data
    }
  }
  const latest = tag ? String(parseVersion(tag) ? tag.replace(/^v/i, '') : '') : current
  const hasUpdate = !!latest && compareVersions(latest, current) > 0
  const data = {
    ok: true,
    currentVersion: current,
    latestVersion: latest || current,
    hasUpdate,
    tag: tag || '',
    notes: truncate(notes, 5000),
    publishedAt,
    releaseUrl,
    tarballUrl: tag ? `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(tag)}` : '',
    repoUrl: REPO_URL,
    checkedAt: new Date().toISOString(),
  }
  cache.at = Date.now()
  cache.current = current
  cache.data = data
  log(`[update] current=${current} latest=${data.latestVersion} hasUpdate=${hasUpdate}`)
  return data
}

function readString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end >= 0 ? end : slice.length).toString('utf8')
}

function safeJoin(root, name) {
  const target = path.resolve(root, name)
  const base = path.resolve(root) + path.sep
  if (target !== path.resolve(root) && !target.startsWith(base)) throw new Error('更新包包含非法路径')
  return target
}

export function extractTarGz(buffer, dest) {
  if (!buffer || buffer[0] !== 0x1f || buffer[1] !== 0x8b) throw new Error('下载到的不是有效的 tar.gz 更新包（发布标签可能不存在）')
  let data
  try {
    data = zlib.gunzipSync(buffer, { maxOutputLength: 80 * 1024 * 1024 })
  } catch {
    throw new Error('更新包解压失败，可能是网络返回了错误页面')
  }
  let offset = 0
  let files = 0
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const fullName = (prefix ? `${prefix}/${name}` : name).replace(/^\.\/+/, '')
    const rawSize = readString(header, 124, 12).trim()
    const size = Number.parseInt(rawSize, 8) || 0
    const type = String.fromCharCode(header[156] || 48)
    offset += 512
    const content = data.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    if (!fullName) continue
    if (type === '5') {
      fs.mkdirSync(safeJoin(dest, fullName), { recursive: true })
      continue
    }
    if (type !== '0' && type !== '\0') continue
    const target = safeJoin(dest, fullName)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    files++
  }
  if (!files) throw new Error('更新包里没有文件')
  return files
}

function findPackageRoot(dir) {
  const direct = path.join(dir, 'package.json')
  if (fs.existsSync(direct)) return dir
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(dir, entry.name)
    if (fs.existsSync(path.join(root, 'package.json'))) return root
  }
  throw new Error('更新包里找不到 package.json')
}

function copyTree(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      copyTree(from, to)
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
    }
  }
}

function backupCurrent(targetRoot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-studio-backup-'))
  if (fs.cpSync) {
    fs.cpSync(targetRoot, dir, {
      recursive: true,
      force: true,
      filter: (src) => {
        const rel = path.relative(targetRoot, src).split(path.sep).join('/')
        if (!rel) return true
        if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false
        if (rel === '.git' || rel.startsWith('.git/')) return false
        if (rel === 'assets/models/silueta.onnx') return false
        return true
      },
    })
  } else {
    copyTree(targetRoot, dir)
  }
  return dir
}

function sameDeps(a, b) {
  const pick = (pkg) => JSON.stringify({
    dependencies: pkg.dependencies || {},
    optionalDependencies: pkg.optionalDependencies || {},
  })
  return pick(a || {}) === pick(b || {})
}

function runNpmInstall(cwd) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    let output = ''
    let child
    try {
      child = spawn(cmd, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd,
        shell: process.platform === 'win32',
        env: process.env,
      })
    } catch (err) {
      return resolve({ ok: false, error: String(err?.message || err) })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      resolve({ ok: false, error: 'npm install 超时（4 分钟）' })
    }, 240000)
    child.stdout?.on('data', (chunk) => { output += String(chunk) })
    child.stderr?.on('data', (chunk) => { output += String(chunk) })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(err?.message || err) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, error: code === 0 ? '' : truncate(output, 1200) })
    })
  })
}

export async function installTarball({ buffer, expectedVersion, targetRoot = PLUGIN_ROOT, log = () => {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-studio-update-'))
  let backupDir = ''
  try {
    extractTarGz(buffer, tmp)
    const root = findPackageRoot(tmp)
    const nextPkg = readJson(path.join(root, 'package.json'), {})
    if (nextPkg?.name !== 'dsh-cover-studio') throw new Error('更新包不是封面设计助手插件')
    const expected = String(expectedVersion || '').replace(/^v/i, '')
    if (expected && String(nextPkg.version || '') !== expected) throw new Error(`更新包版本不一致：期望 ${expected}，实际 ${nextPkg.version || '未知'}`)
    const oldPkg = readJson(path.join(targetRoot, 'package.json'), {})
    backupDir = backupCurrent(targetRoot)
    try {
      copyTree(root, targetRoot)
    } catch (err) {
      try {
        if (fs.cpSync) fs.cpSync(backupDir, targetRoot, { recursive: true, force: true })
      } catch {}
      throw err
    }
    const dependenciesChanged = !sameDeps(oldPkg, nextPkg)
    let npmInstall = { skipped: true, ok: true }
    if (dependenciesChanged) {
      log('[update] dependencies changed, running npm install')
      const result = await runNpmInstall(targetRoot)
      npmInstall = { ...result, skipped: false }
    }
    return {
      ok: true,
      version: String(nextPkg.version || ''),
      backupDir,
      dependenciesChanged,
      npmInstall,
      restartRequired: true,
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  }
}

export async function applyUpdate({ version = '', log = () => {} } = {}) {
  const info = await checkForUpdate({ force: true, log })
  if (!info.ok) throw new Error(info.error || '检查更新失败')
  if (!info.hasUpdate) return { ok: true, alreadyLatest: true, version: info.currentVersion, restartRequired: false }
  if (version && compareVersions(info.latestVersion, version) !== 0) throw new Error('版本信息已变化，请重新检查更新')
  if (!info.tarballUrl) throw new Error('没有找到可下载的发布包')
  const res = await fetch(info.tarballUrl, {
    headers: { 'User-Agent': 'dsh-cover-studio-updater' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`下载更新包失败：HTTP ${res.status}`)
  const length = Number(res.headers.get('content-length') || 0)
  if (length > MAX_TARBALL) throw new Error('更新包过大，已中止')
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_TARBALL) throw new Error('更新包过大，已中止')
  log(`[update] downloaded ${buffer.length} bytes for v${info.latestVersion}`)
  return installTarball({ buffer, expectedVersion: info.latestVersion, log })
}
