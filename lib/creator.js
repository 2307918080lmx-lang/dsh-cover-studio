// 制作人信息是只读常量：不写入 settings，不提供修改接口。
// 只有维护者修改源码才能变更；开源用户运行时无法通过界面或 API 改。
export const CREATOR = Object.freeze({
  name: '明代宗',
  uid: '478925908',
  platform: '哔哩哔哩',
  spaceUrl: 'https://space.bilibili.com/478925908',
  role: '封面设计助手 制作人',
  // 开源发布后可选：填 GitHub 仓库地址（例如 https://github.com/owner/repo）。
  feedbackUrl: '',
  // 飞书问题反馈表单（任何人可填写）。设置里的同名字段可以覆盖。
  feishuUrl: 'https://acntudzm54fw.feishu.cn/share/base/shrcngkqSaRLSEYkQj4n07gGrDe',
  immutable: true,
})

const CARD_API = `https://api.bilibili.com/x/web-interface/card?mid=${CREATOR.uid}`
const PROFILE_TTL = 10 * 60 * 1000
const PROFILE_FAIL_TTL = 60 * 1000
const AVATAR_TTL = 10 * 60 * 1000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

let profileCache = { at: 0, data: null, failed: false }
let avatarCache = { at: 0, buffer: null, type: '', url: '' }
let lastFaceUrl = ''

function bilibiliHeaders() {
  return {
    'user-agent': UA,
    referer: `https://space.bilibili.com/${CREATOR.uid}`,
    accept: 'application/json,text/plain,*/*',
  }
}

function safeBiliImage(url) {
  try {
    const u = new URL(String(url || ''))
    const host = u.hostname.toLowerCase()
    return u.protocol === 'https:' && (host.endsWith('.hdslb.com') || host.endsWith('.bilibili.com')) ? u.toString() : ''
  } catch {
    return ''
  }
}

function fallbackProfile() {
  return {
    ...CREATOR,
    avatarUrl: '',
    profileUpdatedAt: null,
    profileSource: 'fallback',
  }
}

export function publicCreator() {
  return { ...CREATOR }
}

export async function publicCreatorLive(log = () => {}, force = false) {
  const now = Date.now()
  if (!force && profileCache.data && now - profileCache.at < (profileCache.failed ? PROFILE_FAIL_TTL : PROFILE_TTL)) return profileCache.data
  try {
    const res = await fetch(CARD_API, { headers: bilibiliHeaders(), signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data?.code !== 0) throw new Error(data?.message || `code ${data?.code}`)
    const card = data.data?.card || {}
    const face = safeBiliImage(card.face)
    if (face) lastFaceUrl = face
    const version = face ? (face.match(/([a-f0-9]{8})[^/]*$/i)?.[1] || String(now)) : ''
    const profile = {
      ...CREATOR,
      // 名称和 UID 保持只读常量；只取 B 站公开头像。
      avatarUrl: face ? `/dsh-cover-studio/creator/avatar?v=${encodeURIComponent(version)}` : '',
      profileUpdatedAt: new Date().toISOString(),
      profileSource: 'bilibili',
    }
    profileCache = { at: now, data: profile, failed: false }
    return profile
  } catch (err) {
    log(`[creator] B 站资料获取失败：${err?.message || err}`)
    const stale = profileCache.data ? { ...profileCache.data } : fallbackProfile()
    profileCache = { at: now, data: stale, failed: true }
    return stale
  }
}

export async function fetchCreatorAvatar(log = () => {}) {
  const now = Date.now()
  if (avatarCache.buffer && now - avatarCache.at < AVATAR_TTL) return { ...avatarCache, cached: true }
  if (!lastFaceUrl) await publicCreatorLive(log)
  let target = lastFaceUrl
  if (!target) {
    const err = new Error('暂时没有拿到 B 站头像')
    err.status = 404
    throw err
  }
  const res = await fetch(target, {
    headers: { 'user-agent': UA, referer: `https://space.bilibili.com/${CREATOR.uid}`, accept: 'image/avif,image/webp,image/*,*/*' },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`头像下载失败：HTTP ${res.status}`)
  const type = String(res.headers.get('content-type') || 'image/webp').split(';')[0]
  if (!/^image\//.test(type)) throw new Error('头像返回的不是图片')
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > 8 * 1024 * 1024) throw new Error('头像文件过大')
  avatarCache = { at: now, buffer, type, url: target }
  return { ...avatarCache, cached: false }
}
