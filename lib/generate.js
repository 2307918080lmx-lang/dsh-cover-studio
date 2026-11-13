import fs from 'node:fs'
import path from 'node:path'
import { LlmClient } from './llm.js'
import { RelayClient } from './relay.js'
import { renderCover, fitBackground, blankBackground, imageSimilarity, localReframeBuffer, overlayOriginalOnReframe } from './render.js'
import { deterministicPlan, getStyle, chooseVariants } from './styles.js'
import { saveSettings } from './settings.js'
import { normalizeRatioId, ratioText } from './ratios.js'
import {
  createProject,
  getProject,
  saveProject,
  saveProjectCover,
  saveBackground,
  publicProject,
  copyToOutput,
  getUpload,
  uploadPath,
  saveUploadAnalysis,
  projectDir,
  ensureProjectDir,
} from './store.js'
import { newId, sleep, truncate } from './util.js'

export class JobManager {
  constructor(log) {
    this.jobs = new Map()
    this.log = log || (() => {})
    this.counter = 0
  }

  create(kind, meta = {}) {
    const id = newId('j')
    const job = {
      id,
      kind,
      status: 'queued',
      step: '排队中',
      message: '等待开始',
      progress: 0,
      total: meta.total || 1,
      current: 0,
      results: [],
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cancelled: false,
      abort: new AbortController(),
      meta,
    }
    this.jobs.set(id, job)
    this.prune()
    return job
  }

  get(id) {
    const job = this.jobs.get(id)
    if (!job) return null
    const { abort, ...rest } = job
    return rest
  }

  update(id, patch) {
    const job = this.jobs.get(id)
    if (!job) return
    Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  }

  cancel(id) {
    const job = this.jobs.get(id)
    if (!job) return false
    job.cancelled = true
    job.status = 'cancelled'
    job.step = '已取消'
    job.message = '任务已取消'
    try { job.abort.abort() } catch {}
    return true
  }

  prune() {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.status !== 'queued' && new Date(job.updatedAt).getTime() < cutoff) {
        this.jobs.delete(id)
      }
    }
  }

  async run(id, fn) {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = 'running'
    job.step = '准备中'
    job.message = ''
    job.updatedAt = new Date().toISOString()
    try {
      const results = await fn({
        signal: job.abort.signal,
        progress: (patch) => this.update(id, patch),
      })
      if (job.cancelled) return
      job.status = 'done'
      job.step = '完成'
      job.progress = 100
      job.message = `已完成 ${results?.length || 0} 张`
      job.results = results || []
      job.updatedAt = new Date().toISOString()
    } catch (err) {
      if (job.cancelled || err?.name === 'AbortError') {
        job.status = 'cancelled'
        job.step = '已取消'
        job.message = '任务已取消'
        return
      }
      job.status = 'error'
      job.step = '失败'
      job.error = truncate(String(err?.message || err), 1600)
      job.message = job.error
      this.log(`[job ${id}] failed: ${job.error}`)
    }
  }
}


async function ensureReferenceAnalyses({ references, llm, settings, log }) {
  const out = []
  for (let i = 0; i < references.length; i++) {
    const ref = references[i]
    const meta = getUpload(ref.id)
    if (!meta) continue
    let analysis = meta.analysis
    if (!analysis?.summary) {
      try {
        const file = uploadPath(meta)
        const buffer = fs.readFileSync(file)
        const result = await llm.analyzeReference({ buffer, name: meta.name, index: i })
        analysis = result.analysis
        saveUploadAnalysis(meta.id, analysis)
      } catch (err) {
        log(`[analyze] ${meta.name}: ${err?.message || err}`)
        analysis = { summary: '参考图（未能自动分析）' }
      }
    }
    out.push({ id: meta.id, name: meta.name, path: uploadPath(meta), analysis, url: meta.url })
  }
  return out
}

function pickBaseReference({ references, baseReferenceId }) {
  if (!references.length || !baseReferenceId) return null
  return references.find((r) => r.id === baseReferenceId) || null
}

