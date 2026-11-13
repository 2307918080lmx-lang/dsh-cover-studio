import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { newId, slugify, stamp, truncate, detectImageType } from './util.js'
import { saveUpload, uploadPath } from './store.js'
import { imageMeta } from './render.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const MAX_BYTES = 30 * 1024 * 1024

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  if (ip.startsWith('169.254.')) return true
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1])
    if (second >= 16 && second <= 31) return true
  }
  if (ip.startsWith('0.')) return true
  return false
}

export async function assertPublicUrl(raw) {
  let u
  try { u = new URL(String(raw || '')) } catch { throw new Error('链接格式不对') }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只支持 http/https 链接')
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('不能访问本机/内网地址')
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('不能访问内网 IP')
    return u
  }
  let list = []
  try { list = await dns.lookup(host, { all: true, verbatim: true }) } catch { throw new Error('域名解析失败：' + host) }
  if (!list.length) throw new Error('域名解析失败：' + host)
  if (list.some((x) => isPrivateIp(x.address))) throw new Error('这个域名指向内网地址，已拒绝')
  return u
}

async function fetchSafe(raw, { timeout = 22000, headers = {}, method = 'GET' } = {}) {
  const url = await assertPublicUrl(raw)
  const res = await fetch(url, {
    method,
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  })
  if (res.url) {
    try { await assertPublicUrl(res.url) } catch {
      try { res.body?.cancel() } catch {}
      throw new Error('跳转到了内网地址，已拒绝')
    }
  }
  return res
}

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function unescapeJsonUrl(value) {
  return String(value || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&')
}

function metaCandidates(html, pageUrl) {
  const urls = []
  const push = (raw) => {
    const s = unescapeJsonUrl(stripTags(raw))
    if (!s) return
    try {
      const abs = new URL(s, pageUrl).href
      if (/^https?:/i.test(abs) && !urls.includes(abs)) urls.push(abs)
    } catch {}
  }
  const metaRe = /<meta\b[^>]*>/gi
  const tags = String(html || '').match(metaRe) || []
  for (const tag of tags) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() || ''
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || ''
    if (!content) continue
    if (['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(key)) push(content)
  }
  const link = /<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(html)
  if (link) push(link[1])
  for (const re of [/"cover"\s*:\s*"([^"]+)"/gi, /"origin_cover"\s*:\s*"([^"]+)"/gi, /"dynamic_cover"\s*:\s*"([^"]+)"/gi, /"coverUrl"\s*:\s*"([^"]+)"/gi]) {
    let m
    while ((m = re.exec(html)) && urls.length < 12) push(m[1])
  }
  return urls
}

function metaTitle(html, fallback = '') {
  const og = /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html)
  if (og) return stripTags(og[1])
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return stripTags(t?.[1]) || fallback
}

async function resolveBilibili(rawUrl) {
  let url = rawUrl
  const short = /b23\.tv|bili2233\.cn/i.test(url)
  if (short) {
    const res = await fetchSafe(url, { timeout: 15000, headers: { referer: 'https://www.bilibili.com/' } })
    url = res.url || url
  }
  const bv = /(BV[0-9A-Za-z]{10})/.exec(url)
  const av = /\bav(\d+)/i.exec(url)
  if (!bv && !av) throw new Error('没有识别到 B 站 BV/av 号；请复制视频页链接')
  const query = bv ? `bvid=${encodeURIComponent(bv[1])}` : `aid=${encodeURIComponent(av[1])}`
  const res = await fetchSafe(`https://api.bilibili.com/x/web-interface/view?${query}`, {
    headers: { referer: 'https://www.bilibili.com/' },
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { throw new Error('B 站接口返回异常，稍后再试') }
  if (!res.ok || data?.code !== 0 || !data.data) {
    throw new Error(`B 站接口失败：${truncate(data?.message || text, 200)}`)
  }
  const v = data.data
  const pic = String(v.pic || '').replace(/^http:/i, 'https:').replace(/^\/\//, 'https://')
  if (!pic) throw new Error('这条视频没有封面图')
  return {
    platform: 'bilibili',
    pageUrl: `https://www.bilibili.com/video/${v.bvid}`,
    title: v.title || v.bvid,
    author: v.owner?.name || '',
    views: v.stat?.view || 0,
    coverCandidates: [pic],
    referer: 'https://www.bilibili.com/',
    extra: { bvid: v.bvid, aid: v.aid, duration: v.duration },
  }
}

async function resolveYouTube(rawUrl) {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/i.exec(rawUrl)
  if (!m) throw new Error('没有识别到 YouTube 视频 id')
  const id = m[1]
  let title = ''
  let author = ''
  try {
    const res = await fetchSafe(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`, { timeout: 12000 })
    if (res.ok) {
      const data = await res.json()
      title = data.title || ''
      author = data.author_name || ''
    }
  } catch {}
  return {
    platform: 'youtube',
    pageUrl: `https://www.youtube.com/watch?v=${id}`,
    title: title || `YouTube ${id}`,
    author,
    views: 0,
    coverCandidates: [
      `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    ],
    referer: 'https://www.youtube.com/',
    extra: { videoId: id },
  }
}

async function resolveGeneric(rawUrl) {
  const res = await fetchSafe(rawUrl, { headers: { accept: 'text/html,application/xhtml+xml,image/*,*/*' } })
  const type = String(res.headers.get('content-type') || '')
  if (type.startsWith('image/')) {
    const buffer = Buffer.from(await res.arrayBuffer())
    return {
      platform: 'image',
      pageUrl: res.url || rawUrl,
      title: path.basename(new URL(res.url || rawUrl).pathname) || '网络封面',
      author: '',
      views: 0,
      directBuffer: buffer,
      coverCandidates: [],
      referer: res.url || rawUrl,
      extra: {},
    }
  }
  if (!type.includes('html') && !type.includes('text')) throw new Error('链接不是网页或图片：' + type)
  const html = await res.text()
  const candidates = metaCandidates(html, res.url || rawUrl)
  if (!candidates.length) throw new Error('页面里没有找到封面图（可能需要登录，或平台限制了抓取）')
  const host = new URL(res.url || rawUrl).hostname.replace(/^www\./, '')
  return {
    platform: host.split('.')[0] || 'web',
    pageUrl: res.url || rawUrl,
    title: metaTitle(html, host),
    author: '',
    views: 0,
    coverCandidates: candidates,
    referer: res.url || rawUrl,
    extra: { site: host },
  }
}

export async function resolveVideoCover(rawInput) {
  const raw = String(rawInput || '').trim()
  if (!raw) throw new Error('先粘贴视频链接')
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  if (/bilibili\.com|b23\.tv|bili2233\.cn/i.test(withScheme)) return resolveBilibili(withScheme)
  if (/youtube\.com|youtu\.be/i.test(withScheme)) return resolveYouTube(withScheme)
  return resolveGeneric(withScheme)
}

async function fetchImage(candidate, referer) {
  const res = await fetchSafe(candidate, { headers: { referer: referer || '', accept: 'image/avif,image/webp,image/*,*/*' } })
  if (!res.ok) throw new Error(`封面下载失败：HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_BYTES) throw new Error('封面图超过 30MB')
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_BYTES) throw new Error('封面图超过 30MB')
  const type = detectImageType(buffer)
  if (!type) throw new Error('下载到的不是图片（可能是登录/防盗链页面）')
  return { buffer, mime: type.mime, ext: type.ext, url: res.url || candidate }
}

export async function saveResolvedCover(resolved, { dir, saveToLibrary = true, minWidth = 0, minHeight = 0, inReferenceLibrary = true, temporary = false } = {}) {
  let got = null
  let lastErr = null
  let fallback = null
  let imageWidth = 0
  let imageHeight = 0
  if (resolved.directBuffer) {
    const type = detectImageType(resolved.directBuffer)
    if (!type) throw new Error('链接内容不是图片')
    got = { buffer: resolved.directBuffer, mime: type.mime, ext: type.ext, url: resolved.pageUrl }
    try {
      const size = await imageMeta(got.buffer)
      imageWidth = size.width
      imageHeight = size.height
      if (minWidth && size.width < minWidth) lastErr = new Error(`封面宽度只有 ${size.width}px，低于 ${minWidth}px`)
    } catch {}
  } else {
    for (const candidate of resolved.coverCandidates) {
      try {
        const item = await fetchImage(candidate, resolved.referer)
        if (minWidth || minHeight) {
          try {
            const size = await imageMeta(item.buffer)
            if ((minWidth && size.width < minWidth) || (minHeight && size.height < minHeight)) {
              fallback = fallback || { ...item, width: size.width, height: size.height }
              lastErr = new Error(`封面分辨率 ${size.width}×${size.height} 偏低`)
              continue
            }
            imageWidth = size.width
            imageHeight = size.height
          } catch {}
        } else {
          try { const size = await imageMeta(item.buffer); imageWidth = size.width; imageHeight = size.height } catch {}
        }
        got = item
        break
      } catch (err) { lastErr = err }
    }
    if (!got && fallback && !minWidth && !minHeight) {
      got = fallback
      imageWidth = fallback.width || 0
      imageHeight = fallback.height || 0
      lastErr = null
    }
  }
  if (!got) throw new Error(lastErr?.message || '封面下载失败')
  const hash = crypto.createHash('sha1').update(got.buffer).digest('hex')
  const downloadDir = dir || ''
  let downloadPath = ''
  if (downloadDir) {
    try {
      fs.mkdirSync(downloadDir, { recursive: true })
      const name = `${slugify(resolved.title || '封面', 42)}_${slugify(resolved.platform, 10)}_${stamp()}${got.ext}`
      downloadPath = path.join(downloadDir, name)
      fs.writeFileSync(downloadPath, got.buffer)
    } catch {
      downloadPath = ''
    }
  }
  let upload = null
  if (saveToLibrary) {
    upload = await saveUpload(got.buffer, {
      name: `${slugify(resolved.title || '视频封面', 48)}${got.ext}`,
      mime: got.mime,
      ext: got.ext,
      sourceUrl: resolved.pageUrl,
      platform: resolved.platform,
      title: resolved.title,
      author: resolved.author,
      views: resolved.views,
      downloadPath,
      referer: resolved.referer,
      width: imageWidth || undefined,
      height: imageHeight || undefined,
      hash,
      inReferenceLibrary,
      temporary,
    })
  }
  return { ...resolved, ...got, downloadPath, upload }
}

export async function downloadVideoCover(input, options = {}) {
  const resolved = await resolveVideoCover(input)
  return saveResolvedCover(resolved, options)
}

export async function readImageCandidates(html, pageUrl) {
  return metaCandidates(html, pageUrl)
}
