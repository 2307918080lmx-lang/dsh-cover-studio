import fs from 'node:fs'
import path from 'node:path'
import { renderCover, fitBackground, targetSize, imageSimilarity } from './render.js'
import { RATIO_PRESETS, normalizeRatioId } from './ratios.js'
import {
  createProject,
  getProject,
  getUpload,
  publicProject,
  projectDir,
  saveBackground,
  saveProject,
  saveProjectCover,
  uploadPath,
} from './store.js'

function gcd(a, b) {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) { const t = x % y; x = y; y = t }
  return x || 1
}

export function ratioForSize(width, height) {
  const w = Math.max(1, Number(width) || 16)
  const h = Math.max(1, Number(height) || 9)
  const aspect = w / h
  const hit = RATIO_PRESETS.find((r) => Math.abs(r.width / r.height - aspect) <= aspect * 0.018)
  if (hit) return hit.id
  const g = gcd(w, h)
  return normalizeRatioId(`${Math.round(w / g)}:${Math.round(h / g)}`, '16:9')
}

function textLayersFromTemplate(template, targetW, targetH) {
  const out = []
  for (let i = 0; i < (template.texts || []).length; i++) {
    const t = template.texts[i]
    const fontSize = Math.max(8, Math.round((Number(t.fontSize) || 0.08) * targetW))
    const vertical = t.vertical === true
    const x = Math.round((Number(t.x) || 0) * targetW)
    const y = Math.round((Number(t.y) || 0) * targetH)
    const w = Math.max(16, Math.round((Number(t.w) || 0.2) * targetW))
    const h = Math.max(16, Math.round((Number(t.h) || 0.08) * targetH))
    out.push({
      id: 'tpl-text-' + (i + 1),
      type: vertical ? 'vertical-text' : 'text',
      role: t.role === 'title' || t.role === 'subtitle' ? t.role : 'annotation',
      text: t.text,
      lines: vertical ? undefined : String(t.text).split('\n'),
      x, y, w, h,
      fontSize,
      fontFamily: t.font === 'sans' ? 'CoverSans' : 'CoverSerif',
      fontWeight: Math.max(300, Math.min(900, Number(t.weight) || 900)),
      color: t.color || '#F7F3EA',
      align: t.align || 'left',
      tracking: Math.round((Number(t.tracking) || 0.02) * fontSize * 100) / 100,
      lineHeight: Number(t.lineHeight) || 1.05,
      opacity: Number(t.opacity) || 1,
      angle: Number(t.rotation) || 0,
      vertical,
      columns: vertical ? [t.text] : null,
      maxLines: 4,
      stroke: t.stroke || '',
      strokeWidth: t.stroke ? Math.max(1, Math.round(fontSize * 0.018)) : 0,
      visible: true,
      locked: false,
    })
  }
  return out
}

async function renderTemplate(project, settings) {
  const bgPath = project.background ? path.join(projectDir(project.id), project.background) : ''
  if (!bgPath || !fs.existsSync(bgPath)) throw new Error('模板背景丢失，无法渲染')
  const rendered = await renderCover({
    backgroundBuffer: fs.readFileSync(bgPath),
    variant: { layoutId: 'manual', styleId: 'manual' },
    ratio: project.ratio,
    settings,
    layers: project.layers || [],
    plain: true,
  })
  project.layers = rendered.layers
  saveProject(project)
  await saveProjectCover(project, rendered.buffer)
  return rendered
}

export async function createTemplateProject({ settings, relay, llm, log = () => {}, uploadId }) {
  const meta = getUpload(uploadId)
  if (!meta) throw new Error('参考封面不存在了')
  if (!relay) throw new Error('需要中转站才能用 AI 拆模板')
  const buffer = fs.readFileSync(uploadPath(meta))
  const w = Number(meta.width) || 0
  const h = Number(meta.height) || 0
  const ratio = ratioForSize(w || 16, h || 9)
  const target = targetSize(ratio)
  const result = await llm.decomposeTemplate({ buffer, name: meta.title || meta.name || '参考封面', width: w, height: h })
  const template = result.template
  const cleanPrompt = `Edit the provided cover image. Remove ALL existing text, letters, numbers, subtitles, captions, logos, watermarks, UI labels and credits. Keep everything else exactly as it is: the same people, faces, poses, products, scene, composition, camera angle, lighting, color grade and texture. Fill the removed text areas naturally using the surrounding background. Do not move, crop, replace, redraw or add any subject. Do not add new text, letters, numbers, symbols, logos or watermarks.`
  const clean = await relay.generate({
    relayId: settings.defaultRelayId,
    model: settings.defaultModel,
    prompt: cleanPrompt,
    ratio,
    quality: 'high',
    referenceBuffer: buffer,
    signal: null,
  })
  const cleanBuffer = clean.buffer
  if (!cleanBuffer || !cleanBuffer.length) throw new Error('AI 清字没有返回图片')
  try {
    const sim = await imageSimilarity(cleanBuffer, buffer)
    log(`[template] AI 清字与原图相似度 ${sim.toFixed(3)}`)
    if (sim < 0.42) throw new Error(`AI 清字结果偏离原图太多（相似度 ${sim.toFixed(2)}），请换一个支持图片编辑的中转站重试`)
  } catch (err) {
    if (/偏离原图太多/.test(err.message)) throw err
    log(`[template] 清字相似度检查失败：${err?.message || err}`)
  }
  const layers = textLayersFromTemplate(template, target.width, target.height)
  const project = createProject({
    title: String(template.summary || meta.title || meta.name || '参考模板').slice(0, 50),
    subtitle: '',
    brief: template.styleSummary || '',
    ratio,
    manual: true,
    styleId: 'manual',
    styleName: 'AI 参考模板',
    layoutId: 'template',
    variant: null,
    layers,
    references: [meta.id],
    relayId: clean.relayId || settings.defaultRelayId,
    relay: clean.relay || '',
    model: clean.model || '',
    via: 'template-ai',
    notes: 'AI 已识别原封面的文字/版式并清掉原文字，生成了可编辑模板；文字可改，可在模板编辑器里用「AI 重绘」换画面或人物。',
  })
  project.templateFromUpload = meta.id
  project.templateTexts = template.texts || []
  project.templateSubjectRect = template.subjectBox || null
  project.templateSubjectDescription = template.subjectDescription || ''
  project.templateStyleSummary = template.styleSummary || ''
  project.templatePrompt = template.backgroundPrompt || ''
  project.templateNegativePrompt = template.negativePrompt || ''
  project.templateCleanModel = clean.model || ''
  project.background = saveBackground(project.id, cleanBuffer, '.png')
  try {
    const fit = await fitBackground(cleanBuffer, ratio)
    project.backgroundFit = saveBackground(project.id, fit, '.png', 'background_fit')
  } catch (err) { log(`[template fit] ${err?.message || err}`) }
  saveProject(project)
  await renderTemplate(project, settings)
  return { project: publicProject(getProject(project.id)), template, via: result.via, model: result.model }
}