// 旧版单张复刻卡没有标题框/字体等字段；第一次用它生成时自动视觉升级一次并写回设置。
async function upgradeLegacyReplicaStyles({ settings, llm, selectedStyles, log, progress }) {
  const ids = Array.isArray(selectedStyles) ? selectedStyles : []
  const styles = Array.isArray(settings.customStyles) ? settings.customStyles : []
  let changed = false
  let upgraded = 0
  for (const id of ids) {
    if (upgraded >= 3) break
    const style = styles.find((s) => s && s.id === id)
    if (!style) continue
    const refs = Array.isArray(style.references) ? style.references : []
    if (refs.length !== 1) continue
    const ready = style.replicaSource && style.replicaSource.layout && style.prompt && style.typography?.font
    if (ready) continue
    const meta = getUpload(refs[0])
    if (!meta) continue
    let buffer = null
    try { buffer = fs.readFileSync(uploadPath(meta)) } catch { continue }
    progress?.({ step: '升级复刻配方', message: `正在重新识别「${style.name || '复刻卡'}」的字体与版式…`, progress: 4 })
    try {
      const ratio = meta.width && meta.height ? `${meta.width}:${meta.height}` : '16:9'
      const result = await llm.learnReplica({ buffer, name: style.name || meta.name, ratio })
      const recipe = result.recipe || {}
      style.replica = true
      style.prompt = recipe.backgroundPrompt || style.prompt || style.directive || ''
      style.negativePrompt = recipe.negativePrompt || style.negativePrompt || ''
      style.typography = { ...(style.typography || {}), ...(recipe.typography || {}) }
      style.layout = recipe.layout || style.layout || null
      style.vertical = recipe.typography?.vertical === true
      style.layoutPool = recipe.layoutId ? [recipe.layoutId] : (style.layoutPool || [])
      style.replicaSource = {
        ...(style.replicaSource || {}),
        uploadId: refs[0],
        ...recipe,
        learnedAt: new Date().toISOString(),
      }
      changed = true
      upgraded++
      log(`[replica] 已自动升级旧风格卡：${style.name || id}`)
    } catch (err) {
      log(`[replica] 自动升级失败：${style.name || id}: ${err?.message || err}`)
    }
  }
  if (changed) {
    try { saveSettings(settings) } catch (err) { log(`[replica] 保存升级结果失败：${err?.message || err}`) }
  }
  return upgraded
}

function variantPrompt(variant, ratio, { baseMode = false, baseAnalysis = null, styleMode = false, styleInfo = null } = {}) {
  const styleGuide = styleInfo
    ? `Style/layout reference details: ${JSON.stringify({
        summary: styleInfo.summary || '',
        composition: styleInfo.composition || '',
        titlePlacement: styleInfo.titlePlacement || '',
        palette: styleInfo.palette || [],
        lighting: styleInfo.lighting || '',
        decorations: styleInfo.decorations || '',
      }).slice(0, 2400)}`
    : ''
  if (baseMode) {
    const preserve = Array.isArray(baseAnalysis?.preserve) && baseAnalysis.preserve.length
      ? ` Preserve exactly: ${baseAnalysis.preserve.join('; ')}.`
      : ''
    const subject = baseAnalysis?.subject ? ` The base subject is: ${baseAnalysis.subject}.` : ''
    const multiple = styleMode
      ? `\nThe provided images have distinct roles. Image 1 is the authoritative base subject to preserve. Image 2 is a style/layout reference from a different cover: use only its composition structure, title-space placement, palette, contrast and graphic treatment. Do NOT copy its people, scene, text or logos.`
      : ''
    return `Edit the provided base image. The base image is authoritative and must stay recognizable.${subject}${preserve}${multiple}
Keep the same subject identity, face, hair, outfit, pose, body proportions, composition and lighting. Do not invent a different character, do not replace the scene, and do not add new people. You may only: remove all existing text, logos, subtitles, credits and watermarks; clean the background; extend or reframe the scene for the target aspect ratio; adjust crop, exposure or color grade slightly to create title space and follow the style reference's title placement.
${styleGuide}
Additional art direction for this variant: ${variant.backgroundPrompt}
Target aspect ratio: ${ratioText(ratio)}. Never squash or stretch the base image. Do not add any text, letters, numbers, symbols or characters.`
  }
  if (styleMode) {
    return `The provided image is a STYLE AND LAYOUT REFERENCE, not the final scene. Create a brand-new cover background for the topic described below. Use the reference's composition structure, title placement and negative space, color palette, contrast, lighting and graphic treatment, but replace its subject with the new subject described in the art direction. Never copy its people, exact scene, text, logos or watermarks.
${styleGuide}
Art direction for this variant: ${variant.backgroundPrompt}
Target aspect ratio: ${ratioText(ratio)}. Recompose for this exact ratio; never squash or stretch anything. Leave clean negative space for a large Chinese title. No text, letters, numbers, symbols, logos or watermarks.`
  }
  return `${variant.backgroundPrompt}\n\nTarget aspect ratio: ${ratioText(ratio)}. Recompose or extend the scene for this exact aspect ratio; never squash or stretch the original. Keep official characters exactly as they are. Remove every existing text, logo, watermark, credit and subtitle. Do not add any new text, letters, numbers, symbols or characters.`
}

