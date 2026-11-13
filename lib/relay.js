import { truncate } from './util.js'
import { relaySize } from './ratios.js'

function baseOf(relay) {
  return String(relay?.baseUrl || '').replace(/\/+$/, '')
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}` }
}

function parseJson(text, label) {
  try { return JSON.parse(text) } catch {
    throw new Error(`${label}返回了非 JSON：${truncate(text, 500)}`)
  }
}

function extractImage(data) {
  const items = Array.isArray(data?.data) ? data.data : []
  for (const item of items) {
    if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), url: null }
    if (item?.url) return { buffer: null, url: item.url }
    if (item?.image_url?.url) return { buffer: null, url: item.image_url.url }
  }
  const msg = data?.choices?.[0]?.message
  if (Array.isArray(msg?.images)) {
    for (const im of msg.images) {
      const url = im?.image_url?.url || im?.url
      if (url) return { buffer: null, url }
    }
  }
  if (data?.error) throw new Error(`中转站错误：${truncate(data.error.message || JSON.stringify(data.error), 600)}`)
  throw new Error(`中转站没有返回图片：${truncate(JSON.stringify(data), 700)}`)
}

async function download(url, signal) {
  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok) throw new Error(`下载生成图失败：HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function mimeOfBuffer(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF') return 'image/webp'
  return 'image/png'
}

async function callImagesEdits({ relay, model, prompt, referenceBuffer, referenceBuffers, size, quality, signal }) {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  if (size) form.append('size', size)
  if (quality) form.append('quality', quality)
  form.append('input_fidelity', 'high')
  form.append('n', '1')
  const images = (Array.isArray(referenceBuffers) && referenceBuffers.length ? referenceBuffers : [referenceBuffer]).filter(Boolean)
  images.forEach((buf, i) => {
    const mime = mimeOfBuffer(buf)
    const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/webp' ? 'webp' : 'png')
    form.append(images.length > 1 ? 'image[]' : 'image', new Blob([buf], { type: mime }), `reference-${i + 1}.${ext}`)
  })
  if (relay.extraParams && typeof relay.extraParams === 'object') {
    for (const [k, v] of Object.entries(relay.extraParams)) {
      if (v !== undefined && v !== null) form.append(k, String(v))
    }
  }
  const res = await fetch(`${baseOf(relay)}/images/edits`, {
    method: 'POST',
    headers: authHeaders(relay.__key),
    body: form,
    signal,
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${truncate(text, 800)}`)
    err.status = res.status
    throw err
  }
  return parseJson(text, '中转站')
}

async function callImagesGenerations({ relay, model, prompt, size, quality, signal }) {
  const body = {
    model,
    prompt,
    n: 1,
    size: size || '1536x1024',
    quality: quality || 'high',
    response_format: 'b64_json',
    ...(relay.extraParams && typeof relay.extraParams === 'object' ? relay.extraParams : {}),
  }
  const res = await fetch(`${baseOf(relay)}/images/generations`, {
    method: 'POST',
    headers: { ...authHeaders(relay.__key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${truncate(text, 800)}`)
    err.status = res.status
    throw err
  }
  return parseJson(text, '中转站')
}

async function callChatImage({ relay, model, prompt, signal }) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    stream: false,
  }
  const res = await fetch(`${baseOf(relay)}/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders(relay.__key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${truncate(text, 800)}`)
    err.status = res.status
    throw err
  }
  return parseJson(text, '中转站')
}

export class RelayClient {
  constructor({ settings, secrets, log }) {
    this.settings = settings
    this.secrets = secrets
    this.log = log || (() => {})
  }

  relay(relayId) {
    const id = relayId || this.settings.defaultRelayId
    return this.settings.relays.find((r) => r.id === id) || this.settings.relays[0] || null
  }

  async relayWithKey(relayId) {
    const relay = this.relay(relayId)
    if (!relay) throw new Error('没有配置中转站')
    const key = await this.secrets.getRelayKey(relay.id)
    if (!key) throw new Error(`中转站「${relay.name}」还没有填写 API Key`)
    return { ...relay, __key: key }
  }

