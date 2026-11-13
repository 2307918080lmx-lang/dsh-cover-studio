import fs from 'node:fs'
import path from 'node:path'
import { assertPublicUrl, saveResolvedCover } from './platforms.js'
import { getUpload, deleteUpload, listUploads } from './store.js'
import { imageMeta } from './render.js'
import { truncate } from './util.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const BILI_HEADERS = { 'user-agent': UA, referer: 'https://www.bilibili.com/', accept: 'application/json,text/plain,*/*', cookie: 'buvid3=9E4B7C9D-3E4F-4A5B-8C6D-1A2B3C4D5E6Finfoc; b_nut=1700000000; buvid4=9E4B7C9D-3E4F-4A5B-8C6D-1A2B3C4D5E6F' }

async function biliJson(url) {
  await assertPublicUrl(url)
  const res = await fetch(url, { headers: BILI_HEADERS, signal: AbortSignal.timeout(22000) })
  const text = await res.text()
  if (!res.ok) throw new Error(`B 站接口 HTTP ${res.status}`)
  if (/^\s*</.test(text)) throw new Error('B 站接口返回了网页（可能触发风控），稍后重试或直接粘贴视频链接')
  let data
  try { data = JSON.parse(text) } catch { throw new Error('B 站接口返回异常') }
  if (data?.code !== 0) throw new Error(`B 站接口：${truncate(data?.message || data?.code, 200)}`)
  return data
}