export async function runGeneration({
  ctx,
  settings,
  secrets,
  log,
  body,
  jobManager,
  jobId,
  signal,
  progress,
}) {
  const ratio = normalizeRatioId(body.ratio || settings.defaultRatio, settings.defaultRatio || '16:9')
  const count = Math.min(6, Math.max(1, Number.parseInt(body.count, 10) || 1))
  const selectedStyles = Array.isArray(body.styles) && body.styles.length ? body.styles : settings.defaultStyles
  const llm = new LlmClient({ ctx, settings, secrets, log })
  await upgradeLegacyReplicaStyles({ settings, llm, selectedStyles, log, progress })
  const references = await ensureReferenceAnalyses({
    references: (body.referenceIds || []).map((id) => ({ id })).filter((r) => r.id),
    llm,
    settings,
    log,
  })
  const relay = new RelayClient({ settings, secrets, log })
  const relayId = body.relayId || settings.defaultRelayId
  const model = body.model || settings.defaultModel
  const baseRef = pickBaseReference({ references, baseReferenceId: body.baseReferenceId })
  let baseAnalysis = baseRef?.analysis || null
  if (baseRef) {
    baseRef.isBase = true
    try {
      const meta = getUpload(baseRef.id)
      const buffer = meta ? fs.readFileSync(uploadPath(meta)) : null
      if (buffer) {
        const result = await llm.analyzeBaseImage({ buffer, name: baseRef.name, index: 0 })
        baseAnalysis = result.analysis
        baseRef.analysis = { ...(baseRef.analysis || {}), ...result.analysis }
        saveUploadAnalysis(baseRef.id, baseRef.analysis)
      }
    } catch (err) {
      log(`[base] 底图专项分析失败，沿用通用分析：${err?.message || err}`)
    }
  }
  const manualContext = body.manualContext && typeof body.manualContext === 'object'
    ? {
        ...body.manualContext,
        layers: Array.isArray(body.manualContext.layers) ? body.manualContext.layers.slice(0, 30) : [],
      }
    : null

  progress({ step: '规划版式', message: baseRef ? '正在读取底图并规划版式…' : `正在规划 ${count} 张不同版式…`, progress: 6, total: count })
  if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  const plan = await llm.plan({
    brief: body.brief || '',
    title: body.title || '',
    subtitle: body.subtitle || '',
    selectedStyles,
    count,
    ratio,
    references,
    customStyle: body.customStyle || '',
    documentText: body.documentText || '',
    baseReferenceId: baseRef?.id || '',
    baseAnalysis,
    manualContext,
  })
  let variants = Array.isArray(plan.variants) ? plan.variants.slice(0, count) : []
  const fallback = deterministicPlan({
    brief: body.brief || '', title: body.title || '', subtitle: body.subtitle || '',
    selectedStyles, count, ratio, references, customStyle: body.customStyle || '', settings,
    baseReferenceId: baseRef?.id || '', manualContext,
  })
  while (variants.length < count) variants.push(fallback.variants[variants.length])
  // 用户勾选的风格模板是硬约束：模型规划得再花，也不能换成没选的风格/版式。
  const assigned = chooseVariants(selectedStyles, count, settings)
  variants = variants.map((v, i) => {
    const pick = assigned[i % assigned.length]
    const baseVariant = fallback.variants[i] || fallback.variants[fallback.variants.length - 1] || {}
    const style = pick?.style || getStyle(pick?.styleId, settings)
    return {
      ...v,
      styleId: pick?.style?.id || v.styleId,
      styleName: pick?.style?.name || v.styleName,
      layoutId: pick?.layoutId || v.layoutId,
      vertical: baseVariant.vertical ?? v.vertical,
      titleColor: baseVariant.titleColor || v.titleColor || 'auto',
      layout: baseVariant.layout ? { ...baseVariant.layout } : v.layout,
      typography: { ...(v.typography || {}), ...(baseVariant.typography || {}) },
      palette: (pick?.style?.palette && pick.style.palette.length) ? pick.style.palette : v.palette,
      backgroundPrompt: [
        pick?.style?.prompt || '',
        v.backgroundPrompt || baseVariant.backgroundPrompt || '',
      ].filter(Boolean).join('\n'),
      negativePrompt: [pick?.style?.negativePrompt || '', v.negativePrompt || ''].filter(Boolean).join(', '),
    }
  })
  const requestedTitle = String(body.title || '').trim()
  const requestedSubtitle = String(body.subtitle || '').trim()
  // 用户没写的标题/副标题绝不补造；画面文字只按输入来。
  variants = variants.map((v) => ({ ...v, title: requestedTitle, subtitle: requestedSubtitle }))
  const results = []
  for (let i = 0; i < variants.length; i++) {
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const variant = variants[i]
    const style = getStyle(variant.styleId, settings)
    progress({
      step: `生成背景 ${i + 1}/${variants.length}`,
      message: `${style?.name || variant.styleId} · ${variant.layoutId}`,
      progress: 8 + Math.round((i / variants.length) * 58),
      current: i,
      total: variants.length,
    })
    let background = null
    let lastErr = null
    const baseBuffer = baseRef?.path && fs.existsSync(baseRef.path) ? fs.readFileSync(baseRef.path) : null
    let styleRefBuffer = null
    const styleRefId = style?.isReplica && Array.isArray(style.references) ? style.references[0] : ''
    if (styleRefId && (!baseRef || styleRefId !== baseRef.id)) {
      try {
        const styleMeta = getUpload(styleRefId)
        if (styleMeta) styleRefBuffer = fs.readFileSync(uploadPath(styleMeta))
      } catch (err) { log(`[style] 读取风格参考图失败：${err?.message || err}`) }
    }
    const referenceBuffers = [baseBuffer, styleRefBuffer].filter(Boolean)
    const styleInfo = style?.replicaSource || (style?.isReplica ? { summary: style.tagline, composition: style.description, palette: style.palette } : null)
    const preserveSelectedStyle = !!style?.isReplica
    const prompt = variantPrompt(variant, ratio, {
      baseMode: !!baseRef,
      baseAnalysis,
      styleMode: !!styleRefBuffer,
      styleInfo,
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const gen = await relay.generate({
          relayId,
          model,
          prompt,
          negativePrompt: variant.negativePrompt,
          referenceBuffer: referenceBuffers[0] || null,
          referenceBuffers,
          ratio,
          signal,
        })
        background = gen
        if (baseRef && baseBuffer) {
          try {
            const sim = await imageSimilarity(background.buffer, baseBuffer)
            log(`[base] 生成背景与原底图相似度 ${sim.toFixed(3)}${gen.multiFallback ? '（多图不支持，已退回单图）' : ''}`)
            if (sim < 0.8) {
              if (preserveSelectedStyle) {
                log('[base] 生成结果偏离底图，但已选择复刻风格；保留生成图以保持风格一致，避免退回带有原文字的底图')
              } else {
                log('[base] 生成结果偏离底图，自动改用原底图，保证人物/画面不被重画')
                background = { ...background, buffer: baseBuffer, model: (background.model || '') + '+base', via: 'base-fallback', fallback: true }
              }
            }
          } catch (err) {
            log(`[base] 相似度检查失败，保留生成图：${err?.message || err}`)
          }
        }
        break
      } catch (err) {
        lastErr = err
        log(`[gen] variant ${i + 1} attempt ${attempt + 1}: ${err?.message || err}`)
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        if (attempt === 0) await sleep(1200, signal)
      }
    }
    if (!background) {
      results.push({
        ok: false,
        variantId: variant.id,
        error: truncate(String(lastErr?.message || lastErr), 900),
        styleName: style?.name || variant.styleId,
      })
      continue
    }
    progress({
      step: `排版 ${i + 1}/${variants.length}`,
      message: '思源宋体排版中…',
      progress: 66 + Math.round((i / variants.length) * 24),
      current: i,
      total: variants.length,
    })
    const rendered = await renderCover({
      backgroundBuffer: background.buffer,
      variant,
      ratio,
      settings,
    })
    const project = createProject({
      title: requestedTitle || String(body.brief || '').trim().slice(0, 40) || '未命名封面',
      subtitle: requestedSubtitle,
      brief: body.brief || '',
      ratio,
      styleId: variant.styleId,
      styleName: style?.name || variant.styleId,
      layoutId: variant.layoutId,
      variant,
      layers: rendered.layers,
      relayId,
      relay: background.relay,
      model: background.model,
      via: background.fallback ? 'base-fallback' : (plan.via || 'model'),
      references: references.map((r) => r.id),
      baseReferenceId: baseRef?.id || '',
      notes: [variant.notes || '', background.fallback ? 'AI 生成画面偏离底图，已自动改用原底图，避免人物/场景被重画。' : ''].filter(Boolean).join('\n'),
    })
    const bgName = saveBackground(project.id, background.buffer, '.png')
    project.background = bgName
    try {
      const fit = await fitBackground(background.buffer, ratio)
      project.backgroundFit = saveBackground(project.id, fit, '.png', 'background_fit')
    } catch (err) { log(`[fit] ${err?.message || err}`) }
    saveProject(project)
    await saveProjectCover(project, rendered.buffer)
    let saved = null
    if (body.autoSave || settings.autoSave) {
      try { saved = copyToOutput(project, settings.outputDir) } catch (err) { log(`[save] ${err?.message || err}`) }
    }
    results.push({
      ok: true,
      project: publicProject(getProject(project.id)),
      saved,
      model: background.model,
      relay: background.relay,
      via: background.fallback ? 'base-fallback' : (plan.via || 'model'),
      baseFallback: !!background.fallback,
    })
  }
  progress({ step: '保存项目', message: '整理文件…', progress: 96, total: variants.length })
  const okCount = results.filter((r) => r.ok).length
  if (!okCount) {
    const firstErr = results.find((r) => r.error)?.error || '全部生成失败'
    throw new Error(firstErr)
  }
  return results
}

