import fs from 'node:fs'
import path from 'node:path'
import {
  DATA_DIR,
  LOGS_DIR,
  PLUGIN_ROOT,
  ensureDirs,
  truncate,
} from './lib/util.js'
import { Secrets, loadSettings, saveSettings } from './lib/settings.js'
import { createServer } from './lib/server.js'
import { JobManager, runGeneration, editProject } from './lib/generate.js'
import { LlmClient } from './lib/llm.js'
import { getUpload, uploadPath, listProjects, projectDir, saveUploadAnalysis, listUploads, saveUpload } from './lib/store.js'
import { allStyles, exclusiveProfile } from './lib/styles.js'
import { downloadVideoCover } from './lib/platforms.js'
import { harvestSection, harvestCreator, findReferenceImages } from './lib/harvest.js'
import { renderDirectionSketch } from './lib/inspire.js'

const ROUTE = '/dsh-cover-studio'
const SCRIPT_MARKER = 'dsh-cover-studio/client.js'
const LOADER_SCRIPT =
  '(function(){try{' +
  'if(window.__DSH_COVER_STUDIO_LOADER__)return;window.__DSH_COVER_STUDIO_LOADER__=true;' +
  'var d=document.body||document.head||document.documentElement;if(!d)return;' +
  `var s=document.createElement("script");s.src="/dsh-cover-studio/client.js";` +
  's.async=true;s.onerror=function(){};d.appendChild(s)' +
  '}catch(e){}})();'

const SYSTEM_SECTION = 'cover-studio:brief'
const ORDER_OFFSET = 60
const FALLBACK_ORDER = 10200 + ORDER_OFFSET
const openState = { at: 0 }