function httpsUrl(url) {
  return String(url || '').replace(/^http:/i, 'https:').replace(/^\/\//, 'https://')
}

function normalizeBiliPic(url) {
  const clean = httpsUrl(url)
  const at = clean.indexOf('@')
  return at > 0 ? clean.slice(0, at) : clean
}

function coverCandidates(pic) {
  const original = normalizeBiliPic(pic)
  if (!original) return []
  const out = [original]
  if (/\.(jpe?g|png|webp)$/i.test(original)) {
    out.push(original + '@1600w_900h_1c.webp')
    out.push(original + '@1280w_720h_1c.webp')
  }
  const raw = httpsUrl(pic)
  if (raw && raw !== original) out.push(raw)
  return out.filter((v, i, arr) => arr.indexOf(v) === i)
}

function candidateKey(item) {
  return String(item?.extra?.bvid || item?.pageUrl || item?.coverCandidates?.[0] || '').toLowerCase()
}

function cleanTitle(value) {
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

function mapVideo(item) {
  const pic = httpsUrl(item.pic || item.cover || '')
  const bvid = item.bvid || item.bv_id || (item.arcurl ? (/(BV[0-9A-Za-z]+)/.exec(item.arcurl) || [])[1] : '')
  if (!pic || !bvid) return null
  return {
    platform: 'bilibili',
    pageUrl: `https://www.bilibili.com/video/${bvid}`,
    title: cleanTitle(item.title) || bvid,
    author: item.owner?.name || item.author || '',
    views: Number(item.stat?.view ?? item.play ?? 0) || 0,
    coverCandidates: coverCandidates(pic),
    referer: 'https://www.bilibili.com/',
    extra: { bvid, aid: item.aid, duration: item.duration },
  }
}

export async function bilibiliRanking(rid = 1, limit = 100) {
  const data = await biliJson(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${encodeURIComponent(rid || 1)}&type=all`)
  const list = Array.isArray(data?.data?.list) ? data.data.list : []
  return list.map(mapVideo).filter(Boolean).slice(0, limit)
}

export async function bilibiliSearch(keyword, limit = 20, order = 'click', page = 1) {
  const q = String(keyword || '').trim()
  if (!q) return []
  const data = await biliJson(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&order=${encodeURIComponent(order)}&page=${Math.max(1, Number(page) || 1)}`)
  const list = Array.isArray(data?.data?.result) ? data.data.result : []
  return list.filter((x) => x && x.type === 'video').map(mapVideo).filter(Boolean).slice(0, limit)
}

export async function pageImageCandidates(url, limit = 30) {
  const pageUrl = String(url || '').trim()
  if (!/^https?:\/\//i.test(pageUrl)) throw new Error('请填写完整的 http(s) 页面地址')
  await assertPublicUrl(pageUrl)
  const res = await fetch(pageUrl, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(22000) })
  if (!res.ok) throw new Error('页面 HTTP ' + res.status)
  const html = await res.text()
  const raw = []
  const metas = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/ig,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/ig,
  ]
  for (const re of metas) {
    let m
    while ((m = re.exec(html))) raw.push(m[1])
  }
  const imgRe = /<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/ig
  let m
  while ((m = imgRe.exec(html))) raw.push(m[1])
  const seen = new Set()
  const out = []
  for (const value of raw) {
    let abs
    try { abs = new URL(decodeHtml(value).replace(/^\/\//, 'https://'), pageUrl).toString() } catch { continue }
    if (!/^https?:\/\//i.test(abs) || seen.has(abs)) continue
    seen.add(abs)
    out.push({
      platform: 'page',
      pageUrl,
      title: cleanTitle((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '') || new URL(pageUrl).hostname,
      author: new URL(pageUrl).hostname,
      views: 0,
      coverCandidates: [abs],
      referer: pageUrl,
      extra: { page: pageUrl },
    })
    if (out.length >= Math.max(1, limit)) break
  }
  return out
}

export async function bilibiliPopular(limit = 40, page = 1) {
  const data = await biliJson(`https://api.bilibili.com/x/web-interface/popular?ps=50&pn=${Math.max(1, Number(page) || 1)}`)
  const list = Array.isArray(data?.data?.list) ? data.data.list : []
  return list.map(mapVideo).filter(Boolean).slice(0, limit)
}

export async function bilibiliUserSearch(keyword) {
  const q = String(keyword || '').trim()
  if (!q) return []
  const data = await biliJson(`https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=${encodeURIComponent(q)}&page=1`)
  const list = Array.isArray(data?.data?.result) ? data.data.result : []
  return list.filter((x) => x && x.mid).map((x) => ({
    mid: String(x.mid),
    name: cleanTitle(x.uname || ''),
    fans: Number(x.fans) || 0,
    videos: Number(x.videos) || 0,
    samples: Array.isArray(x.res) ? x.res.map(mapVideo).filter(Boolean) : [],
  }))
}

export async function bilibiliCreatorVideos(creator, limit = 30, page = 1) {
  const raw = String(creator || '').trim()
  if (!raw) throw new Error('先填写 UP 主名字或空间链接')
  const midMatch = /space\.bilibili\.com\/(\d+)/i.exec(raw)
  const numericMid = /^\d{3,}$/.test(raw) ? raw : ''
  let mid = midMatch ? midMatch[1] : numericMid
  let name = ''
  let samples = []
  if (mid) {
    for (let attempt = 0; attempt < 2 && !name; attempt++) {
      try {
        const card = await biliJson(`https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(mid)}`)
        name = cleanTitle(card?.data?.card?.name || '')
      } catch {}
      if (!name) await new Promise((r) => setTimeout(r, 500))
    }
    if (!name) throw new Error('无法读取这个空间链接对应的 UP 主，请直接输入 UP 主名字')
    try {
      const users = await bilibiliUserSearch(name)
      const exact = users.find((u) => u.mid === mid) || users.find((u) => u.name === name)
      samples = (exact?.samples || []).map((v) => ({ ...v, author: v.author || name }))
    } catch {}
  }
  if (!mid) {
    const users = await bilibiliUserSearch(raw)
    if (!users.length) throw new Error('没搜到这个 UP 主，试试更完整的名字或粘贴空间链接')
    const exact = users.find((u) => u.name.toLowerCase() === raw.toLowerCase())
      || users.find((u) => u.name.includes(raw) || raw.includes(u.name))
      || users[0]
    mid = exact.mid
    name = exact.name
    samples = (exact.samples || []).map((v) => ({ ...v, author: v.author || exact.name }))
  }
  const out = []
  const seen = new Set()
  const add = (items) => {
    for (const item of items || []) {
      const key = candidateKey(item)
      if (!key || seen.has(key)) continue
      if (name && item.author && !item.author.includes(name)) continue
      seen.add(key)
      out.push(item)
      if (out.length >= limit) return
    }
  }
  add(samples)
  if (out.length < limit) {
    const query = name || raw
    for (let p = Math.max(1, page); p <= Math.max(2, page + 2) && out.length < limit; p++) {
      for (const order of ['click', 'pubdate']) {
        if (out.length >= limit) break
        try { add(await bilibiliSearch(query, 50, order, p)) } catch (err) { /* 搜索失败就继续下一种 */ }
      }
    }
  }
  // 公开搜索拿不到足够条目时，用这位 UP 的样例视频的相关推荐补齐同作者作品。
  if (out.length < limit && samples.length) {
    for (const sample of samples.slice(0, 3)) {
      if (out.length >= limit) break
      try {
        const data = await biliJson(`https://api.bilibili.com/x/web-interface/archive/related?bvid=${encodeURIComponent(sample.extra?.bvid || '')}`)
        const list = Array.isArray(data?.data) ? data.data : []
        add(list.map((x) => mapVideo({ ...x, bvid: x.bvid, pic: x.pic, title: x.title, owner: x.owner, stat: x.stat })).filter(Boolean))
      } catch {}
    }
  }
  if (!out.length) throw new Error('没有抓到这个 UP 主的高播放视频（B 站空间接口有时会限制匿名访问）')
  return { mid, name: name || out[0]?.author || raw, videos: out.slice(0, limit) }
}


function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export async function bingImageSearch(query, limit = 8, page = 1) {
  const q = String(query || '').trim()
  if (!q) return []
  const first = (Math.max(1, Number(page) || 1) - 1) * 35 + 1
  const url = 'https://cn.bing.com/images/async?q=' + encodeURIComponent(q) + '&first=' + first + '&count=' + Math.max(20, limit * 3) + '&mkt=zh-CN&adlt=strict&qft=+filterui:imagesize-large'
  await assertPublicUrl(url)
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://cn.bing.com/', accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(22000),
  })
  if (!res.ok) throw new Error('Bing 图片搜索 HTTP ' + res.status)
  const html = await res.text()
  const out = []
  const seen = new Set()
  const re = /m="([^"]+)"/g
  let m
  while ((m = re.exec(html)) && out.length < limit) {
    try {
      const raw = decodeHtml(m[1])
      const data = JSON.parse(raw)
      const image = String(data.murl || '')
      if (!image || seen.has(image)) continue
      seen.add(image)
      out.push({
        platform: 'bing',
        pageUrl: String(data.purl || ''),
        title: cleanTitle(data.t || '网络参考图'),
        author: '图片搜索',
        views: 0,
        coverCandidates: [image],
        referer: 'https://cn.bing.com/',
        extra: { source: 'bing' },
      })
    } catch {}
  }
  return out
}

function shuffleArray(items) {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]
    arr[i] = arr[j]
    arr[j] = t
  }
  return arr
}

