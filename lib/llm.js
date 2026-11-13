import { buildPlannerPrompt, deterministicPlan, normalizeVariant, getStyle } from './styles.js'
import { extractJson, truncate } from './util.js'
import { visionDataUrl } from './render.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export class LlmClient {
  constructor({ ctx, settings, secrets, log }) {
    this.ctx = ctx
    this.settings = settings
    this.secrets = secrets
    this.log = log || (() => {})
  }

  llmService() {
    try {
      return this.ctx?.get?.('llm') || this.ctx?.llm || null
    } catch {
      return null
    }
  }

  async keyForMain() {
    if (this.settings.mainModel.mode === 'custom') {
      const k = await this.secrets.getMainKey()
      if (k) return k
    }
    return this.secrets.getDshKey()
  }

  baseUrl() {
    return (this.settings.mainModel.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
  }

  async listDshModels() {
    const llm = this.llmService()
    if (!llm) return { providers: [], models: [], source: 'none' }
    const out = { providers: [], models: [], source: 'dsh' }
    try {
      const providers = llm.listProviders?.()
      out.providers = Array.isArray(providers) ? providers : (providers ? [providers] : [])
    } catch {}
    try {
      const models = await llm.listModels?.(this.settings.mainModel.provider)
      out.models = Array.isArray(models) ? models : []
    } catch {}
    return out
  }

  async testMain() {
    const started = Date.now()
    try {
      const result = await this.complete({
        system: '你是一个连通性测试助手。',
        user: '只回复两个字：可用',
        maxTokens: 512,
        temperature: 0,
        reasoningEffort: 'low',
      })
      return {
        ok: true,
        latencyMs: Date.now() - started,
        model: result.model,
        provider: result.provider,
        via: result.via,
        preview: truncate(result.text, 80),
      }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: String(err?.message || err) }
    }
  }

  async streamViaDsh({ system, user, maxTokens }) {
    const llm = this.llmService()
    if (!llm?.stream) throw new Error('DSH LLM 服务不可用')
    const provider = this.settings.mainModel.provider || 'deepseek-official'
    const model = this.settings.mainModel.model || 'deepseek-flash'
    const messages = [
      { role: 'system', content: [{ type: 'text', text: system }] },
      { role: 'user', content: [{ type: 'text', text: user }] },
    ]
    let text = ''
    let finish = null
    const stream = llm.stream({ provider, model, messages, maxTokens })
    for await (const chunk of stream) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta') text += chunk.text || ''
      else if (chunk.type === 'finish') {
        finish = chunk
        const kind = chunk.reason?.kind || chunk.kind
        const failure = chunk.reason?.failure || chunk.failure || chunk.reason
        if (kind === 'error') {
          throw new Error(`DSH 模型调用失败：${failure?.message || failure?.code || JSON.stringify(failure).slice(0, 300)}`)
        }
        if (kind === 'aborted') throw new Error('DSH 模型调用已取消')
      }
    }
    if (!text.trim()) throw new Error('DSH 模型没有返回文本')
    return { text, model, provider, via: 'dsh', finish }
  }

  async chatDirect({ system, user, maxTokens = 8192, temperature = 0.4, reasoningEffort = 'high', messages }) {
    const key = await this.keyForMain()
    if (!key) {
      throw new Error('没有可用的主模型密钥：请跟随 DSH（需要 DEEPSEEK_API_KEY）或在设置里填写自定义主模型 API Key。')
    }
    const base = this.baseUrl()
    const model = this.settings.mainModel.model || 'deepseek-flash'
    const body = {
      model,
      messages: messages || [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }
    if (reasoningEffort) body.reasoning_effort = reasoningEffort
    const doFetch = async (payload) => {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300000),
      })
      const text = await res.text()
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}: ${truncate(text, 600)}`)
        err.status = res.status
        err.body = text
        throw err
      }
      try { return JSON.parse(text) } catch { throw new Error(`主模型返回了非 JSON 响应：${truncate(text, 400)}`) }
    }
    let data
    try {
      data = await doFetch(body)
    } catch (err) {
      // 某些兼容端点不认 reasoning_effort，去掉重试一次
      if (err.status === 400 && body.reasoning_effort) {
        delete body.reasoning_effort
        data = await doFetch(body)
      } else {
        throw err
      }
    }
    const choice = data?.choices?.[0]
    let content = choice?.message?.content || ''
    if (Array.isArray(content)) {
      content = content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('')
    }
    // DeepSeek 会把推理放在 reasoning_content；如果 max_tokens 被推理吃光，content 为空
    if (!String(content).trim() && choice?.message?.reasoning_content) {
      const retry = { ...body, max_tokens: Math.max(Number(body.max_tokens) * 2, 8192) }
      if (retry.reasoning_effort) retry.reasoning_effort = 'low'
      const second = await doFetch(retry)
      const c2 = second?.choices?.[0]?.message?.content || ''
      if (String(c2).trim()) {
        return { text: String(c2), model, provider: 'direct', via: 'direct', usage: second?.usage }
      }
    }
    if (!String(content).trim()) {
      throw new Error('主模型返回了空内容（可能推理 token 用尽），请重试或降低推理强度。')
    }
    return { text: String(content), model, provider: 'direct', via: 'direct', usage: data?.usage }
  }

  async complete({ system, user, maxTokens = 8192, temperature = 0.4, reasoningEffort = 'high' }) {
    const mode = this.settings.mainModel.mode
    if (mode !== 'custom') {
      try {
        return await this.streamViaDsh({ system, user, maxTokens })
      } catch (err) {
        this.log(`[llm] DSH 通道失败，回退直连：${err?.message || err}`)
      }
    }
    return this.chatDirect({ system, user, maxTokens, temperature, reasoningEffort })
  }

  async vision({ imageDataUrl, prompt, maxTokens = 4096 }) {
    const key = await this.keyForMain()
    if (!key) throw new Error('没有可用的识图密钥')
    const model = this.settings.mainModel.visionModel || this.settings.mainModel.model || 'deepseek-flash'
    const body = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      }],
      max_tokens: maxTokens,
      temperature: 0.2,
      stream: false,
      reasoning_effort: 'low',
    }
    const doFetch = async (payload) => {
      const res = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180000),
      })
      const text = await res.text()
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}: ${truncate(text, 600)}`)
        err.status = res.status
        throw err
      }
      return JSON.parse(text)
    }
    let data
    try {
      data = await doFetch(body)
    } catch (err) {
      if (err.status === 400 && body.reasoning_effort) {
        delete body.reasoning_effort
        data = await doFetch(body)
      } else throw err
    }
    let content = data?.choices?.[0]?.message?.content || ''
    if (Array.isArray(content)) content = content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('')
    if (!String(content).trim()) {
      // 推理 token 吃光时再给一次更长的预算
      const retry = await doFetch({ ...body, max_tokens: 8192, reasoning_effort: 'low' })
      content = retry?.choices?.[0]?.message?.content || ''
    }
    if (!String(content).trim()) throw new Error('识图模型没有返回内容')
    return { text: String(content), model, usage: data?.usage }
  }

  async analyzeReference({ buffer, name, index }) {
    const img = await visionDataUrl(buffer, 1400)
    const prompt = `你是视频封面美术分析助手。请分析这张参考封面，只输出 JSON，不要 Markdown：
{
  "summary": "一句话概括这张封面的视觉方向",
  "composition": "构图：主体位置、标题位置、留白方向、人物与文字的关系",
  "titlePlacement": "标题在画面中的位置、对齐、行数、字号感觉",
  "typography": "字体气质（宋体/黑体/手写）、粗细、字距、颜色、描边/阴影",
  "palette": ["#hex", "#hex", "#hex"],
  "mood": "氛围关键词",
  "strengths": ["值得复用的点"],
  "weaknesses": ["可以避免的点"],
  "usableFor": "适合什么类型的视频封面",
  "styleTags": ["标签1", "标签2"]
}
只输出 JSON。参考图名称：${name || `参考图 ${index + 1}`}`
    const result = await this.vision({ imageDataUrl: img.dataUrl, prompt, maxTokens: 4096 })
    let analysis
    try {
      analysis = extractJson(result.text)
    } catch {
      analysis = { summary: truncate(result.text, 1200) }
    }
    return {
      analysis,
      model: result.model,
      sent: { width: img.sentWidth, height: img.sentHeight, originalWidth: img.width, originalHeight: img.height },
    }
  }

  async analyzeBaseImage({ buffer, name, index = 0 }) {
    const img = await visionDataUrl(buffer, 1500)
    const prompt = `你是视频封面美术分析助手。用户把这张图指定为生成封面的“底图”，生图模型必须最大程度保留它。请仔细看图，只输出 JSON：
{
  "baseSummary": "一句话说明底图是什么画面",
  "subject": "主体是谁/是什么，外貌、服装、姿势、朝向、表情",
  "composition": "主体在画面中的位置、占比、前景/背景关系",
  "preserve": ["必须原样保留的视觉元素，至少 4 条"],
  "lighting": "光线方向、色温、明暗对比",
  "palette": ["#hex", "#hex", "#hex"],
  "textAreas": "原图文字/Logo/水印的位置，以及适合放新标题的干净区域",
  "extend": "如果要扩成目标画幅，背景应该向哪个方向自然延伸"
}
只输出 JSON。参考图名称：${name || `底图 ${index + 1}`}`
    const result = await this.vision({ imageDataUrl: img.dataUrl, prompt, maxTokens: 4096 })
    let analysis
    try {
      analysis = extractJson(result.text)
    } catch {
      analysis = { baseSummary: truncate(result.text, 1200) }
    }
    return {
      analysis,
      model: result.model,
      sent: { width: img.sentWidth, height: img.sentHeight, originalWidth: img.width, originalHeight: img.height },
    }
  }

  async learnReplica({ buffer, name, ratio = '16:9' }) {
    const img = await visionDataUrl(buffer, 1400)
    const layoutIds = ['left-stack', 'vertical-duo', 'bottom-title', 'center-overlap', 'top-title', 'right-title', 'edge-poster', 'diagonal']
    const user = `你是视频封面复刻拆解师。只输出严格 JSON，不输出 Markdown 或解释。把这张封面的版式、文字层级、配色和画面气质拆成可复用配方，而不是复制它的具体人物或文字。
请拆解这张参考封面，让用户可以用自己的主题和人物做出「同款版式」的新封面。
参考封面名称：${name || '参考封面'}
原始画幅：${ratio}

只输出 JSON：
{
  "summary": "一句话概括这张封面的视觉方向",
  "layoutId": "从 left-stack / vertical-duo / bottom-title / center-overlap / top-title / right-title / edge-poster / diagonal 选最接近的一个",
  "composition": "主体在画面中的位置、占比、朝向；标题和人物的关系；留白方向",
  "subjectPlacement": "人物/产品/场景主体应该放在哪里，占多大比例",
  "titlePlacement": "标题在画面中的位置、对齐、行数、字号占比、是否压住主体",
  "layout": {
    "titleX": 0.05, "titleY": 0.10, "titleW": 0.55, "titleH": 0.30,
    "subtitleX": 0.06, "subtitleY": 0.72, "subtitleW": 0.42, "subtitleH": 0.12,
    "gradient": "left|right|bottom|top|none",
    "subtitleBar": false
  },
  "subjectBox": { "x": 0.45, "y": 0.08, "w": 0.52, "h": 0.86 },
  "typography": {
    "titleSize": 0.11,
    "titleTracking": 0.02,
    "titleLineHeight": 1.02,
    "subtitleSize": 0.03,
    "align": "left",
    "font": "serif",
    "weight": 900,
    "vertical": false,
    "maxTitleLines": 2,
    "titleColor": "auto",
    "subtitleFont": "sans",
    "subtitleColor": "auto"
  },
  "palette": ["#hex", "#hex", "#hex"],
  "lighting": "光线方向、色温、对比、质感",
  "decorations": "需要的装饰：细线/色块/边框/颗粒/光晕等；没有就写 none",
  "backgroundPrompt": "English prompt. Describe the scene composition, subject placement (with clean negative space for a large Chinese title), camera angle, lighting, color grade, texture and mood. Write for a NEW subject from the user's brief, never name or reproduce the original characters. No text, letters, numbers, logos or watermarks.",
  "negativePrompt": "English negative prompt: things to avoid, e.g. text, watermark, logo, collage, split screen, extra people",
  "styleTags": ["3-6 个短标签"]
}
titleSize 是标题字号占画面宽度的比例（0.08-0.17），titleLines 1-3 行；背景描述必须给大标题留出干净负空间。只输出 JSON。`
    try {
      const result = await this.vision({ imageDataUrl: img.dataUrl, prompt: user, maxTokens: 5000 })
      const parsed = extractJson(result.text)
      if (!parsed || typeof parsed !== 'object') throw new Error('复刻拆解没有返回对象')
      const typo = parsed.typography && typeof parsed.typography === 'object' ? parsed.typography : {}
      const num = (v, min, max, fallback) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return fallback
        return Math.min(max, Math.max(min, n))
      }
      const layoutId = layoutIds.includes(String(parsed.layoutId || '')) ? String(parsed.layoutId) : 'left-stack'
      const palette = Array.isArray(parsed.palette)
        ? parsed.palette.map(String).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 8)
        : []
      const fixBox = (raw, def) => {
        const r = raw && typeof raw === 'object' ? raw : {}
        let x = num(r.x, 0, 0.98, def.x)
        let y = num(r.y, 0, 0.98, def.y)
        let w = num(r.w, 0.04, 1, def.w)
        let h = num(r.h, 0.04, 1, def.h)
        if (x + w > 1) w = Math.max(0.04, 1 - x)
        if (y + h > 1) h = Math.max(0.04, 1 - y)
        return { x, y, w, h }
      }
      const layoutRaw = parsed.layout && typeof parsed.layout === 'object' ? parsed.layout : {}
      const titleBox = fixBox({ x: layoutRaw.titleX, y: layoutRaw.titleY, w: layoutRaw.titleW, h: layoutRaw.titleH }, { x: 0.05, y: 0.1, w: 0.55, h: 0.3 })
      const subBox = fixBox({ x: layoutRaw.subtitleX, y: layoutRaw.subtitleY, w: layoutRaw.subtitleW, h: layoutRaw.subtitleH }, { x: 0.06, y: 0.72, w: 0.42, h: 0.12 })
      const layout = {
        titleX: titleBox.x,
        titleY: titleBox.y,
        titleW: titleBox.w,
        titleH: titleBox.h,
        subtitleX: subBox.x,
        subtitleY: subBox.y,
        subtitleW: subBox.w,
        subtitleH: subBox.h,
        gradient: ['left', 'right', 'bottom', 'top', 'none'].includes(String(layoutRaw.gradient)) ? String(layoutRaw.gradient) : 'left',
        subtitleBar: layoutRaw.subtitleBar === true,
      }
      const subjectBox = parsed.subjectBox && typeof parsed.subjectBox === 'object'
        ? fixBox(parsed.subjectBox, { x: 0.35, y: 0.08, w: 0.6, h: 0.86 })
        : null
      const recipe = {
        summary: String(parsed.summary || '').slice(0, 1200),
        layoutId,
        composition: String(parsed.composition || '').slice(0, 1600),
        subjectPlacement: String(parsed.subjectPlacement || '').slice(0, 800),
        titlePlacement: String(parsed.titlePlacement || '').slice(0, 800),
        layout,
        titleBox,
        subBox,
        subjectBox,
        typography: {
          titleSize: num(typo.titleSize, 0.08, 0.2, 0.11),
          titleTracking: num(typo.titleTracking, 0, 0.06, 0.02),
          titleLineHeight: num(typo.titleLineHeight, 0.9, 1.25, 1.02),
          subtitleSize: num(typo.subtitleSize, 0.02, 0.045, 0.03),
          align: ['left', 'center', 'right'].includes(String(typo.align)) ? String(typo.align) : 'left',
          font: String(typo.font || '').toLowerCase() === 'sans' ? 'sans' : 'serif',
          weight: Math.round(num(typo.weight, 400, 900, 900)),
          vertical: typo.vertical === true,
          maxTitleLines: Math.round(num(typo.maxTitleLines || typo.titleLines, 1, 3, 2)),
          titleLines: Math.round(num(typo.titleLines || typo.maxTitleLines, 1, 3, 2)),
          titleColor: /^#[0-9a-f]{3,8}$/i.test(String(typo.titleColor || '')) ? String(typo.titleColor) : 'auto',
          subtitleFont: String(typo.subtitleFont || '').toLowerCase() === 'serif' ? 'serif' : 'sans',
          subtitleColor: /^#[0-9a-f]{3,8}$/i.test(String(typo.subtitleColor || '')) ? String(typo.subtitleColor) : 'auto',
          scrim: typo.scrim === true,
        },
        palette,
        lighting: String(parsed.lighting || '').slice(0, 800),
        decorations: String(parsed.decorations || '').slice(0, 600),
        backgroundPrompt: String(parsed.backgroundPrompt || '').slice(0, 8000),
        negativePrompt: String(parsed.negativePrompt || '').slice(0, 1200),
        styleTags: Array.isArray(parsed.styleTags) ? parsed.styleTags.map(String).slice(0, 8) : [],
      }
      if (!recipe.backgroundPrompt) throw new Error('复刻拆解缺少背景提示词')
      return { recipe, via: 'vision', model: result.model }
    } catch (err) {
      this.log('[llm] 单封面复刻拆解失败，改用通用识图结果：' + (err?.message || err))
      const fallback = await this.analyzeReference({ buffer, name, index: 0 })
      const a = fallback.analysis || {}
      const summary = String(a.summary || '').slice(0, 1200)
      const composition = String(a.composition || '').slice(0, 1600)
      const titlePlacement = String(a.titlePlacement || '').slice(0, 800)
      const palette = (Array.isArray(a.palette) ? a.palette : ['#0B0F14', '#F7F3EA']).filter((c) => /^#[0-9a-f]{3,8}$/i.test(String(c))).slice(0, 8)
      return {
        recipe: {
          summary,
          layoutId: 'left-stack',
          composition,
          subjectPlacement: '',
          titlePlacement,
          layout: { titleX: 0.05, titleY: 0.1, titleW: 0.55, titleH: 0.3, subtitleX: 0.06, subtitleY: 0.72, subtitleW: 0.42, subtitleH: 0.12, gradient: 'left', subtitleBar: false },
          titleBox: { x: 0.05, y: 0.1, w: 0.55, h: 0.3 },
          subBox: { x: 0.06, y: 0.72, w: 0.42, h: 0.12 },
          subjectBox: null,
          typography: {
            titleSize: 0.11, titleTracking: 0.02, titleLineHeight: 1.02, subtitleSize: 0.03,
            align: 'left', font: 'serif', weight: 900, vertical: false,
            maxTitleLines: 2, titleLines: 2, titleColor: 'auto',
            subtitleFont: 'sans', subtitleColor: 'auto', scrim: false,
          },
          palette,
          lighting: '',
          decorations: '',
          backgroundPrompt: `${composition || summary || 'cinematic composition with a clear subject'}. Keep a large clean negative space for a Chinese title. Cinematic lighting, rich color grade, high detail. No text, letters, numbers, logos or watermarks.`,
          negativePrompt: 'text, watermark, logo, collage, split screen, extra people, distorted face',
          styleTags: Array.isArray(a.styleTags) ? a.styleTags.map(String).slice(0, 8) : [],
        },
        via: 'fallback',
        model: fallback.model,
      }
    }
  }

  async decomposeTemplate({ buffer, name, width, height }) {
    const img = await visionDataUrl(buffer, 1600)
    const prompt = `你是封面拆解师。把这张封面拆成可编辑模板：逐条识别画面里的文字（中文/英文都要），给出归一化位置、字体气质、颜色和大小；再给出人物/产品主体框。
只输出严格 JSON，不要 Markdown：
{
  "summary": "这张封面的整体风格，一句话",
  "texts": [
    {
      "text": "原图上的文字，逐字识别；多行用 \\n",
      "role": "title 或 subtitle 或 label",
      "x": 0.06, "y": 0.08, "w": 0.50, "h": 0.22,
      "font": "serif 或 sans 或 hand",
      "weight": 900,
      "color": "#F7F3EA",
      "align": "left 或 center 或 right",
      "fontSize": 0.11,
      "lineHeight": 1.02,
      "tracking": 0.02,
      "rotation": 0,
      "vertical": false,
      "stroke": "",
      "opacity": 1
    }
  ],
  "subjectBox": { "x": 0.40, "y": 0.05, "w": 0.55, "h": 0.90 },
  "subjectDescription": "主体是谁/是什么、外貌、服装、动作",
  "backgroundPrompt": "English prompt describing the scene WITHOUT any text; keep subject, composition, lighting, colors, texture",
  "negativePrompt": "English negative prompt",
  "styleSummary": "版式/字体/配色的中文拆解"
}
要求：
- x/y/w/h 都是相对整张图的 0-1 比例，必须尽量贴合原文字块，不要把整张图当成一个块。
- fontSize 是字号占画面宽度的比例（常见 0.05-0.18）。
- texts 最多 12 条，按从上到下排序；小字/水印/版权字可以省略。
- 不要编造看不清的文字；看不清的整条跳过。
- subjectBox 必须框住画面主要人物/产品，包含头发和肩膀。
- 只输出 JSON。参考封面名称：${name || '参考封面'}；原图像素：${width || '?'}×${height || '?'}`
    try {
      const result = await this.vision({ imageDataUrl: img.dataUrl, prompt, maxTokens: 7000 })
      const parsed = extractJson(result.text)
      if (!parsed || typeof parsed !== 'object') throw new Error('拆解没有返回对象')
      const num = (v, min, max, fallback) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return fallback
        return Math.min(max, Math.max(min, n))
      }
      const clamp01 = (v, fallback) => num(v, 0, 1, fallback)
      const srcW = Number(width) || img.width || 1
      const srcH = Number(height) || img.height || 1
      const normRect = (raw, defX = 0.06, defY = 0.06, defW = 0.5, defH = 0.16) => {
        const r = raw && typeof raw === 'object' ? raw : {}
        const rawX = Number(r.x) || 0
        const rawY = Number(r.y) || 0
        const rawW = Number(r.w) || 0
        const rawH = Number(r.h) || 0
        const sx = Math.max(Math.abs(rawX), Math.abs(rawW)) > 1.001 ? 1 / srcW : 1
        const sy = Math.max(Math.abs(rawY), Math.abs(rawH)) > 1.001 ? 1 / srcH : 1
        const x = clamp01(rawX * sx, defX)
        const y = clamp01(rawY * sy, defY)
        return {
          x, y,
          w: num(rawW * sx, 0.04, Math.max(0.04, 1 - x), defW),
          h: num(rawH * sy, 0.03, Math.max(0.03, 1 - y), defH),
        }
      }
      const texts = (Array.isArray(parsed.texts) ? parsed.texts : []).slice(0, 12).map((t, i) => {
        const text = String(t?.text || '').replace(/\r/g, '').trim().slice(0, 300)
        if (!text) return null
        const rect = normRect(t)
        const rawFont = Number(t.fontSize)
        const fontSize = Number.isFinite(rawFont) && rawFont > 1 ? rawFont / srcW : num(rawFont, 0.02, 0.24, Math.min(0.16, Math.max(0.05, rect.h * 0.72)))
        return {
          id: 'text-' + (i + 1),
          text,
          role: ['title', 'subtitle'].includes(String(t.role)) ? String(t.role) : 'label',
          x: rect.x, y: rect.y, w: rect.w, h: rect.h,
          font: ['sans', 'hand'].includes(String(t.font || '').toLowerCase()) ? String(t.font).toLowerCase() : 'serif',
          weight: Math.round(num(t.weight, 300, 900, 900)),
          color: /^#[0-9a-f]{3,8}$/i.test(String(t.color || '')) ? String(t.color) : '',
          align: ['left', 'center', 'right'].includes(String(t.align)) ? String(t.align) : 'left',
          fontSize,
          lineHeight: num(t.lineHeight, 0.85, 1.8, 1.05),
          tracking: num(t.tracking, -0.02, 0.08, 0.02),
          rotation: num(t.rotation, -25, 25, 0),
          vertical: t.vertical === true,
          stroke: /^#[0-9a-f]{3,8}$/i.test(String(t.stroke || '')) ? String(t.stroke) : '',
          opacity: num(t.opacity, 0.15, 1, 1),
        }
      }).filter(Boolean)
      const rawSubject = parsed.subjectBox && typeof parsed.subjectBox === 'object' ? parsed.subjectBox : null
      const subjectBox = rawSubject ? normRect(rawSubject, 0.3, 0.05, 0.6, 0.9) : null
      return {
        template: {
          summary: String(parsed.summary || '').slice(0, 1200),
          styleSummary: String(parsed.styleSummary || '').slice(0, 2000),
          texts,
          subjectBox,
          subjectDescription: String(parsed.subjectDescription || '').slice(0, 1000),
          backgroundPrompt: String(parsed.backgroundPrompt || '').slice(0, 8000),
          negativePrompt: String(parsed.negativePrompt || '').slice(0, 1500),
          sourceWidth: Number(width) || img.width || 0,
          sourceHeight: Number(height) || img.height || 0,
        },
        via: 'vision',
        model: result.model,
      }
    } catch (err) {
      this.log('[llm] 封面模板拆解失败：' + (err?.message || err))
      const fallback = await this.analyzeReference({ buffer, name, index: 0 })
      const a = fallback.analysis || {}
      return {
        template: {
          summary: String(a.summary || '').slice(0, 1000),
          styleSummary: [a.composition, a.titlePlacement, a.typography].filter(Boolean).join('；').slice(0, 1600),
          texts: [],
          subjectBox: null,
          subjectDescription: '',
          backgroundPrompt: String(a.summary || 'Keep the original composition, lighting and colors').slice(0, 3000),
          negativePrompt: 'text, watermark, logo',
          sourceWidth: Number(width) || img.width || 0,
          sourceHeight: Number(height) || img.height || 0,
        },
        via: 'fallback',
        model: fallback.model,
      }
    }
  }

  async plan({
    brief,
    title,
    subtitle,
    selectedStyles,
    count,
    ratio,
    references,
    customStyle,
    documentText,
    baseReferenceId,
    baseAnalysis,
    manualContext,
  }) {
    const prompt = buildPlannerPrompt({
      brief, title, subtitle, selectedStyles, count, ratio, references, customStyle, documentText, settings: this.settings,
      baseReferenceId, baseAnalysis, manualContext,
    })
    try {
      const result = await this.complete({
        system: prompt.system,
        user: prompt.user,
        maxTokens: 8192,
        temperature: 0.65,
        reasoningEffort: 'high',
      })
      const parsed = extractJson(result.text)
      const rawVariants = Array.isArray(parsed?.variants) ? parsed.variants : []
      if (!rawVariants.length) throw new Error('规划结果没有 variants')
      const fallbackPlan = deterministicPlan({
        brief, title, subtitle, selectedStyles, count, ratio, references, customStyle, settings: this.settings,
        baseReferenceId, manualContext,
      })
      const variants = []
      const usedLayouts = new Set()
      for (let i = 0; i < count; i++) {
        const base = fallbackPlan.variants[i] || fallbackPlan.variants[0]
        let v = normalizeVariant(rawVariants[i] || {}, base)
        if (usedLayouts.has(v.layoutId)) {
          // 强制拉开版式
          v = { ...v, layoutId: base.layoutId, backgroundPrompt: `${v.backgroundPrompt} 版式变化 ${i + 1}：${base.notes || ''}` }
        }
        usedLayouts.add(v.layoutId)
        if (!v.title) v.title = title || base.title
        if (!v.subtitle) v.subtitle = subtitle || base.subtitle
        if (!v.backgroundPrompt) v.backgroundPrompt = base.backgroundPrompt
        if (!v.negativePrompt) v.negativePrompt = base.negativePrompt
        v.ratio = ratio
        variants.push(v)
      }
      return { variants, coverBrief: parsed?.coverBrief || '', via: result.via, model: result.model }
    } catch (err) {
      this.log(`[llm] 规划失败，使用确定性方案：${err?.message || err}`)
      const fallback = deterministicPlan({
        brief, title, subtitle, selectedStyles, count, ratio, references, customStyle, settings: this.settings,
      })
      return { ...fallback, via: 'fallback', model: 'local' }
    }
  }

  async learnSection({ section, references = [] }) {
    const refs = references.map((r, i) => ({
      index: i + 1,
      uploadId: r.uploadId || r.upload?.id || '',
      name: r.name || r.upload?.title || '参考封面',
      title: r.title || r.upload?.title || '',
      author: r.author || r.upload?.author || '',
      views: r.views || r.upload?.views || 0,
      analysis: r.analysis || {},
    }))
    const system = '你是资深视频封面风格研究员。你只输出严格 JSON，不输出 Markdown、解释或代码围栏。你的任务是从一组同分区高播放视频封面中提炼可复用的设计规律，而不是复制具体人物、文字或画面。'
    const user = `分区：${section?.name || '未命名'}
分区关键词：${(section?.keywords || []).join('、') || '（无）'}

参考封面分析：
${JSON.stringify(refs, null, 2)}

请提炼这个分区的「封面风格 DNA」，并归并成 1-4 种可复用封面类型：
{
  "summary": "这个分区高播放封面的整体共性，一句话",
  "visualDNA": ["构图规律", "人物占比", "标题与人物关系", "留白方向", "光影/色调", "信息层级"],
  "titlePatterns": ["标题常见结构/字数/语气"],
  "palette": ["#hex", "#hex", "#hex"],
  "typography": { "titleSize": 0.11, "titleTracking": 0.02, "titleLineHeight": 1.02, "subtitleSize": 0.03, "align": "left" },
  "layoutPool": ["left-stack", "vertical-duo", "bottom-title", "center-overlap", "top-title", "right-title", "edge-poster"],
  "stylePrompt": "写给生图模型的风格约束：只描述构图/字体气质/配色/光影/信息层级，明确不要复刻具体角色、文字、Logo；保留用户提供的人物原画",
  "coverTypes": [
    { "name": "类型名", "description": "这种类型的版式、标题位置、适合的内容", "refUploadId": "对应参考图的 uploadId，如无则空" }
  ]
}
coverTypes 最多 4 种，必须根据实际参考图归纳，不要为了凑数编造。只输出 JSON。`
    try {
      const result = await this.complete({ system, user, maxTokens: 7000, temperature: 0.35, reasoningEffort: 'high' })
      const parsed = extractJson(result.text)
      if (!parsed || typeof parsed !== 'object') throw new Error('分区学习没有返回对象')
      return {
        learned: {
          summary: String(parsed.summary || '').slice(0, 3000),
          visualDNA: Array.isArray(parsed.visualDNA) ? parsed.visualDNA.map(String).slice(0, 12) : [],
          titlePatterns: Array.isArray(parsed.titlePatterns) ? parsed.titlePatterns.map(String).slice(0, 12) : [],
          palette: Array.isArray(parsed.palette) ? parsed.palette.map(String).slice(0, 8) : [],
          typography: parsed.typography && typeof parsed.typography === 'object' ? parsed.typography : {},
          layoutPool: Array.isArray(parsed.layoutPool) ? parsed.layoutPool.map(String).slice(0, 10) : [],
          stylePrompt: String(parsed.stylePrompt || '').slice(0, 8000),
          coverTypes: Array.isArray(parsed.coverTypes) ? parsed.coverTypes.slice(0, 4).map((t, i) => ({
            id: 'type-' + (i + 1),
            name: String(t?.name || ('类型 ' + (i + 1))).slice(0, 80),
            description: String(t?.description || '').slice(0, 1200),
            refUploadId: String(t?.refUploadId || ''),
          })) : [],
          updatedAt: new Date().toISOString(),
        },
        via: result.via,
        model: result.model,
      }
    } catch (err) {
      this.log('[llm] 分区学习失败，使用本地归纳：' + (err?.message || err))
      return { learned: fallbackSectionLearning(section, refs), via: 'fallback', model: 'local' }
    }
  }

  async expandImageQuery({ query }) {
    const q = String(query || '').trim()
    if (!q) return { queries: [], avoid: [] }
    const system = '你是图片素材检索助手。把用户想要的视觉素材改写成适合图片搜索的具体关键词，并列出应该排除的无关主题。只输出严格 JSON。'
    const user = `用户想找的素材：${q}
用途：视频封面参考图/贴纸素材。

要求：
1. 输出 2-3 个具体的中文或英文图片搜索词，必须包含材质/主体/背景/风格等视觉词，不要只重复原句。
2. avoid 列出容易搜偏的无关主题（例如用户要找“红色画布纹理”，avoid 红色旅游、党建活动、晚会背景）。
3. 不要输出解释。
只输出 JSON：{"queries":["..."],"avoid":["..."]}`
    try {
      const result = await this.complete({ system, user, maxTokens: 900, temperature: 0.4, reasoningEffort: 'low' })
      const parsed = extractJson(result.text)
      const queries = (Array.isArray(parsed?.queries) ? parsed.queries : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
      const avoid = (Array.isArray(parsed?.avoid) ? parsed.avoid : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
      if (queries.length) return { queries, avoid, via: result.via, model: result.model }
    } catch (err) {
      this.log('[llm] 找素材关键词扩写失败：' + (err?.message || err))
    }
    return { queries: [q + ' 高清素材 背景'], avoid: [], via: 'fallback', model: 'local' }
  }

  async inspire({ brief, title, subtitle, ratio = '16:9', styles = ['exclusive'], count = 4, documentText = '' }) {
    const selected = (styles.length ? styles : ['exclusive']).map((id) => getStyle(id, this.settings)).filter(Boolean)
    const styleNames = selected.map((s) => s.name).join('、')
    const system = '你是视频封面创意总监。只输出严格 JSON，不输出 Markdown 或解释。你要给创作者 4 个真正不同、可执行的封面方向，而不是四句空话。四个方向的视觉母题、构图、配色和版式必须明显不同，至少使用 3 种不同的 layoutId，禁止四个都写 left-stack。'
    const user = `视频主题：${brief || '（未填写）'}
主标题：${title ? title : '（用户留空，direction.title 必须返回空字符串，不要编造标题）'}
副标题：${subtitle ? subtitle : '（用户留空，direction.subtitle 必须返回空字符串，不要编造副标题）'}
画幅：${ratio}
可用风格：${styleNames}
${documentText ? '文档内容摘要：\n' + String(documentText).slice(0, 4000) : ''}

请给出 4 个不同的封面方向，每个方向包含标题、副标题、视觉母题、构图、配色、版式和一句推荐理由。四个方向至少 3 种不同 layoutId，配色不要重复同一套。只输出 JSON：
{
  "directions": [
    {
      "id": "d1",
      "name": "方向名（4-8字）",
      "title": "主标题（<=14字）",
      "subtitle": "副标题（<=24字）",
      "visual": "画面主体/场景/光线/材质，具体到能直接生图",
      "composition": "人物位置、标题位置、留白方向、人物与文字关系",
      "palette": ["#hex", "#hex", "#hex"],
      "layoutId": "left-stack/vertical-duo/bottom-title/center-overlap/top-title/right-title/edge-poster",
      "styleId": "从可用风格里选",
      "why": "为什么适合这条视频"
    }
  ]
}
只输出 JSON。`
    try {
      const result = await this.complete({ system, user, maxTokens: 6000, temperature: 0.9, reasoningEffort: 'high' })
      const parsed = extractJson(result.text)
      const list = Array.isArray(parsed?.directions) ? parsed.directions : []
      if (!list.length) throw new Error('没有返回 directions')
      const directions = list.slice(0, count).map((d, i) => normalizeDirection(d, i, { title, subtitle, ratio, styles }))
      const layouts = new Set(directions.map((d) => d.layoutId))
      if (directions.length >= 3 && layouts.size < 3) {
        this.log('[llm] 灵感板方向过于相似，改用多样化本地方向')
        return { directions: fallbackDirections({ brief, title, subtitle, ratio, styles }), via: 'fallback', model: 'local' }
      }
      return { directions, via: result.via, model: result.model }
    } catch (err) {
      this.log('[llm] 灵感板失败，使用本地方向：' + (err?.message || err))
      return { directions: fallbackDirections({ brief, title, subtitle, ratio, styles }), via: 'fallback', model: 'local' }
    }
  }

  async editLayers({ project, instruction }) {
    const current = {
      title: project.title,
      subtitle: project.subtitle,
      ratio: project.ratio,
      styleId: project.styleId,
      layoutId: project.layoutId,
      typography: project.typography,
      layout: project.layout,
      layers: project.layers,
    }
    const system = '你是封面排版编辑器。根据用户指令修改封面图层，只输出 JSON，不要 Markdown。不要改变主标题/副标题的文字，除非用户明确要求改字。'
    const user = `当前封面 JSON：
${JSON.stringify(current, null, 2)}

用户修改要求：
${instruction}

请输出修改后的完整 JSON：
{
  "title": "主标题（通常不变）",
  "subtitle": "副标题（通常不变）",
  "layers": [ ...完整的图层数组... ],
  "notes": "一句话说明改了什么"
}
保持图层结构：text / vertical-text 图层字段包括 id,type,role,text,x,y,w,h,fontSize,fontFamily,fontWeight,color,align,tracking,lineHeight,opacity,angle,vertical,columns,lines。不要新增背景图层，背景由系统保留。只输出 JSON。`
    try {
      const result = await this.complete({ system, user, maxTokens: 8192, temperature: 0.35, reasoningEffort: 'high' })
      const parsed = extractJson(result.text)
      if (!Array.isArray(parsed?.layers) || !parsed.layers.length) throw new Error('没有返回 layers')
      return { ...parsed, via: result.via, model: result.model }
    } catch (err) {
      this.log(`[llm] AI 修改失败，尝试规则修改：${err?.message || err}`)
      return { ...ruleEdit(project, instruction), via: 'rule', model: 'local' }
    }
  }
}

function fallbackSectionLearning(section, refs) {
  const analyses = refs.map((r) => r.analysis || {})
  const summaries = analyses.map((a) => a.summary || a.description).filter(Boolean)
  const comps = analyses.map((a) => a.composition).filter(Boolean)
  const palettes = []
  for (const a of analyses) {
    if (Array.isArray(a.palette)) palettes.push(...a.palette)
  }
  const types = refs.slice(0, 4).map((r, i) => ({
    id: 'type-' + (i + 1),
    name: r.title || r.name || ('类型 ' + (i + 1)),
    description: [r.analysis?.composition, r.analysis?.titlePlacement].filter(Boolean).join('；').slice(0, 600) || '高播放封面参考',
    refUploadId: r.uploadId || r.upload?.id || '',
  }))
  return {
    summary: summaries[0] || (section?.name || '分区') + '高播放封面的共性：大字标题、清晰主体、强对比、干净信息层级。',
    visualDNA: [...new Set([...comps, ...summaries])].slice(0, 8),
    titlePatterns: ['短标题', '强情绪词', '标题与人物层叠'],
    palette: [...new Set(palettes)].slice(0, 6),
    typography: { titleSize: 0.11, titleTracking: 0.02, titleLineHeight: 1.02, subtitleSize: 0.03, align: 'left' },
    layoutPool: ['left-stack', 'vertical-duo', 'bottom-title', 'center-overlap', 'top-title', 'right-title', 'edge-poster'],
    stylePrompt: '模仿这个分区高播放封面的共性：' + (summaries.join('；') || '大字标题、强对比、干净留白') + '。只学习构图、字体气质、配色和信息层级，不复刻具体人物、文字或画面。',
    coverTypes: types,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeDirection(d, i, base) {
  const layoutIds = ['left-stack', 'vertical-duo', 'bottom-title', 'center-overlap', 'top-title', 'right-title', 'edge-poster']
  return {
    id: String(d?.id || ('d' + (i + 1))),
    name: String(d?.name || ('方向 ' + (i + 1))).slice(0, 40),
    title: String(d?.title || base.title || '').slice(0, 40),
    subtitle: String(d?.subtitle || base.subtitle || '').slice(0, 80),
    visual: String(d?.visual || '').slice(0, 2000),
    composition: String(d?.composition || '').slice(0, 1000),
    palette: Array.isArray(d?.palette) ? d.palette.map(String).slice(0, 6) : [],
    layoutId: layoutIds.includes(d?.layoutId) ? d.layoutId : layoutIds[i % layoutIds.length],
    styleId: String(d?.styleId || (base.styles && base.styles[0]) || 'exclusive'),
    why: String(d?.why || '').slice(0, 500),
  }
}

function fallbackDirections({ brief, title, subtitle, ratio, styles }) {
  const templates = [
    { name: '冷蓝电影感', layoutId: 'left-stack', angle: '冷蓝夜景、左侧巨型标题、人物在右三分之一，像电影海报', palette: ['#0B1B2B', '#78B7E8', '#F7F3EA'] },
    { name: '竖排双列', layoutId: 'vertical-duo', angle: '两列竖排宋体，人物与标题前后穿插，适合杂谈/解读', palette: ['#111820', '#D7B88A', '#F4EEE2'] },
    { name: '底部压字', layoutId: 'bottom-title', angle: '人物占上半身，底部大标题压住画面，像纪录片海报', palette: ['#191B1D', '#D9C7A3', '#F7F3EA'] },
    { name: '中心叠字', layoutId: 'center-overlap', angle: '人物居中近景，标题横跨胸口叠压，情绪直给', palette: ['#120F16', '#E06A45', '#F7F3EA'] },
    { name: '顶部大字', layoutId: 'top-title', angle: '标题横跨画面上沿，人物群像在下，适合高信息量封面', palette: ['#081724', '#E8D9B5', '#77B7D9'] },
    { name: '右置标题', layoutId: 'right-title', angle: '人物在左、标题在右，留出呼吸感，适合访谈/人物向', palette: ['#1B1B1B', '#F0E6D2', '#B65C3A'] },
    { name: '极简留白', layoutId: 'edge-poster', angle: '大面积纯色留白，标题只占一角，像杂志封面', palette: ['#E8E1D3', '#28231F', '#B4552D'] },
    { name: '黑底冷光', layoutId: 'left-stack', angle: '黑底冷光、硬边产品特写、标题只用一条细线引导，适合科技/评测', palette: ['#05080C', '#5BA8D6', '#EEF3F6'] },
  ]
  const shuffled = templates.slice().sort(() => Math.random() - 0.5)
  const picked = []
  const usedLayouts = new Set()
  for (const t of shuffled) {
    if (picked.length >= 4) break
    if (usedLayouts.has(t.layoutId) && picked.length < 3) continue
    picked.push(t)
    usedLayouts.add(t.layoutId)
  }
  while (picked.length < 4) picked.push(templates[picked.length])
  return picked.map((t, i) => ({
    id: 'd' + (i + 1),
    name: t.name,
    title: title || '',
    subtitle: subtitle || '',
    visual: (brief || title || '视频主题') + '；' + t.angle,
    composition: t.angle,
    palette: t.palette,
    layoutId: t.layoutId,
    styleId: (styles && styles[0]) || 'exclusive',
    why: '四种构图方向各不相同，先用同一主题横向比较，再选最适合的一条。',
  }))
}

function ruleEdit(project, instruction) {
  const layers = JSON.parse(JSON.stringify(project.layers || []))
  const text = String(instruction || '')
  const title = layers.find((l) => l.role === 'title')
  const subtitle = layers.find((l) => l.role === 'subtitle')
  const num = (m) => Number(m?.[1] || 0)
  const enlarge = /放大|大一点|更大|加大/.test(text)
  const shrink = /缩小|小一点|小些/.test(text)
  const left = /左移|往左|靠左/.test(text)
  const right = /右移|往右|靠右/.test(text)
  const up = /上移|往上|抬高/.test(text)
  const down = /下移|往下|降低/.test(text)
  const pct = num(text.match(/(\d{1,2})\s*%/))
  const factor = pct ? 1 + pct / 100 : (enlarge ? 1.12 : (shrink ? 0.9 : 1))
  if (title) {
    title.fontSize = Math.round((title.fontSize || 120) * factor)
    if (left) title.x -= 40
    if (right) title.x += 40
    if (up) title.y -= 30
    if (down) title.y += 30
    title.lines = null
    title.columns = null
    title.color = title.color === 'auto' ? (title.color || '#F7F3EA') : title.color
  }
  if (subtitle && /副标题/.test(text)) {
    subtitle.fontSize = Math.round((subtitle.fontSize || 40) * factor)
  }
  return { title: project.title, subtitle: project.subtitle, layers, notes: '按关键词做了基础调整' }
}

export { deterministicPlan }