function makeLogger() {
  ensureDirs()
  const file = path.join(LOGS_DIR, 'plugin.log')
  const debugOn = process.env.COVER_STUDIO_DEBUG === '1' || process.env.COVER_STUDIO_DEBUG === 'true'
  return (message) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${String(message).replace(/\r?\n/g, ' ')}\n`)
    } catch {}
    if (debugOn) console.log(`[cover-studio] ${message}`)
  }
}

function resolveOrder(raw) {
  if (raw === null || raw === undefined || raw === '') return FALLBACK_ORDER
  const n = Number(raw)
  return Number.isFinite(n) ? n + ORDER_OFFSET : FALLBACK_ORDER
}

function promptText() {
  return [
    '【封面设计助手】',
    '- 用户要做视频封面/缩略图时，优先调用 cover_generate，而不是只用文字描述；一次可以生成 1-6 张不同版式。',
    '- 默认使用「专属风格」：官方原画、大号思源宋体标题、标题与人物层叠、无红色横线、无编号/集数/年份/英文小字。',
    '- 生成前先确认主标题和副标题；用户没给就保持空白，不要自动编造，需要时先问用户。同一批多张只用同一组标题，只变化版式。',
    '- 生成后把封面文件路径用 Markdown 图片展示；用户要改字、改大小、改位置时调用 cover_edit，不要重做整张。',
    '- 第一次生成报“没有 API Key”时，让用户打开工作室 → 设置 → 中转站 API，填 Base URL 和 Key 并点“测试连接”。',
    '- 用户想找参考图/下载视频封面时用 cover_download_cover 或 cover_find_images；想学习某个分区（动画/生活/科技/知识/游戏等）的高播放封面时用 cover_harvest_section，再 cover_learn_section。想抓某个 UP 主的封面时用 cover_harvest_creator。',
    '- 用户没思路时先用 cover_inspire 给 4 个构图方向，再让用户选；不要直接生成一堆随机封面。',
    '- 用户想复刻某一张参考封面时，引导到「风格库 → 分区风格库」，在那张图卡上点「复刻这张」；每张封面会单独生成带专用提示词的复刻卡，不要用整个分区的混合风格去近似。参考图库里的图片也可以直接点「复刻这张」。',
    '- 用户想把参考封面变成可编辑模板时，用参考图库卡片上的「拆成模板」：AI 识别文字/版式并生成无字背景，文字变成可编辑图层；模板编辑器顶部有「AI 重绘 / 换人物」，可修改反推提示词、选择人物参考图让 AI 重新生成同风格画面。',
    '- 插件通过输入框上方/右下角的「封面」浮动按钮打开可拖动工作室，不占侧栏。',
    '- 用户要保留原图内容换画幅时，引导用封面卡片或结果上的「保持内容改比例」：可选 AI 扩图或本地快速扩展，原图会保留并和新图并排展示；中转站失败会自动本地兜底。',
    '- 用户问制作人或反馈渠道：制作人是哔哩哔哩「明代宗」（UID 478925908），工作室「制作人」页可一键去 B 站关注；问题反馈直接打开飞书问题反馈表单填写问题和上传截图。制作人信息只读，不要在设置里改。',
    '- 手动创作在工作室「开始创作 → 手动创作」里；用户要做自由画布、导入字体/贴纸/特效时引导到那里。',
    '- 需要打开可视化工作室时调用 cover_studio_open；也可以让用户点输入框上方或页面右下角的「封面」按钮。',
    `- 插件源码在 ${PLUGIN_ROOT}；用户要求扩展/修改插件时，直接编辑源码并在 DSH 中重载插件。`,
  ].join('\n')
}

function localDefineTool(options) {
  const properties = {}
  const required = []
  const paramSpec = options.parameters || {}
  for (const [key, spec] of Object.entries(paramSpec)) {
    if (!spec || typeof spec !== 'object') continue
    const prop = { type: spec.type || 'string' }
    if (spec.description) prop.description = spec.description
    if (spec.enum) prop.enum = spec.enum
    if (spec.items && typeof spec.items === 'object') prop.items = { type: spec.items.type || 'string' }
    properties[key] = prop
    if (spec.required) required.push(key)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: options.output,
    ...options.timeoutMs ? { timeoutMs: options.timeoutMs } : {},
    execute: options.execute,
  }
}

async function loadDefineTool(ctx) {
  const candidates = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool', '@deepseek-ai/dsh-agent']
  for (const spec of candidates) {
    try {
      const mod = await import(spec)
      if (typeof mod?.defineTool === 'function') return mod.defineTool
    } catch {}
  }
  try {
    const svc = ctx?.get?.('tools')
    if (typeof svc?.defineTool === 'function') return svc.defineTool
  } catch {}
  return localDefineTool
}

function waitForJob(jobs, id, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const job = jobs.get(id)
      if (!job) {
        clearInterval(timer)
        resolve({ status: 'error', error: '任务不存在' })
        return
      }
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        clearInterval(timer)
        resolve(job)
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        resolve({ ...job, status: 'timeout', error: `任务还在运行（${id}），可打开封面设计助手查看进度。` })
      }
    }, 1500)
  })
}

function formatResults(results) {
  const lines = []
  for (const r of results || []) {
    if (!r.ok) {
      lines.push(`- 失败：${r.error || '未知错误'}`)
      continue
    }
    const p = r.project || {}
    const dir = p.id ? path.join(projectDir(p.id)) : ''
    const cover = p.cover && dir ? path.join(dir, p.cover) : ''
    lines.push(`- ${p.title || '封面'} · ${p.styleName || p.styleId || ''} · ${p.ratio || ''}`)
    if (cover) {
      const url = `${ROUTE}/files/projects/${p.id}/${p.cover}?v=${encodeURIComponent(p.updatedAt || '')}`
      lines.push(`  ![${p.title || '封面'}](${url})`)
      lines.push(`  本地文件：${cover}`)
    }
    if (r.saved?.png) lines.push(`  已复制到：${r.saved.png}`)
  }
  return lines.join('\n')
}

export function apply(ctx, config) {
  const log = makeLogger()
  if (config?.enabled === false) {
    log('disabled by config')
    return
  }
  ensureDirs()
  const secrets = new Secrets(ctx)
  const jobs = new JobManager(log)
  const server = createServer({
    ctx,
    secrets,
    jobs,
    log,
    getOpenState: () => openState,
    setOpenState: (v) => { openState.at = Number(v?.at || Date.now()) },
  })

  // 页面脚本注入：只推内联 loader，最坏情况只是按钮不出现，不影响应用启动。
  ctx.effect(() =>
    ctx.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        if (table.some((row) => row && row.kind === 'script' && typeof row.text === 'string' && row.text.includes(SCRIPT_MARKER))) return
        table.push({ kind: 'script', placement: 'body', text: LOADER_SCRIPT })
      } catch (err) {
        log(`index-inject failed: ${err?.message || err}`)
      }
    }),
  )

  // HTTP 路由：工作室 UI、文件、API
  ctx.inject(['webServer'], (webCtx) => {
    try {
      const dispose = webCtx.webServer.register({
        kind: 'prefix',
        path: '/dsh-cover-studio',
        handler: server.route,
      })
      ctx.effect(() => dispose)
      log('routes registered at /dsh-cover-studio')
    } catch (err) {
      log(`route register failed: ${err?.stack || err}`)
    }
  })

  // 系统提示词：让 DSH 的 agent 知道插件、默认风格和工具
  ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      let raw
      try { raw = promptCtx.systemPrompt.getSectionOrder?.('deployment:persona-prefix') } catch {}
      const order = resolveOrder(raw)
      const section = { name: SYSTEM_SECTION, order, text: () => promptText() }
      ctx.effect(() => promptCtx.systemPrompt.section(section))
      log(`system prompt section registered (order=${order})`)
    } catch (err) {
      log(`system prompt section failed: ${err?.message || err}`)
    }
  })

  // Agent 工具：让 DSH 的 agent 直接生成、修改、分析、打开工作室
  ctx.inject(['tools'], async (toolCtx) => {
    const defineTool = await loadDefineTool(toolCtx)
    const textOutput = (value) => ({ schema: { type: 'string' }, render: (_args, v) => [{ type: 'text', text: String(v) }] })

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_studio_open',
        description: '打开 DSH 里的「封面设计助手」可视化工作室（覆盖式窗口）。用户说“打开封面设计助手 / 打开工作室 / 我想拖图做封面”时调用。',
        parameters: {},
        output: textOutput('ok'),
        async execute() {
          openState.at = Date.now()
          return '已请求打开封面设计助手。若页面尚未显示，请让用户点输入框上方或页面右下角的「封面」按钮。'
        },
      })))
    } catch (err) { log(`register cover_studio_open failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_generate',
        description: '生成 1-6 张视频封面。支持 16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 3:2 / 5:4 / 2.35:1 / 21:9 以及自定义宽高（如 5:2）。默认使用专属风格：官方原画、大号思源宋体、标题与人物层叠、无红线、无小字。会调用中转站生图 + 本地排版，返回封面文件路径。',
        timeoutMs: 10 * 60 * 1000,
        parameters: {
          brief: { type: 'string', required: true, description: '视频主题/内容简介，越具体越好' },
          title: { type: 'string', description: '主标题；不填则由模型提出' },
          subtitle: { type: 'string', description: '副标题；不填则由模型提出' },
          styles: { type: 'array', items: { type: 'string' }, description: '风格 id，如 exclusive、vertical-serif、cinema-bottom；默认 exclusive' },
          count: { type: 'integer', description: '1-6，默认 3' },
          ratio: { type: 'string', description: '画幅：16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 3:2 / 5:4 / 2.35:1 / 21:9，或自定义 W:H（如 3:2、1080:1350）；留空跟随设置' },
          relayId: { type: 'string', description: '中转站 id，默认设置里的默认站' },
          model: { type: 'string', description: '生图模型 id，默认设置里的默认模型' },
          referenceIds: { type: 'array', items: { type: 'string' }, description: '已上传参考图的 id（可选）' },
          baseReferenceId: { type: 'string', description: '作为底图的参考图 id（可选）' },
          customStyle: { type: 'string', description: '自定义风格描述（可选）' },
          documentText: { type: 'string', description: '用户拖入文档后提取的正文（可选，最多 8000 字）' },
        },
        output: textOutput('ok'),
        async execute(args, exec) {
          const settings = loadSettings()
          const count = Math.min(6, Math.max(1, Number(args.count) || settings.defaultCount))
          const job = jobs.create('generate', { total: count })
          jobs.run(job.id, ({ signal, progress }) => runGeneration({
            ctx,
            settings,
            secrets,
            log,
            body: {
              brief: args.brief || '',
              title: args.title || '',
              subtitle: args.subtitle || '',
              styles: args.styles?.length ? args.styles : settings.defaultStyles,
              count,
              ratio: args.ratio || settings.defaultRatio || '16:9',
              relayId: args.relayId || settings.defaultRelayId,
              model: args.model || settings.defaultModel,
              referenceIds: args.referenceIds || [],
              baseReferenceId: args.baseReferenceId || '',
              customStyle: args.customStyle || '',
              documentText: args.documentText || '',
            },
            jobManager: jobs,
            jobId: job.id,
            signal,
            progress,
          }))
          const finished = await waitForJob(jobs, job.id, 9 * 60 * 1000)
          if (finished.status !== 'done') {
            return `生成没有完成：${finished.error || finished.status}。任务 id：${job.id}。可以调用 cover_studio_open 打开工作室查看。`
          }
          return `已生成 ${finished.results.filter((r) => r.ok).length} 张封面：\n${formatResults(finished.results)}`
        },
      })))
    } catch (err) { log(`register cover_generate failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_edit',
        description: '按自然语言修改已有封面：改文字、放大/缩小标题、移动位置、调整副标题、改颜色等。会重新排版并保存新版本。',
        timeoutMs: 5 * 60 * 1000,
        parameters: {
          projectId: { type: 'string', required: true, description: '项目 id（cover_generate 返回）' },
          instruction: { type: 'string', required: true, description: '修改要求，例如“主标题放大一点，副标题改成两行”' },
        },
        output: textOutput('ok'),
        async execute(args, exec) {
          const result = await editProject({
            ctx,
            settings: loadSettings(),
            secrets,
            log,
            projectId: args.projectId,
            instruction: args.instruction,
          })
          const p = result.project
          const cover = p?.id ? path.join(projectDir(p.id), p.cover) : ''
          const url = p?.id && p.cover ? `${ROUTE}/files/projects/${p.id}/${p.cover}?v=${encodeURIComponent(p.updatedAt || '')}` : ''
          return `已修改：${p?.title || ''}（${result.via || ''}）\n${cover}${url ? `\n![${p?.title || '封面'}](${url})` : ''}`
        },
      })))
    } catch (err) { log(`register cover_edit failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_list_projects',
        description: '列出已生成的封面项目和封面文件路径。',
        parameters: {},
        output: textOutput('ok'),
        async execute() {
          const projects = listProjects().slice(0, 30)
          if (!projects.length) return '还没有封面项目。'
          return projects.map((p) => {
            const cover = p.cover ? path.join(projectDir(p.id), p.cover) : ''
            return `- ${p.title} · ${p.styleName || p.styleId} · ${p.ratio} · ${p.updatedAt}\n  ${cover}`
          }).join('\n')
        },
      })))
    } catch (err) { log(`register cover_list_projects failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_analyze_reference',
        description: '分析本地参考封面的构图、标题位置、字体、配色和风格，返回 JSON。用户给了本地图片路径、想让你学习其风格时调用。',
        timeoutMs: 5 * 60 * 1000,
        parameters: {
          paths: { type: 'array', items: { type: 'string' }, required: true, description: '本地图片绝对路径，最多 6 张' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const llm = new LlmClient({ ctx, settings, secrets, log })
          const out = []
          for (const p of (args.paths || []).slice(0, 6)) {
            try {
              const buffer = fs.readFileSync(p)
              const result = await llm.analyzeReference({ buffer, name: path.basename(p), index: out.length })
              out.push({ path: p, analysis: result.analysis })
            } catch (err) {
              out.push({ path: p, error: String(err?.message || err) })
            }
          }
          return JSON.stringify(out, null, 2)
        },
      })))
    } catch (err) { log(`register cover_analyze_reference failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_download_cover',
        description: '从 B 站/YouTube/抖音/快手/小红书等视频链接下载封面到参考图库和指定目录。用户说“把这个视频封面存下来/找这张封面”时调用。',
        timeoutMs: 2 * 60 * 1000,
        parameters: {
          url: { type: 'string', required: true, description: '视频页面或分享链接' },
          dir: { type: 'string', description: '可选下载目录，留空用设置里的视频封面下载目录' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const got = await downloadVideoCover(args.url, { dir: args.dir || settings.coverDownloadDir, saveToLibrary: true })
          return `已下载：${got.title || ''}\n平台：${got.platform}${got.author ? ' · ' + got.author : ''}${got.views ? ' · ' + got.views + ' 播放' : ''}\n参考图 id：${got.upload?.id || ''}\n本地文件：${got.downloadPath || '（未设置下载目录）'}\n${got.upload?.url ? `![${got.title || '封面'}](${got.upload.url})` : ''}`
        },
      })))
    } catch (err) { log(`register cover_download_cover failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_find_images',
        description: '按用户的文字指引搜索并下载参考图片（Bing 图片，优先 B 站高点击封面兜底），加入参考图库。用户说“帮我找几张参考图/找官方视觉图”时调用。',
        timeoutMs: 3 * 60 * 1000,
        parameters: {
          query: { type: 'string', required: true, description: '要找的画面/人物/风格' },
          count: { type: 'integer', description: '1-8，默认 4' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const result = await findReferenceImages({ query: args.query, settings, count: Math.min(8, Math.max(1, Number(args.count) || 4)), log })
          return result.uploads.map((u) => `- ${u.title || u.name} · ${u.id}\n  ${u.url}`).join('\n') || '没有下载到图片'
        },
      })))
    } catch (err) { log(`register cover_find_images failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_harvest_section',
        description: '抓取某个分区（动画/生活/科技/知识/游戏/自定义）的高播放视频封面并保存为参考。用户说“学一下动画区的封面/抓 B 站高播放封面”时调用。',
        timeoutMs: 5 * 60 * 1000,
        parameters: {
          sectionId: { type: 'string', required: true, description: '分区 id 或名称，例如 animation / 动画区' },
          count: { type: 'integer', description: '抓取张数，默认 4' },
          page: { type: 'integer', description: '抓取批次，默认自动接着上次继续，跳过已有封面' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const section = (settings.sections || []).find((s) => s.id === args.sectionId || s.name === args.sectionId)
          if (!section) throw new Error('没有这个分区；先让用户在工作室内新增分区')
          const page = Math.max(1, Number(args.page) || Number(section.harvestCursor) || 1)
          const result = await harvestSection({ section, settings, count: Math.min(8, Math.max(1, Number(args.count) || 4)), page, log })
          section.harvestCursor = page + 1
          section.refs = [...result.refs, ...(section.refs || []).filter((r) => !result.refs.some((n) => n.uploadId === r.uploadId))].slice(0, 80)
          section.learned = null
          section.types = []
          saveSettings({ ...settings, sections: settings.sections })
          return `已抓取「${section.name}」${result.refs.length} 张高播放封面：\n` + result.refs.map((r) => `- ${r.title} · ${r.views} 播放 · ${r.uploadId}`).join('\n') + `\n下载目录：${result.dir || '（未设置）'}`
        },
      })))
    } catch (err) { log(`register cover_harvest_section failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_harvest_creator',
        description: '抓取指定 UP 主/博主的高播放视频封面并保存到某个分区参考库。用户说“抓一下某某 UP 主的封面”时调用。',
        timeoutMs: 6 * 60 * 1000,
        parameters: {
          sectionId: { type: 'string', required: true, description: '保存到哪个分区，例如 tech / 科技区' },
          creator: { type: 'string', required: true, description: 'UP 主名字（最稳）；也支持 mid 或空间链接，但空间接口可能被 B 站限流' },
          count: { type: 'integer', description: '抓取张数，默认 6' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const section = (settings.sections || []).find((s) => s.id === args.sectionId || s.name === args.sectionId)
          if (!section) throw new Error('没有这个分区；先让用户在工作室内新增分区')
          const result = await harvestCreator({
            section,
            settings,
            creator: String(args.creator || ''),
            count: Math.min(12, Math.max(1, Number(args.count) || 6)),
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
          saveSettings({ ...settings, sections: settings.sections })
          return `已抓取「${result.creator}」${result.refs.length} 张高播放封面：\n` + result.refs.map((r) => `- ${r.title} · ${r.views} 播放 · ${r.uploadId}`).join('\n') + `\n下载目录：${result.dir || '（未设置）'}`
        },
      })))
    } catch (err) { log(`register cover_harvest_creator failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_learn_section',
        description: '让 AI 识图分析某分区的参考封面，归纳成 1-4 种可复用的封面类型和风格约束。抓取封面后调用。',
        timeoutMs: 6 * 60 * 1000,
        parameters: {
          sectionId: { type: 'string', required: true, description: '分区 id 或名称' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const section = (settings.sections || []).find((s) => s.id === args.sectionId || s.name === args.sectionId)
          if (!section) throw new Error('没有这个分区')
          const llm = new LlmClient({ ctx, settings, secrets, log })
          const refs = []
          for (let i = 0; i < (section.refs || []).length && refs.length < 8; i++) {
            const ref = section.refs[i]
            const meta = getUpload(ref.uploadId)
            if (!meta) continue
            try {
              const buffer = fs.readFileSync(uploadPath(meta))
              const result = await llm.analyzeReference({ buffer, name: meta.name, index: i })
              saveUploadAnalysis(meta.id, result.analysis)
              refs.push({ uploadId: meta.id, upload: meta, title: ref.title, author: ref.author, views: ref.views, analysis: result.analysis })
            } catch (err) { log(`[agent learn] ${meta.name}: ${err?.message || err}`) }
          }
          if (!refs.length) throw new Error('参考图都无法分析，请重新抓取')
          const learned = await llm.learnSection({ section, references: refs })
          section.learned = learned.learned
          section.types = learned.learned.coverTypes || []
          saveSettings({ ...settings, sections: settings.sections })
          return `已学习「${section.name}」（${learned.via}）：\n${learned.learned.summary}\n\n封面类型：\n` + (section.types || []).map((t) => `- ${t.name}：${t.description}`).join('\n')
        },
      })))
    } catch (err) { log(`register cover_learn_section failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_inspire',
        description: '用户不知道做什么封面时，给 4 个不同的构图/视觉方向，并生成免费构图草图。选好方向后再调用 cover_generate。',
        timeoutMs: 3 * 60 * 1000,
        parameters: {
          brief: { type: 'string', description: '视频主题/简介' },
          title: { type: 'string', description: '主标题（可留空）' },
          subtitle: { type: 'string', description: '副标题（可留空）' },
          ratio: { type: 'string', description: '画幅，默认 16:9' },
        },
        output: textOutput('ok'),
        async execute(args) {
          const settings = loadSettings()
          const llm = new LlmClient({ ctx, settings, secrets, log })
          const result = await llm.inspire({ brief: args.brief || '', title: args.title || '', subtitle: args.subtitle || '', ratio: args.ratio || settings.defaultRatio || '16:9', styles: settings.defaultStyles, count: 4 })
          const lines = []
          for (let i = 0; i < result.directions.length; i++) {
            const d = result.directions[i]
            let sketch = null
            try {
              const img = await renderDirectionSketch({ direction: d, ratio: args.ratio || settings.defaultRatio || '16:9', settings })
              sketch = await saveUpload(img.buffer, { name: `灵感板_${d.name}.png`, mime: 'image/png', ext: '.png', platform: 'inspire', title: d.name, author: 'AI 灵感板' })
            } catch {}
            lines.push(`## ${d.name}\n标题：${d.title}\n副标题：${d.subtitle}\n构图：${d.composition}\n${sketch ? `![${d.name}](${sketch.url})` : ''}`)
          }
          return lines.join('\n\n')
        },
      })))
    } catch (err) { log(`register cover_inspire failed: ${err?.message || err}`) }

    try {
      toolCtx.effect(() => toolCtx.tools.register(defineTool({
        name: 'cover_get_style',
        description: '读取「专属风格」的设计 DNA、原则、字体参数和可用风格 id。',
        parameters: {},
        output: textOutput('ok'),
        async execute() {
          const settings = loadSettings()
          return JSON.stringify({
            exclusive: {
              name: exclusiveProfile()?.name,
              tagline: exclusiveProfile()?.tagline,
              summary: exclusiveProfile()?.summary,
              principles: exclusiveProfile()?.principles,
              typography: exclusiveProfile()?.typography,
              learned: settings.learned,
            },
            styles: allStyles(settings).map((s) => ({ id: s.id, name: s.name, tagline: s.tagline, layouts: s.layoutPool })),
          }, null, 2)
        },
      })))
    } catch (err) { log(`register cover_get_style failed: ${err?.message || err}`) }
  })

  log('cover studio applied')
}