function randomPage(max = 9) {
  return 1 + Math.floor(Math.random() * Math.max(1, max))
}

export async function collectSectionCandidates(section, limit = 8, { exclude = [], page = 1 } = {}) {
  const out = []
  const seen = new Set()
  const excluded = new Set((exclude || []).map((v) => String(v || '').toLowerCase()).filter(Boolean))
  const add = (items) => {
    for (const item of items || []) {
      const keys = [candidateKey(item), item?.pageUrl, item?.extra?.bvid, ...(item?.coverCandidates || []).map((u) => normalizeBiliPic(u))]
        .map((v) => String(v || '').toLowerCase()).filter(Boolean)
      if (!keys.length || keys.some((k) => seen.has(k) || excluded.has(k))) continue
      keys.forEach((k) => seen.add(k))
      out.push(item)
      if (out.length >= limit) break
    }
  }
  let firstError = null
  if (section?.rid) {
    try {
      // 榜单每次只取 100 条，先过滤历史抓取，再随机打散，避免每次都是同样前几条。
      const ranked = await bilibiliRanking(section.rid, 100)
      add(shuffleArray(ranked))
    } catch (err) { firstError = err }
  }
  if (out.length < limit) {
    const popularPages = [1, 2, 3, 4, 5]
    try { add(shuffleArray(await bilibiliPopular(50, popularPages[Math.floor(Math.random() * popularPages.length)]))) } catch (err) { firstError = firstError || err }
  }
  if (out.length < limit) {
    const keywords = Array.isArray(section?.keywords) && section.keywords.length
      ? section.keywords
      : [section?.name || '热门']
    const pages = [Math.max(1, ((Number(page) || 1) % 9) + 1), randomPage(9), randomPage(9)]
    for (const kw of keywords.slice(0, 4)) {
      if (out.length >= limit) break
      for (const order of ['click', 'pubdate']) {
        if (out.length >= limit) break
        const searchPage = pages[(Number(page) + keywords.indexOf(kw) + (order === 'click' ? 0 : 1)) % pages.length]
        try { add(await bilibiliSearch(kw, 50, order, searchPage)) } catch (err) { firstError = firstError || err }
      }
    }
  }
  if (!out.length && firstError) throw firstError
  return shuffleArray(out).slice(0, limit)
}