  async test(relayId) {
    const started = Date.now()
    try {
      const relay = await this.relayWithKey(relayId)
      let models = []
      let status = 0
      let note = ''
      try {
        const res = await fetch(`${baseOf(relay)}/models`, {
          headers: authHeaders(relay.__key),
          signal: AbortSignal.timeout(20000),
        })
        status = res.status
        const text = await res.text()
        if (res.ok) {
          const data = parseJson(text, '中转站')
          models = (Array.isArray(data?.data) ? data.data : []).map((m) => m.id).filter(Boolean)
        } else {
          note = `HTTP ${res.status}: ${truncate(text, 300)}`
        }
      } catch (err) {
        note = String(err?.message || err)
      }
      const ok = status === 200
      return {
        ok,
        relayId: relay.id,
        name: relay.name,
        latencyMs: Date.now() - started,
        status: status || null,
        models,
        note: ok ? `连接正常，发现 ${models.length} 个模型` : (status === 404 ? '接口可用，但该站没有 /models 列表；可以直接试生成' : note),
      }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: String(err?.message || err) }
    }
  }

  async listModels(relayId) {
    try {
      const relay = await this.relayWithKey(relayId)
      const res = await fetch(`${baseOf(relay)}/models`, {
        headers: authHeaders(relay.__key),
        signal: AbortSignal.timeout(20000),
      })
      const text = await res.text()
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${truncate(text, 300)}` }
      const data = parseJson(text, '中转站')
      return { ok: true, models: (Array.isArray(data?.data) ? data.data : []).map((m) => m.id).filter(Boolean) }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  }

  async generate({
    relayId,
    model,
    prompt,
    negativePrompt,
    referenceBuffer,
    referenceBuffers,
    ratio,
    size,
    quality,
    signal,
  }) {
    const relay = await this.relayWithKey(relayId)
    const images = (Array.isArray(referenceBuffers) && referenceBuffers.length ? referenceBuffers : [referenceBuffer]).filter(Boolean)
    const models = [model, relay.defaultModel, ...(relay.fallbackModels || [])]
      .filter(Boolean)
      .filter((m, i, arr) => arr.indexOf(m) === i)
    const chosenSize = size || relaySize(ratio, relay) || '1536x1024'
    const quality2 = quality || relay.quality || 'high'
    const fullPrompt = negativePrompt
      ? `${prompt}\n\nAvoid / negative prompt: ${negativePrompt}`
      : prompt
    let lastErr = null
    for (const m of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const started = Date.now()
          let data
          if (relay.protocol === 'openai-chat') {
            data = await callChatImage({ relay, model: m, prompt: fullPrompt, signal })
          } else if (images.length) {
            data = await callImagesEdits({ relay, model: m, prompt: fullPrompt, referenceBuffer: images[0], referenceBuffers: images, size: chosenSize, quality: quality2, signal })
          } else {
            data = await callImagesGenerations({ relay, model: m, prompt: fullPrompt, size: chosenSize, quality: quality2, signal })
          }
          const item = extractImage(data)
          const buffer = item.buffer || await download(item.url, signal)
          this.log(`[relay] ${relay.name} ${m} ${images.length ? `edits(${images.length})` : 'generations'} ${chosenSize} -> ${buffer.length} bytes in ${Date.now() - started}ms`)
          return { buffer, model: m, relay: relay.name, relayId: relay.id, size: chosenSize, usage: data?.usage || null, latencyMs: Date.now() - started }
        } catch (err) {
          lastErr = err
          const status = err?.status
          const msg = String(err?.message || err)
          const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504
          const modelIssue = /no available|无可用|not available|overloaded|capacity|兼容账号/i.test(msg)
          this.log(`[relay] 失败 model=${m} attempt=${attempt + 1} status=${status || '-'} ${truncate(msg, 300)}`)
          if (status === 400 && images.length > 1) {
            // 部分中转站只接受单图；多图风格参考失败时退回第一张（底图/主参考），不直接报错。
            try {
              this.log(`[relay] 多图编辑不被支持，退回单图：${m}`)
              const data = await callImagesEdits({ relay, model: m, prompt: fullPrompt, referenceBuffer: images[0], size: chosenSize, quality: quality2, signal })
              const item = extractImage(data)
              const buffer = item.buffer || await download(item.url, signal)
              return { buffer, model: m, relay: relay.name, relayId: relay.id, size: chosenSize, usage: data?.usage || null, latencyMs: 0, imagesUsed: 1, multiFallback: true }
            } catch (e2) { lastErr = e2 }
          }
          if (status === 400 && /size/i.test(msg) && chosenSize !== '1024x1024') {
            // 某些站不支持自定义尺寸，退回方图保底
            try {
              const data = images.length
                ? await callImagesEdits({ relay, model: m, prompt: fullPrompt, referenceBuffer: images[0], referenceBuffers: images, size: '1024x1024', quality: quality2, signal })
                : await callImagesGenerations({ relay, model: m, prompt: fullPrompt, size: '1024x1024', quality: quality2, signal })
              const item = extractImage(data)
              const buffer = item.buffer || await download(item.url, signal)
              return { buffer, model: m, relay: relay.name, relayId: relay.id, size: '1024x1024', usage: data?.usage || null, latencyMs: 0 }
            } catch (e2) { lastErr = e2 }
          }
          if (!retryable && !modelIssue) break
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * Math.pow(2.2, attempt)))
        }
      }
      if (models.length > 1) this.log(`[relay] 切换备用模型：${m} -> 下一个`)
    }
    throw new Error(`中转站生成失败：${truncate(lastErr?.message || lastErr, 900)}`)
  }
}