export async function createManualProject({ settings, title, ratio, upload }) {
  const r = normalizeRatioId(ratio || settings.defaultRatio)
  const buffer = upload?.id
    ? fs.readFileSync(uploadPath(upload))
    : blankBackground(r)
  const project = createProject({
    title: title || '手动创作',
    subtitle: '',
    brief: '',
    ratio: r,
    styleId: 'manual',
    styleName: '手动创作',
    layoutId: 'manual',
    variant: null,
    layers: [],
    manual: true,
  })
  try {
    const fit = await fitBackground(buffer, r)
    project.background = saveBackground(project.id, fit, '.png')
    project.backgroundFit = saveBackground(project.id, fit, '.png', 'background_fit')
    await saveProjectCover(project, fit)
  } catch {
    project.background = saveBackground(project.id, buffer, '.png')
    saveProject(project)
  }
  saveProject(project)
  return publicProject(getProject(project.id))
}

export async function regenerateProject({ ctx, settings, secrets, log, projectId, body }) {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const variant = project.variant || {}
  const relay = new RelayClient({ settings, secrets, log })
  const references = (body?.referenceIds || project.references || [])
    .map((id) => getUpload(id))
    .filter(Boolean)
  const baseRef = pickBaseReference({ references, baseReferenceId: body?.baseReferenceId || project.baseReferenceId })
  const refPath = baseRef ? uploadPath(baseRef) : ''
  const referenceBuffer = refPath && fs.existsSync(refPath) ? fs.readFileSync(refPath) : null
  const gen = await relay.generate({
    relayId: body?.relayId || project.relayId || settings.defaultRelayId,
    model: body?.model || project.model || settings.defaultModel,
    prompt: variantPrompt(variant, project.ratio, { baseMode: !!baseRef, baseAnalysis: baseRef?.analysis || null }),
    negativePrompt: variant.negativePrompt,
    referenceBuffer,
    ratio: project.ratio,
  })
  const rendered = await renderCover({
    backgroundBuffer: gen.buffer,
    variant,
    ratio: project.ratio,
    settings,
    layers: project.layers,
    backgroundRect: project.backgroundRect,
    backgroundFilter: project.backgroundFilter,
    backgroundVisible: project.backgroundVisible !== false,
  })
  project.background = saveBackground(project.id, gen.buffer, '.png')
  try {
    const fit = await fitBackground(gen.buffer, project.ratio)
    project.backgroundFit = saveBackground(project.id, fit, '.png', 'background_fit')
  } catch (err) { log(`[fit] ${err?.message || err}`) }
  project.relay = gen.relay
  project.relayId = gen.relayId
  project.model = gen.model
  project.layers = rendered.layers
  saveProject(project)
  await saveProjectCover(project, rendered.buffer)
  return publicProject(getProject(project.id))
}