export async function remixTemplateProject({
  settings,
  secrets,
  relay,
  log = () => {},
  projectId,
  prompt,
  subjectDescription,
  subjectUploadId,
}) {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  if (!project.templateFromUpload) throw new Error('这张不是参考模板项目')
  if (!relay) throw new Error('需要中转站才能 AI 重绘模板')
  const bgPath = project.background ? path.join(projectDir(project.id), project.background) : ''
  if (!bgPath || !fs.existsSync(bgPath)) throw new Error('模板背景丢失，无法重绘')
  const base = fs.readFileSync(bgPath)
  let subjectBuffer = null
  if (subjectUploadId) {
    const subjectMeta = getUpload(subjectUploadId)
    if (subjectMeta) {
      try { subjectBuffer = fs.readFileSync(uploadPath(subjectMeta)) } catch {}
    }
  }
  const styleText = [
    project.templateStyleSummary || '',
    project.templatePrompt || '',
  ].filter(Boolean).join('\n').slice(0, 5000)
  const extra = String(prompt || '').trim().slice(0, 3000)
  const subjectText = String(subjectDescription || '').trim().slice(0, 500)
  const finalPrompt = `Recreate the cover background as a NEW artwork. Keep the same layout logic, title placement, negative space, palette, contrast, lighting and graphic treatment as the reference. ${styleText ? `Style reference details:\n${styleText}\n` : ''}${extra ? `User direction:\n${extra}\n` : ''}${subjectText ? `Replace the main subject with: ${subjectText}.\n` : ''}${subjectBuffer ? 'Image 1 is the layout/scene reference. Image 2 is the new subject reference: replace the original subject with the subject from image 2, matching the pose scale and integrating it naturally into the scene.\n' : ''}Do not copy any existing text, letters, numbers, logos or watermarks. Do not add any new text. Keep a large clean negative space for a Chinese title.`
  const refs = [base, subjectBuffer].filter(Boolean)
  const gen = await relay.generate({
    relayId: project.relayId || settings.defaultRelayId,
    model: project.model || settings.defaultModel,
    prompt: finalPrompt,
    negativePrompt: project.templateNegativePrompt || 'text, letters, numbers, logos, watermark, subtitles, collage, split screen',
    ratio: project.ratio,
    quality: 'high',
    referenceBuffer: refs[0],
    referenceBuffers: refs,
    signal: null,
  })
  const next = createProject({
    title: String(project.title || '参考模板').slice(0, 45) + ' · AI重绘',
    subtitle: '',
    brief: project.brief || '',
    ratio: project.ratio,
    manual: true,
    styleId: 'manual',
    styleName: 'AI 重绘模板',
    layoutId: 'template',
    variant: null,
    layers: (project.layers || []).filter((l) => l.role !== 'template-subject' && l.cdaRole !== 'template-subject' && !(l.type === 'image' && (l.cutout || l.cutoutBackground))),
    references: project.references || [],
    relayId: gen.relayId,
    relay: gen.relay,
    model: gen.model,
    via: 'template-remix',
    notes: '基于参考模板的 AI 重绘；文字图层沿用原模板，可继续编辑。',
  })
  next.templateFromUpload = project.templateFromUpload
  next.templateTexts = project.templateTexts || []
  next.templateSubjectRect = project.templateSubjectRect || null
  next.templateSubjectDescription = subjectText || project.templateSubjectDescription || ''
  next.templateStyleSummary = project.templateStyleSummary || ''
  next.templatePrompt = project.templatePrompt || ''
  next.templateNegativePrompt = project.templateNegativePrompt || ''
  next.templateRemixFrom = project.id
  next.templateRemixPrompt = extra
  next.background = saveBackground(next.id, gen.buffer, '.png')
  try {
    const fit = await fitBackground(gen.buffer, project.ratio)
    next.backgroundFit = saveBackground(next.id, fit, '.png', 'background_fit')
  } catch (err) { log(`[template remix fit] ${err?.message || err}`) }
  saveProject(next)
  await renderTemplate(next, settings)
  return { project: publicProject(getProject(next.id)), via: 'template-remix', model: gen.model, relay: gen.relay }
}