export function refExcludeKeys(refs) {
  const out = []
  for (const ref of refs || []) {
    if (!ref) continue
    if (ref.bvid) out.push(String(ref.bvid).toLowerCase())
    if (ref.sourceUrl) out.push(String(ref.sourceUrl).toLowerCase())
    if (ref.uploadId) {
      const meta = getUpload(ref.uploadId)
      if (meta?.sourceUrl) out.push(String(meta.sourceUrl).toLowerCase())
      if (meta?.downloadPath) out.push(String(meta.downloadPath).toLowerCase())
    }
  }
  // 所有已经下载过的封面都算“见过”，避免从分区移除后又反复抓回来。
  for (const meta of listUploads()) {
    if (meta?.sourceUrl) out.push(String(meta.sourceUrl).toLowerCase())
    if (meta?.downloadPath) out.push(String(meta.downloadPath).toLowerCase())
  }
  return out.filter((v, i, arr) => v && arr.indexOf(v) === i)
}

function sectionDir(settings, section) {
  const root = settings?.coverDownloadDir || ''
  if (!root) return ''
  return path.join(root, '分区参考', section?.name || '未命名分区')
}

async function saveCandidates({ candidates, wanted, dir, log, minWidth = 960, quality = false }) {
  const refs = []
  const failed = []
  for (const candidate of candidates) {
    if (refs.length >= wanted) break
    try {
      const got = await saveResolvedCover(candidate, { dir, saveToLibrary: true, minWidth, inReferenceLibrary: false })
      if (!got.upload) throw new Error('保存参考图失败')
      if (quality) {
        const size = await imageMeta(got.buffer)
        const aspect = size.width / Math.max(1, size.height)
        const bad = aspect < 1.3 || aspect > 2.5 || got.buffer.length < 24000
        if (bad) {
          try { deleteUpload(got.upload.id) } catch {}
          try { if (got.downloadPath) fs.unlinkSync(got.downloadPath) } catch {}
          throw new Error(aspect < 1.3 || aspect > 2.5 ? `封面比例 ${aspect.toFixed(2)} 不适合做横版参考` : '封面文件过小，画质可能不足')
        }
      }
      refs.push({
        uploadId: got.upload.id,
        title: candidate.title,
        author: candidate.author,
        views: candidate.views,
        bvid: candidate.extra?.bvid || '',
        sourceUrl: candidate.pageUrl,
        downloadPath: got.downloadPath || '',
        createdAt: new Date().toISOString(),
      })
    } catch (err) {
      failed.push({ title: candidate.title, error: String(err?.message || err) })
      log(`[harvest] ${candidate.title}: ${err?.message || err}`)
    }
  }
  return { refs, failed }
}

export async function harvestSection({ section, settings, count = 4, page = 1, log = () => {} }) {
  const wanted = Math.min(8, Math.max(1, Number(count) || 4))
  const exclude = refExcludeKeys(section?.refs)
  const candidates = await collectSectionCandidates(section, Math.max(wanted * 8, 36), { exclude, page })
  const dir = sectionDir(settings, section)
  const { refs, failed } = await saveCandidates({ candidates, wanted, dir, log, quality: true })
  if (!refs.length) {
    throw new Error(`没有抓到新的高清封面${failed[0] ? '：' + failed[0].error : '（可能这个分区的榜单已经被你抓完了，试试换关键词或指定 UP 主）'}`)
  }
  return { refs, failed, candidates: candidates.length, dir, page }
}

export async function harvestCreator({ section, settings, creator, count = 6, page = 1, log = () => {} }) {
  const wanted = Math.min(12, Math.max(1, Number(count) || 6))
  const resolved = await bilibiliCreatorVideos(creator, Math.max(wanted * 4, 24), page)
  const exclude = refExcludeKeys(section?.refs)
  const candidates = (resolved.videos || []).filter((item) => {
    const key = candidateKey(item)
    return key && !exclude.includes(key)
  })
  const dir = sectionDir(settings, section)
  const { refs, failed } = await saveCandidates({ candidates, wanted, dir, log, minWidth: 960, quality: true })
  if (!refs.length) {
    throw new Error(`没有抓到 ${resolved.name || creator} 的新封面${failed[0] ? '：' + failed[0].error : ''}`)
  }
  return { refs, failed, creator: resolved.name, mid: resolved.mid, candidates: candidates.length, dir, dirName: section?.name || '' }
}