export async function reframeProject({ settings, secrets, log, projectId, ratio, mode, preserve, signal, progress }) {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const targetRatio = normalizeRatioId(ratio || project.ratio, project.ratio || '16:9')
  if (targetRatio === normalizeRatioId(project.ratio, '16:9')) throw new Error('新比例和当前比例相同')
  const sourceName = project.manual ? (project.cover || '') : (project.background || project.cover || '')
  const sourcePath = sourceName ? path.join(projectDir(project.id), sourceName) : ''
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('项目缺少可用于改比例的图片')
  const sourceBuffer = fs.readFileSync(sourcePath)
  const aiMode = mode !== 'local'
  const preserveContent = preserve !== false
  const report = typeof progress === 'function' ? progress : () => {}
  report({ step: '准备原图', message: '读取原画面并计算新画幅…', progress: 8 })
  const local = await localReframeBuffer({ buffer: sourceBuffer, ratio: targetRatio })
  let finalBuffer = local.buffer
  let usedAI = false
  let aiFailed = false
  let preserveApplied = !aiMode
  let similarity = 0
  let aiRelay = ''
  let aiRelayId = ''
  let aiModel = ''

  if (aiMode) {
    const relay = new RelayClient({ settings, secrets, log })
    const prompt = `Edit the provided cover artwork. Keep every existing element exactly as it is: the same characters, faces, products, pose, scene, lighting, colors, texture and visual style. Do not redraw or replace the subject, do not remove anything, do not add new people or objects. Only extend/reframe the canvas to aspect ratio ${ratioText(targetRatio)}. Fill the newly added edges naturally with matching background; never squash or stretch the subject. Do not add any text, letters, numbers, logos or watermarks.`
    report({ step: 'AI 扩展画布', message: '正在请求中转站保持内容扩图…', progress: 24 })
    try {
      const timeout = AbortSignal.timeout(90000)
      const merged = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout
      const gen = await relay.generate({
        relayId: project.relayId || settings.defaultRelayId,
        model: project.model || settings.defaultModel,
        prompt,
        referenceBuffer: sourceBuffer,
        ratio: targetRatio,
        quality: 'high',
        signal: merged,
      })
      usedAI = true
      aiRelay = gen.relay || ''
      aiRelayId = gen.relayId || ''
      aiModel = gen.model || ''
      report({ step: '合成原图', message: preserveContent ? 'AI 扩图完成，正在把原画面叠回中心…' : 'AI 扩图完成，正在检查画面是否偏离…', progress: 66 })
      if (preserveContent) {
        const composed = await overlayOriginalOnReframe({ aiBuffer: gen.buffer, sourceBuffer, ratio: targetRatio })
        finalBuffer = composed.buffer
        preserveApplied = true
      } else {
        try { similarity = await imageSimilarity(gen.buffer, sourceBuffer) } catch {}
        log(`[reframe] 未保内容模式，AI 扩图与原图相似度 ${similarity.toFixed(3)}`)
        if (similarity < 0.62) {
          const composed = await overlayOriginalOnReframe({ aiBuffer: gen.buffer, sourceBuffer, ratio: targetRatio })
          finalBuffer = composed.buffer
          preserveApplied = true
          log('[reframe] AI 扩图偏离原图，已自动叠加原画面，避免内容丢失')
        } else {
          finalBuffer = gen.buffer
        }
      }
    } catch (err) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      aiFailed = true
      preserveApplied = true
      log(`[reframe] 中转站扩图失败，改用本地扩展：${err?.message || err}`)
      report({ step: '本地扩展', message: '中转站不可用，已自动改为本地扩展，原画面完整保留…', progress: 66 })
    }
  } else {
    report({ step: '本地扩展', message: '本地扩展画布，原画面完整保留…', progress: 50 })
  }

  report({ step: '重新排版', message: usedAI ? '思源宋体重新排版中…' : '整理本地扩展结果…', progress: 78 })
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  let rendered = null
  const sourceHasBakedText = !project.manual && sourceName === project.cover
  if (!project.manual && !sourceHasBakedText) {
    const variant = {
      ...(project.variant || {}),
      title: project.title || '',
      subtitle: project.subtitle || '',
      ratio: targetRatio,
      layout: null,
    }
    rendered = await renderCover({
      backgroundBuffer: finalBuffer,
      variant,
      ratio: targetRatio,
      settings,
    })
  }
  const modeLabel = !aiMode ? '本地扩展' : (aiFailed ? '本地扩展' : (preserveApplied ? 'AI 扩图 + 原图保真' : 'AI 扩图'))
  const next = createProject({
    title: (project.title || '未命名封面') + ' · ' + targetRatio,
    subtitle: '',
    brief: project.brief || '',
    ratio: targetRatio,
    manual: !!project.manual,
    styleId: project.styleId,
    styleName: (project.styleName || project.styleId || '') + ' · 比例重绘',
    layoutId: project.layoutId || 'reframe',
    variant: project.variant || null,
    layers: rendered ? rendered.layers : [],
    relayId: usedAI ? (aiRelayId || project.relayId || settings.defaultRelayId) : '',
    relay: usedAI ? aiRelay : '',
    model: usedAI ? (aiModel || project.model || settings.defaultModel) : 'local',
    via: !aiMode ? 'reframe-local' : (aiFailed ? 'reframe-local' : (preserveApplied ? 'reframe-preserve' : 'reframe-ai')),
    references: project.references || [],
    baseReferenceId: project.baseReferenceId || '',
    notes: [
      `基于已有封面保持内容重绘为 ${targetRatio}；原图保留，不是简单裁切。`,
      `处理方式：${modeLabel}。`,
      !aiMode ? '本地扩展：原画面未裁切、未拉伸，四周用同图模糊填充。' : (aiFailed ? '中转站失败，已自动用本地扩展兜底，内容未丢失。' : (preserveApplied ? '原画面已完整叠回中心，AI 只补全新画幅边缘。' : '')),
    ].filter(Boolean).join('\n'),
  })
  next.reframeOf = project.id
  next.reframeOriginalRatio = project.ratio || ''
  next.reframeOriginalTitle = project.title || ''
  next.reframePreserved = preserveApplied
  next.reframeMode = aiFailed ? 'local' : (aiMode ? 'ai' : 'local')
  next.reframeFallback = !!aiFailed
  next.reframeSimilarity = similarity
  next.reframeSource = { x: local.originalRect.x, y: local.originalRect.y, w: local.originalRect.w, h: local.originalRect.h }
  const originalCoverPath = project.cover ? path.join(projectDir(project.id), project.cover) : sourcePath
  if (originalCoverPath && fs.existsSync(originalCoverPath)) {
    try {
      const dir = ensureProjectDir(next.id)
      const name = 'reframe-original.png'
      fs.copyFileSync(originalCoverPath, path.join(dir, name))
      next.reframeOriginal = name
    } catch (err) { log(`[reframe] 复制原图失败：${err?.message || err}`) }
  }
  next.background = saveBackground(next.id, finalBuffer, '.png')
  try {
    const fit = await fitBackground(finalBuffer, targetRatio)
    next.backgroundFit = saveBackground(next.id, fit, '.png', 'background_fit')
  } catch (err) { log(`[reframe fit] ${err?.message || err}`) }
  saveProject(next)
  await saveProjectCover(next, rendered ? rendered.buffer : finalBuffer)
  report({ step: '完成', message: modeLabel + '完成', progress: 100 })
  return { project: publicProject(getProject(next.id)), aiFailed, preserveApplied, usedAI, mode: next.reframeMode }
}

export async function editProject({ ctx, settings, secrets, log, projectId, instruction }) {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const llm = new LlmClient({ ctx, settings, secrets, log })
  const result = await llm.editLayers({ project, instruction: String(instruction || '') })
  const llmLayers = Array.isArray(result.layers) && result.layers.length ? result.layers : project.layers
  const layers = project.manual
    ? [
        ...(project.layers || []).filter((l) => ['image', 'rect', 'ellipse', 'line', 'arrow', 'path'].includes(l.type)),
        ...llmLayers.filter((l) => l.type === 'text' || l.type === 'vertical-text'),
      ]
    : llmLayers
  const bgPath = project.background ? path.join(projectDir(project.id), project.background) : ''
  if (!bgPath || !fs.existsSync(bgPath)) throw new Error('项目缺少背景图，无法重新排版')
  const backgroundBuffer = fs.readFileSync(bgPath)
  const variant = { ...(project.variant || {}), title: result.title || project.title, subtitle: result.subtitle || project.subtitle }
  const rendered = await renderCover({
    backgroundBuffer,
    variant,
    ratio: project.ratio,
    settings,
    layers,
    backgroundRect: project.backgroundRect,
    backgroundFilter: project.backgroundFilter,
    backgroundVisible: project.backgroundVisible !== false,
  })
  project.title = result.title || project.title
  project.subtitle = result.subtitle || project.subtitle
  project.layers = rendered.layers
  project.variant = { ...(project.variant || {}), title: project.title, subtitle: project.subtitle }
  project.notes = result.notes || project.notes
  saveProject(project)
  await saveProjectCover(project, rendered.buffer)
  return { project: publicProject(getProject(project.id)), via: result.via, model: result.model }
}

export function exportProject(projectId, outputDir) {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  return copyToOutput(project, outputDir)
}