export async function findReferenceImages({ query, queries = [], avoid = [], settings, count = 4, provider = 'auto', site = '', page = 1, temporary = false, log = () => {} }) {
  const wanted = Math.min(12, Math.max(1, Number(count) || 4))
  const q = String(query || '').trim()
  const siteRaw = String(site || '').trim()
  const siteUrl = /^https?:\/\//i.test(siteRaw) ? siteRaw : ''
  const siteDomain = !siteUrl && siteRaw && /^[^\s/]+\.[^\s/]+/.test(siteRaw) ? siteRaw.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
  const searchQueries = Array.from(new Set([...(Array.isArray(queries) ? queries : []), q].map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 3)
  if (!searchQueries.length) throw new Error('缺少搜索关键词')
  const avoidTerms = (Array.isArray(avoid) ? avoid : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 12)
  let candidates = []
  let lastErr = null
  const addCandidates = (list) => {
    const seen = new Set(candidates.map((c) => String(c.coverCandidates?.[0] || c.pageUrl || '').toLowerCase()))
    for (const item of list || []) {
      const key = String(item.coverCandidates?.[0] || item.pageUrl || '').toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      candidates.push(item)
    }
  }
  if (provider === 'page' || siteUrl) {
    try { addCandidates(await pageImageCandidates(siteUrl || siteRaw || q, Math.max(wanted * 8, 32))) } catch (err) { lastErr = err; log('[find] page: ' + (err?.message || err)) }
  } else if (provider !== 'bilibili') {
    for (const sq of searchQueries) {
      try { addCandidates(await bingImageSearch(sq + (siteDomain ? ' site:' + siteDomain : ''), Math.max(wanted * 2, 16), page)) } catch (err) { lastErr = err; log('[find] bing: ' + (err?.message || err)) }
    }
  }
  if (!candidates.length && provider !== 'bing') {
    for (const sq of searchQueries) {
      try { addCandidates(await bilibiliSearch(sq, Math.max(wanted * 2, 12), 'click', page)) } catch (err) { lastErr = err; log('[find] bilibili: ' + (err?.message || err)) }
    }
  }
  if (avoidTerms.length) {
    candidates = candidates.filter((item) => {
      const haystack = [item.title, item.pageUrl, ...(item.coverCandidates || [])].join(' ').toLowerCase()
      return !avoidTerms.some((term) => haystack.includes(term))
    })
  }
  if (siteDomain) {
    candidates = candidates.filter((item) => {
      const haystack = String(item.pageUrl || '') + ' ' + (item.coverCandidates || []).join(' ')
      return haystack.toLowerCase().includes(siteDomain.toLowerCase())
    })
  }
  if (!candidates.length) throw new Error('没有搜到相关图片' + (lastErr ? '：' + (lastErr.message || lastErr) : '（换个更具体的画面描述或指定站点试试）'))
  const dir = settings?.coverDownloadDir ? path.join(settings.coverDownloadDir, 'AI找图') : ''
  const existingHashes = new Set(listUploads().map((u) => u.hash).filter(Boolean))
  const uploads = []
  const failed = []
  let duplicates = 0
  for (const candidate of candidates) {
    if (uploads.length >= wanted) break
    try {
      const got = await saveResolvedCover(candidate, { dir, saveToLibrary: true, minWidth: 800, minHeight: 450, inReferenceLibrary: !temporary, temporary })
      if (!got.upload) continue
      if (got.upload.hash && existingHashes.has(got.upload.hash)) {
        duplicates++
        try { deleteUpload(got.upload.id) } catch {}
        try { if (got.downloadPath) fs.unlinkSync(got.downloadPath) } catch {}
        continue
      }
      if (got.upload.hash) existingHashes.add(got.upload.hash)
      uploads.push(got.upload)
    } catch (err) {
      failed.push({ title: candidate.title, error: String(err?.message || err) })
      log(`[find] ${candidate.title}: ${err?.message || err}`)
    }
  }
  if (!uploads.length && !duplicates) throw new Error(`没有下载到高清图片${failed[0] ? '：' + failed[0].error : ''}`)
  return { uploads, candidates: candidates.length, failed, page, duplicateOnly: !uploads.length && duplicates > 0 }
}
