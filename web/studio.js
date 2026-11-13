/* global fabric */
(function () {
  'use strict'
  if (window.__COVER_STUDIO_STUDIO__) {
    if (window.__COVER_STUDIO_MOUNT__) window.__COVER_STUDIO_MOUNT__()
    return
  }
  window.__COVER_STUDIO_STUDIO__ = true

  var API = '/dsh-cover-studio'
  var state = {
    overlay: null,
    windowEl: null,
    mainEl: null,
    navEl: null,
    footEl: null,
    loaded: false,
    loading: false,
    tab: 'create',
    createMode: 'ai',
    settings: null,
    fonts: [],
    inspire: null,
    inspireBusy: false,
    downloadUrl: '',
    downloadDir: '',
    downloadAnalyze: false,
    referenceBusy: false,
    installedFonts: {},
    sectionBusy: {},
    sectionOpen: {},
    sectionSel: {},
    replicaBusy: {},
    projectSelectMode: false,
    projectSel: [],
    uploadSelectMode: false,
    uploadSel: [],
    assetSearch: null,
    manual: { uploadId: '', upload: null, title: '', ratio: '16:9', assets: [], busy: false },
    styles: [],
    exclusive: null,
    projects: [],
    uploads: [],
    models: null,
    results: [],
    job: null,
    jobTimer: null,
    form: {
      brief: '',
      title: '',
      subtitle: '',
      styles: ['exclusive'],
      lastStyleId: 'exclusive',
      count: 3,
      ratio: '16:9',
      relayId: '',
      model: '',
      customStyle: '',
      referenceIds: [],
      baseReferenceId: '',
      documents: [],
      manualContext: null,
      handoffPreviewId: '',
      handoffSource: '',
      handoffRefIds: [],
    },
    uploadBusy: false,
    settingsDraft: null,
    relayDraft: null,
    editor: null,
    appearance: loadAppearance(),
    onClose: null,
    keyHandler: null,
    toastEl: null,
    toastTimer: null,
    refreshedAt: 0,
    version: '',
    repoUrl: 'https://github.com/2307918080lmx-lang/dsh-cover-studio',
    updateToken: '',
    update: null,
    updateBusy: false,
    updateCheckedAt: 0,
    updateNotified: false,
    errors: [],
    creatorRefreshedAt: 0,
  }

  function pushClientError(message) {
    try {
      var text = String(message || '').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').replace(/Bearer\s+[^\s]+/gi, 'Bearer ***').slice(0, 500)
      if (!text) return
      state.errors = (state.errors || []).concat([{ at: new Date().toISOString(), text: text }]).slice(-6)
    } catch {}
  }

  window.addEventListener('error', function (e) {
    pushClientError((e && (e.message || (e.error && e.error.message))) || '未知脚本错误')
  })
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason
    pushClientError((r && (r.message || r)) || '未处理的异步错误')
  })

  function defaultAppearance() {
    return { theme: 'guizang', accent: '#002FA7', scheme: 'light', radius: 2 }
  }

  function loadAppearance() {
    var base = defaultAppearance()
    try {
      var saved = JSON.parse(localStorage.getItem('cds-appearance') || 'null')
      if (saved && typeof saved === 'object') {
        if (['guizang', 'film', 'dsh', 'cream', 'midnight', 'mono'].includes(saved.theme)) base.theme = saved.theme
        if (/^#[0-9a-f]{6}$/i.test(saved.accent || '')) base.accent = saved.accent
        if (saved.scheme === 'dark' || saved.scheme === 'light') base.scheme = saved.scheme
        if (Number.isFinite(Number(saved.radius))) base.radius = Math.max(0, Math.min(16, Number(saved.radius)))
      }
    } catch {}
    return base
  }

  function contrastOn(hex) {
    var c = String(hex || '#002FA7').replace('#', '')
    if (c.length !== 6) return '#FFFFFF'
    var r = parseInt(c.slice(0, 2), 16) / 255
    var g = parseInt(c.slice(2, 4), 16) / 255
    var b = parseInt(c.slice(4, 6), 16) / 255
    var lin = function (v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    var lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    var white = 1.05 / (lum + 0.05)
    var black = (lum + 0.05) / 0.05
    return white >= black ? '#FFFFFF' : '#0A0A0A'
  }

  function applyAppearance() {
    var a = state.appearance || defaultAppearance()
    var overlay = state.overlay
    if (!overlay) return
    overlay.setAttribute('data-cds-theme', a.theme)
    if (a.theme === 'dsh') overlay.removeAttribute('data-cds-scheme')
    else overlay.setAttribute('data-cds-scheme', a.theme === 'film' || a.theme === 'midnight' ? 'dark' : a.scheme)
    overlay.style.setProperty('--cds-accent', a.accent)
    overlay.style.setProperty('--cds-accent-contrast', contrastOn(a.accent))
    overlay.style.setProperty('--cds-radius', a.radius + 'px')
    overlay.style.setProperty('--dsw-alias-brand-primary', a.accent)
  }

  function updateAppearance(patch, rerender) {
    state.appearance = Object.assign({}, state.appearance || defaultAppearance(), patch || {})
    try { localStorage.setItem('cds-appearance', JSON.stringify(state.appearance)) } catch {}
    applyAppearance()
    if (rerender) renderSettingsPage()
  }

  var IMAGE_PROVIDERS = [
    {
      id: 'openai', name: 'OpenAI 官方', note: '官方 Images API',
      baseUrl: 'https://api.openai.com/v1', models: ['gpt-image-1', 'gpt-image-1-mini'], defaultModel: 'gpt-image-1',
      size169: '1536x1024', size43: '1536x1152', size916: '1024x1536', size11: '1024x1024',
      keyUrl: 'https://platform.openai.com/api-keys',
      docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
    },
    {
      id: 'siliconflow', name: '硅基流动', note: '开源图片模型',
      baseUrl: 'https://api.siliconflow.cn/v1', models: ['Kwai-Kolors/Kolors', 'black-forest-labs/FLUX.1-schnell'], defaultModel: 'Kwai-Kolors/Kolors',
      size169: '1280x720', size43: '1024x768', size916: '720x1280', size11: '1024x1024',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      docsUrl: 'https://docs.siliconflow.cn/userguide/capabilities/images',
    },
    {
      id: '302ai', name: '302.AI', note: 'OpenAI 兼容聚合',
      baseUrl: 'https://api.302.ai/v1', models: ['gpt-image-1', 'gpt-image-1-mini'], defaultModel: 'gpt-image-1',
      size169: '1536x1024', size43: '1536x1152', size916: '1024x1536', size11: '1024x1024',
      keyUrl: 'https://dash.302.ai/apis/list',
      docsUrl: 'https://doc.302.ai/',
    },
  ]

  function providerForRelay(relay) {
    if (!relay) return null
    return IMAGE_PROVIDERS.find(function (p) { return p.baseUrl && p.baseUrl === String(relay.baseUrl || '').replace(/\/+$/, '') }) || null
  }

  var RATIOS = [
    { id: '16:9', label: '16:9 横屏', width: 1920, height: 1080 },
    { id: '9:16', label: '9:16 竖屏', width: 1080, height: 1920 },
    { id: '4:3', label: '4:3 横屏', width: 1536, height: 1152 },
    { id: '3:4', label: '3:4 竖屏', width: 1080, height: 1440 },
    { id: '1:1', label: '1:1 方形', width: 1080, height: 1080 },
    { id: '3:2', label: '3:2 横屏', width: 1620, height: 1080 },
    { id: '5:4', label: '5:4 横屏', width: 1350, height: 1080 },
    { id: '2.35:1', label: '2.35:1 电影', width: 1920, height: 817 },
    { id: '21:9', label: '21:9 宽银幕', width: 2560, height: 1080 },
  ]

  function clientRatio(value) {
    var raw = String(value || '16:9').trim().replace(/[：×xX]/g, ':').replace(/\s+/g, '')
    var preset = RATIOS.find(function (r) { return r.id === raw })
    if (preset) return preset
    var m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(raw)
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) {
      return { id: raw, label: raw + ' 自定义', width: Number(m[1]), height: Number(m[2]), custom: true }
    }
    return RATIOS[0]
  }

  function targetSize(ratio) {
    var r = clientRatio(ratio)
    if (!r.custom) return { w: r.width, h: r.height }
    var a = r.width / r.height
    if (a >= 1) return { w: 1920, h: Math.max(360, Math.round(1920 / a)) }
    return { w: Math.max(360, Math.round(1920 * a)), h: 1920 }
  }

  function ratioCss(ratio) {
    var size = targetSize(ratio)
    return size.w + ' / ' + size.h
  }

  function ratioPicker(value, onChange) {
    var info = clientRatio(value)
    var customShown = !!info.custom
    var wrap = el('div', { className: 'cds-ratio-picker' })
    var customBox = el('div', { className: 'cds-ratio-custom' })
    var select = el('select', { className: 'cds-select cds-ratio-select', onchange: function (e) {
      if (e.target.value === 'custom') {
        customShown = true
        renderCustom()
        return
      }
      customShown = false
      clear(customBox)
      onChange(e.target.value)
    } }, RATIOS.map(function (r) { return el('option', { value: r.id, selected: r.id === info.id }, [el('span', { text: r.label })]) }).concat([
      el('option', { value: 'custom', selected: customShown }, [el('span', { text: '自定义比例…' })]),
    ]))
    function renderCustom() {
      clear(customBox)
      if (!customShown) return
      var w = el('input', { className: 'cds-input', type: 'number', min: '200', max: '5000', value: Math.round(info.width || 1080), placeholder: '宽' })
      var h = el('input', { className: 'cds-input', type: 'number', min: '200', max: '5000', value: Math.round(info.height || 1080), placeholder: '高' })
      customBox.appendChild(el('div', { className: 'cds-ratio-customrow' }, [
        w, el('span', { className: 'cds-hint', text: '×' }), h,
        el('button', { className: 'cds-btn sm', onclick: function () {
          var cw = Math.max(200, Math.min(5000, Math.round(Number(w.value) || 0)))
          var ch = Math.max(200, Math.min(5000, Math.round(Number(h.value) || 0)))
          if (!cw || !ch) { toast('宽高都要大于 200'); return }
          onChange(cw + ':' + ch)
        } }, [el('span', { text: '应用' })]),
      ]))
    }
    wrap.appendChild(select)
    wrap.appendChild(customBox)
    renderCustom()
    return wrap
  }

  var I = {
    spark: '<svg viewBox="0 0 24 24" fill="none"><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" fill="currentColor"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="8.5" cy="9" r="1.6" stroke="currentColor" stroke-width="1.4"/><path d="m5 18 4.5-5 3 3.2L17 11l2 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none"><path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M19 12c0-.5 0-1-.1-1.4l2-1.5-2-3.4-2.4 1c-.7-.5-1.4-1-2.2-1.2L14 3h-4l-.3 2.5c-.8.3-1.5.7-2.2 1.2l-2.4-1-2 3.4 2 1.5c-.1.5-.1.9-.1 1.4s0 1 .1 1.4l-2 1.5 2 3.4 2.4-1c.7.5 1.4.9 2.2 1.2L10 21h4l.3-2.5c.8-.3 1.5-.7 2.2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 20 4.2-1 10.3-10.3a2 2 0 0 0 0-2.8l-.4-.4a2 2 0 0 0-2.8 0L5 15.8 4 20Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="1.6"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v11M7.5 10 12 14.5 16.5 10M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none"><path d="m14 6-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 7 4 12l5 5M4 12h8a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none"><path d="m15 7 5 5-5 5M20 12h-8a6 6 0 0 0-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 6V4h14v2M12 4v16M8 20h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    square: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/></svg>',
    circle: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7"/></svg>',
    line: '<svg viewBox="0 0 24 24" fill="none"><path d="m5 19 14-14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20 20 4M12 4h8v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 20 4.2-1 10.3-10.3a2 2 0 0 0 0-2.8l-.4-.4a2 2 0 0 0-2.8 0L5 15.8 4 20Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    marker: '<svg viewBox="0 0 24 24" fill="none"><path d="m5 19 2.5-6.5L16 4l4 4-8.5 8.5L5 19Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m13 7 4 4" stroke="currentColor" stroke-width="1.6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none"><path d="m6 14 6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none"><path d="m6 10 6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none"><path d="M14 4h6v6M20 4l-9 9M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 4h11l3 3v13H5V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 4v6h8V4M8 20v-6h8v6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    maximize: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M9 9h6v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="7" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2" stroke="currentColor" stroke-width="1.6"/></svg>',
    wand: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 20 10.5-10.5M13 5.5l1.2 3.3L17.5 10l-3.3 1.2L13 14.5l-1.2-3.3L8.5 10l3.3-1.2L13 5.5ZM19 3.5l.7 1.8L21.5 6l-1.8.7L19 8.5l-.7-1.8L16.5 6l1.8-.7L19 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    crop: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 3v13a2 2 0 0 0 2 2h13M3 6h13a2 2 0 0 1 2 2v13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" stroke-width="1.6"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V8a4 4 0 0 1 7.5-2" stroke="currentColor" stroke-width="1.6"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.2 6.7A17 17 0 0 0 2.5 12S6 18 12 18c1 0 2-.2 2.9-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    sticker: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 1 1-8-8h3l5 5v3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 4v5a3 3 0 0 0 3 3h5M8 14h.01M14 14h.01M9 17c1.5 1 4.5 1 6 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    template: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 9h10M7 13h7M7 17h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    flipH: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M9 7 4 12l5 5M15 7l5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flipV: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18M7 9l5-5 5 5M7 15l5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    align: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20c.7-3.6 3.7-5.5 7.5-5.5s6.8 1.9 7.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    feedback: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  }

  // 制作人信息只读：后端是唯一数据源，界面不提供修改入口，也不写入 settings。
  var CREATOR = {
    name: '明代宗',
    uid: '478925908',
    platform: '哔哩哔哩',
    spaceUrl: 'https://space.bilibili.com/478925908',
    role: '封面设计助手 制作人',
    feedbackUrl: '',
    feishuUrl: 'https://acntudzm54fw.feishu.cn/share/base/shrcngkqSaRLSEYkQj4n07gGrDe',
    immutable: true,
  }

  function el(tag, props, children) {
    var node = document.createElement(tag)
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'text') { node.textContent = props[k]; return }
        if (k === 'html') { node.innerHTML = props[k]; return }
        if (k === 'style' && props[k] && typeof props[k] === 'object') {
          Object.keys(props[k]).forEach(function (sk) { node.style[sk] = props[k][sk] })
          return
        }
        var v = props[k]
        if (v === undefined || v === null || v === false) return
        if (k === 'className') node.className = v
        else if (k === 'value') node.value = v
        else if (k === 'checked') node.checked = !!v
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
        else node.setAttribute(k, v === true ? '' : String(v))
      })
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return
        if (typeof c === 'string') node.appendChild(document.createTextNode(c))
        else node.appendChild(c)
      })
    }
    return node
  }

  function icon(name) {
    var span = el('span', { style: { width: '16px', height: '16px', display: 'inline-flex', flex: '0 0 16px' } })
    span.innerHTML = I[name] || ''
    return span
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild) }

  function toast(message, ms) {
    if (!state.overlay) return
    if (!state.toastEl) {
      state.toastEl = el('div', { className: 'cds-toast', style: { position: 'absolute', left: '50%', bottom: '22px', transform: 'translateX(-50%)', zIndex: '9', maxWidth: '560px', padding: '9px 14px', borderRadius: '10px', background: 'var(--dsw-alias-bg-overlay, #fff)', border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))', boxShadow: '0 10px 30px rgba(0,0,0,.22)', fontSize: '12px', lineHeight: '1.5', color: 'var(--dsw-alias-label-primary, #1A1D22)' } })
      state.overlay.appendChild(state.toastEl)
    }
    state.toastEl.textContent = String(message || '')
    state.toastEl.style.display = 'block'
    clearTimeout(state.toastTimer)
    state.toastTimer = setTimeout(function () { if (state.toastEl) state.toastEl.style.display = 'none' }, ms || 4200)
  }

  function fmtDate(value) {
    try {
      var d = new Date(value)
      var p = function (n) { return String(n).padStart(2, '0') }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    } catch { return String(value || '') }
  }

  function fmtSize(n) {
    var v = Number(n) || 0
    if (v > 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'
    if (v > 1024) return Math.round(v / 1024) + ' KB'
    return v + ' B'
  }

  function pick(arr, n) { return Array.isArray(arr) ? arr.slice(0, n) : [] }

  async function api(path, opts) {
    var options = opts ? Object.assign({}, opts) : {}
    var headers = Object.assign({ accept: 'application/json' }, options.headers || {})
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers['content-type'] = 'application/json'
      options.body = JSON.stringify(options.body)
    }
    options.headers = headers
    var res = await fetch(API + path, options)
    var text = await res.text()
    var data
    try { data = text ? JSON.parse(text) : {} } catch { data = { ok: false, error: text } }
    if (!res.ok || data.ok === false) throw new Error((data && data.error) || ('HTTP ' + res.status))
    return data
  }

  function showLoading(text) {
    if (!state.mainEl) return
    clear(state.mainEl)
    state.mainEl.appendChild(el('div', { className: 'cds-loading' }, [el('span', { className: 'cds-spinner' }), el('span', { text: text || '加载中…' })]))
  }

  function showError(err) {
    if (!state.mainEl) return
    clear(state.mainEl)
    state.mainEl.appendChild(el('div', { className: 'cds-page' }, [
      el('div', { className: 'cds-pagehead' }, [
        el('div', {}, [el('h1', { text: '加载失败' }), el('p', { text: String(err && err.message || err) })]),
        el('div', { className: 'cds-spacer' }),
        el('button', { className: 'cds-btn', onclick: function () { loadState(true) } }, [icon('refresh'), el('span', { text: '重试' })]),
      ]),
      el('div', { className: 'cds-note', text: '请确认 DSH 的封面设计助手插件已启用，并检查 DSH 日志。' }),
    ]))
  }

  function confirmDialog(title, text, confirmText, danger) {
    return new Promise(function (resolve) {
      var modal = el('div', { className: 'cds-modal' })
      var close = function (v) { if (modal.parentNode) modal.parentNode.removeChild(modal); resolve(v) }
      var dlg = el('div', { className: 'cds-dialog' }, [
        el('h3', { text: title }),
        el('p', { text: text || '' }),
        el('div', { className: 'cds-dialogacts' }, [
          el('button', { className: 'cds-btn', onclick: function () { close(false) } }, [el('span', { text: '取消' })]),
          el('button', { className: 'cds-btn ' + (danger ? 'danger' : 'primary'), onclick: function () { close(true) } }, [el('span', { text: confirmText || '确定' })]),
        ]),
      ])
      modal.appendChild(dlg)
      state.windowEl.appendChild(modal)
    })
  }

  function promptDialog(title, label, placeholder, defaultValue) {
    return new Promise(function (resolve) {
      var modal = el('div', { className: 'cds-modal' })
      var input = el('input', { className: 'cds-input', placeholder: placeholder || '', value: defaultValue || '' })
      var close = function (v) { if (modal.parentNode) modal.parentNode.removeChild(modal); resolve(v) }
      var dlg = el('div', { className: 'cds-dialog' }, [
        el('h3', { text: title }),
        el('div', { className: 'cds-field', style: { marginTop: '12px' } }, [el('div', { className: 'cds-label', text: label || '' }), input]),
        el('div', { className: 'cds-dialogacts' }, [
          el('button', { className: 'cds-btn', onclick: function () { close(null) } }, [el('span', { text: '取消' })]),
          el('button', { className: 'cds-btn primary', onclick: function () { close(input.value.trim()) } }, [el('span', { text: '确定' })]),
        ]),
      ])
      modal.appendChild(dlg)
      state.windowEl.appendChild(modal)
      setTimeout(function () { input.focus() }, 30)
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') close(input.value.trim()) })
    })
  }

  function previewDialog(url, title) {
    if (!url) return
    var modal = el('div', { className: 'cds-modal cds-preview' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal); document.removeEventListener('keydown', onKey, true) }
    var header = el('div', { className: 'cds-previewbar' }, [
      el('div', { className: 'cds-previewtitle', text: title || '预览' }),
      el('span', { className: 'cds-spacer', style: { flex: 1 } }),
      el('a', { className: 'cds-btn sm', href: url, target: '_blank', rel: 'noreferrer', onclick: function (e) { e.stopPropagation() } }, [icon('external'), el('span', { text: '原图' })]),
      el('button', { className: 'cds-btn sm', onclick: close }, [el('span', { text: '关闭' })]),
    ])
    var img = el('img', { className: 'cds-previewimg', src: url, alt: title || '预览' })
    var body = el('div', { className: 'cds-previewbody' }, [img])
    modal.appendChild(header)
    modal.appendChild(body)
    header.addEventListener('click', function (e) { e.stopPropagation() })
    modal.addEventListener('click', close)
    body.addEventListener('click', function (e) { if (e.target === body) close() })
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    document.addEventListener('keydown', onKey, true)
    state.windowEl.appendChild(modal)
  }

  function applyFormDefaults() {
    if (!state.settings) return
    var f = state.form
    if (!f.relayId) f.relayId = state.settings.defaultRelayId
    var relay = state.settings.relays.find(function (r) { return r.id === f.relayId }) || state.settings.relays[0]
    if (!f.model) f.model = state.settings.defaultModel || (relay && relay.defaultModel) || ''
    var validStyles = new Set((state.styles || []).map(function (s) { return s.id }))
    f.styles = (f.styles || []).filter(function (id) { return validStyles.has(id) })
    if (!f.styles.length) f.styles = (state.settings.defaultStyles && state.settings.defaultStyles.length) ? state.settings.defaultStyles.slice() : ['exclusive']
    f.styles = f.styles.filter(function (id) { return validStyles.has(id) })
    if (!f.styles.length) f.styles = ['exclusive']
    if (!f.count) f.count = state.settings.defaultCount || 3
    if (!f.ratio) f.ratio = state.settings.defaultRatio || '16:9'
    var pinned = Array.isArray(f.handoffRefIds) ? f.handoffRefIds : []
    f.referenceIds = (f.referenceIds || []).filter(function (id) { return state.uploads.some(function (u) { return u.id === id }) || pinned.indexOf(id) >= 0 })
    if (f.baseReferenceId && !f.referenceIds.includes(f.baseReferenceId) && pinned.indexOf(f.baseReferenceId) < 0) f.baseReferenceId = ''
  }

  async function loadState(force) {
    if (state.loading) return
    state.loading = true
    try {
      var data = await api('/state.json')
      state.settings = data.settings
      state.styles = data.styles || []
      state.exclusive = data.exclusive || null
      state.projects = data.projects || []
      state.uploads = data.uploads || []
      state.models = data.models || null
      state.fonts = (data.settings && data.settings.customFonts) || []
      state.version = data.version || ''
      state.repoUrl = data.repoUrl || state.repoUrl
      state.updateToken = data.updateToken || state.updateToken
      if (data.creator && data.creator.name && data.creator.uid) {
        CREATOR = Object.freeze({ ...CREATOR, ...data.creator, immutable: true })
      }
      if (!state.downloadDir) state.downloadDir = (data.settings && data.settings.coverDownloadDir) || ''
      installCustomFonts(state.fonts)
      state.loaded = true
      state.refreshedAt = Date.now()
      if (!state.form.relayId || !state.settings.relays.some(function (r) { return r.id === state.form.relayId })) {
        state.form.relayId = state.settings.defaultRelayId
        state.form.model = state.settings.defaultModel
      } else if (state.lastRelayId !== state.form.relayId || state.lastDefaultModel !== state.settings.defaultModel) {
        var switched = state.settings.relays.find(function (r) { return r.id === state.form.relayId })
        var preferred = state.form.relayId === state.settings.defaultRelayId ? state.settings.defaultModel : ''
        state.form.model = preferred || (switched && (switched.defaultModel || (switched.models || [])[0])) || state.settings.defaultModel || state.form.model
      }
      state.lastRelayId = state.form.relayId
      state.lastDefaultModel = state.settings.defaultModel
      applyFormDefaults()
      if (!state.tab) state.tab = (state.settings.ui && state.settings.ui.lastTab) || 'create'
      if (!state.createMode) state.createMode = (state.settings.ui && state.settings.ui.createMode) || 'ai'
      renderNav()
      renderFoot()
      renderPage()
      if (!state.updateCheckedAt || Date.now() - state.updateCheckedAt > 30 * 60 * 1000) {
        setTimeout(function () { if (!state.updateBusy) checkUpdate(false) }, 900)
      }
      if (state.jobId && state.job && !state.jobTimer && (state.job.status === 'running' || state.job.status === 'queued')) pollJob(state.jobId)
    } catch (err) {
      state.loaded = false
      showError(err)
    } finally {
      state.loading = false
    }
  }

  function renderFoot() {
    if (!state.footEl || !state.settings) return
    clear(state.footEl)
    state.footEl.appendChild(el('div', { className: 'cds-navgroup', style: { padding: '0 2px 5px' }, text: 'STATUS / 状态' }))
    var mm = state.settings.mainModel || {}
    var dshOk = mm.mode !== 'custom' ? !!(mm.dshLlmAvailable || mm.dshKeyAvailable) : !!mm.customKeySet
    var relay = state.settings.relays.find(function (r) { return r.id === state.settings.defaultRelayId }) || state.settings.relays[0]
    state.footEl.appendChild(el('div', { className: 'cds-chip' }, [el('span', { className: 'cds-dot ' + (dshOk ? 'on' : 'warn') }), el('span', { text: (mm.mode === 'custom' ? (mm.customKeySet ? '自定义主模型' : '自定义主模型（未填 Key）') : 'DSH 主模型') + ' · ' + (mm.model || 'deepseek-flash') })]))
    state.footEl.appendChild(el('div', { className: 'cds-chip' }, [el('span', { className: 'cds-dot ' + (relay && relay.keySet ? 'on' : 'warn') }), el('span', { text: relay ? relay.name + (relay.keySet ? '' : ' · 未填 Key') : '未配置中转站' })]))
    state.footEl.appendChild(el('div', { className: 'cds-chip' }, [el('span', { className: 'cds-dot on' }), el('span', { text: '默认风格已加载' })]))
    var upd = state.update || {}
    var versionText = 'v' + (state.version || '1.3.1')
    if (state.updateBusy) versionText += ' · 检查中…'
    else if (upd.hasUpdate) versionText += ' → v' + upd.latestVersion
    else if (upd.ok) versionText += ' · 已是最新'
    else versionText += ' · 检查更新'
    state.footEl.appendChild(el('div', {
      className: 'cds-chip',
      style: { cursor: 'pointer' },
      title: upd.hasUpdate ? '发现新版本，点击更新' : '点击检查更新',
      onclick: function () { openUpdateDialog(!upd.hasUpdate) },
    }, [el('span', { className: 'cds-dot ' + (upd.hasUpdate ? 'warn' : (upd.ok ? 'on' : '')) }), el('span', { text: versionText })]))
    state.footEl.appendChild(el('div', { className: 'cds-chip', style: { cursor: 'pointer' }, title: '查看制作人信息', onclick: function () { switchTab('producer') } }, [el('span', { className: 'cds-dot on' }), el('span', { text: '制作人 ' + CREATOR.name })]))
  }

  async function checkUpdate(force) {
    if (state.updateBusy) return
    state.updateBusy = true
    if (force) state.update = null
    renderFoot()
    try {
      var data = await api('/update/check' + (force ? '?force=1' : ''))
      state.update = data
      state.updateCheckedAt = Date.now()
      if (data.hasUpdate && !state.updateNotified) {
        state.updateNotified = true
        toast('发现新版本 v' + data.latestVersion + '，点左下角版本号更新')
      }
    } catch (err) {
      state.update = { ok: false, currentVersion: state.version, latestVersion: state.version, hasUpdate: false, error: err.message }
      state.updateCheckedAt = Date.now()
      if (force) toast('检查更新失败：' + err.message)
    } finally {
      state.updateBusy = false
      renderFoot()
    }
  }

  async function openUpdateDialog(force) {
    if (state.updateBusy) { toast('正在检查更新…'); return }
    if (!state.update || force) {
      toast('正在检查更新…')
      await checkUpdate(true)
    }
    var u = state.update
    if (!u) return
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var repoUrl = safeHttpUrl(u.repoUrl || state.repoUrl || '')
    var title = u.hasUpdate ? '发现新版本 v' + u.latestVersion : (u.ok ? '已是最新版本' : '检查更新失败')
    var body = [
      el('div', { className: 'cds-updateversions' }, [
        el('div', {}, [el('div', { className: 'cds-label', text: '当前版本' }), el('div', { className: 'cds-updatemono', text: 'v' + (u.currentVersion || state.version || '?') })]),
        el('div', {}, [el('div', { className: 'cds-label', text: '最新版本' }), el('div', { className: 'cds-updatemono', text: u.latestVersion ? 'v' + u.latestVersion : '未知' })]),
      ]),
      u.publishedAt ? el('div', { className: 'cds-hint', text: '发布时间：' + fmtDate(u.publishedAt) }) : null,
      u.hasUpdate && u.notes ? el('div', { className: 'cds-updatenotes', text: String(u.notes).replace(/^#{1,6}\s+/gm, '') }) : null,
      u.hasUpdate ? el('div', { className: 'cds-note', text: '更新会下载 GitHub 发布包并替换插件源码；项目、参考图、风格卡、API Key 和本机数据都不会改动。更新完成后需要重启 DSH。' }) : null,
      u.error ? el('div', { className: 'cds-note', text: '检查失败：' + u.error + '。可以稍后重试，或直接打开 GitHub 仓库。' }) : null,
    ]
    var acts = [el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '关闭' })])]
    if (repoUrl) acts.push(el('a', { className: 'cds-btn', href: repoUrl, target: '_blank', rel: 'noopener noreferrer' }, [icon('external'), el('span', { text: 'GitHub 仓库' })]))
    acts.push(el('button', { className: 'cds-btn', onclick: function () { close(); openUpdateDialog(true) } }, [icon('refresh'), el('span', { text: '重新检查' })]))
    if (u.hasUpdate) acts.push(el('button', { className: 'cds-btn primary', onclick: function () { applyPluginUpdate(u, close) } }, [icon('download'), el('span', { text: '更新到 v' + u.latestVersion })]))
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '640px' } }, [
      el('h3', { text: title }),
      el('p', { text: u.hasUpdate ? '新版本已经发布，可以直接在插件内同步更新。' : (u.ok ? '当前插件已经是最新版本。' : '暂时无法连接 GitHub 检查更新。') }),
    ].concat(body).concat([el('div', { className: 'cds-dialogacts' }, acts)]))
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }

  async function applyPluginUpdate(u, close) {
    var ok = await confirmDialog('更新到 v' + u.latestVersion + '？', '会下载 GitHub 发布包并替换插件源码；项目、参考图、风格卡、API Key 和本机数据不受影响。更新完成后需要重启 DSH。', '开始更新')
    if (!ok) return
    if (close) close()
    if (state.updateBusy) return
    state.updateBusy = true
    renderFoot()
    toast('正在下载并安装 v' + u.latestVersion + '…')
    try {
      var data = await api('/update/apply', { method: 'POST', body: { version: u.latestVersion, token: state.updateToken } })
      state.updateBusy = false
      state.version = data.version || u.latestVersion
      state.update = { ok: true, currentVersion: state.version, latestVersion: state.version, hasUpdate: false, checkedAt: new Date().toISOString() }
      state.updateCheckedAt = Date.now()
      renderFoot()
      showUpdateDone(data)
    } catch (err) {
      state.updateBusy = false
      renderFoot()
      toast('更新失败：' + err.message)
    }
  }

  function showUpdateDone(data) {
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var version = data.version || state.version || ''
    var npmWarn = data.npmInstall && !data.npmInstall.skipped && !data.npmInstall.ok
      ? '依赖安装失败：' + (data.npmInstall.error || '未知错误') + '。请在插件目录运行 npm install 后重启 DSH。'
      : ''
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '620px' } }, [
      el('h3', { text: data.alreadyLatest ? '已是最新版本' : '更新完成 · v' + version }),
      el('p', { text: data.alreadyLatest ? '当前插件已经是最新版本。' : '插件源码已替换。关闭并重新打开 DSH 后，新版本才会完全生效。' }),
      npmWarn ? el('div', { className: 'cds-note', text: npmWarn }) : null,
      data.backupDir ? el('details', { className: 'cds-ridref', style: { marginTop: '10px' } }, [
        el('summary', { text: '查看更新前的备份位置' }),
        el('div', { className: 'cds-hint', text: data.backupDir }),
      ]) : null,
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '稍后重启' })]),
        el('button', { className: 'cds-btn primary', onclick: function () { close(); location.reload() } }, [icon('refresh'), el('span', { text: '刷新界面' })]),
      ]),
    ])
    modal.appendChild(dlg)
    state.windowEl.appendChild(modal)
  }

  function renderNav() {
    if (!state.navEl) return
    clear(state.navEl)
    state.navEl.appendChild(el('div', { className: 'cds-navgroup', text: 'WORKSPACE / 工作台' }))
    var items = [
      ['create', 'spark', '开始创作'],
      ['projects', 'grid', '我的封面'],
      ['references', 'image', '参考图库'],
      ['styles', 'layers', '风格库'],
      ['trash', 'trash', '回收站'],
      ['producer', 'user', '制作人'],
      ['feedback', 'feedback', '问题反馈'],
      ['settings', 'gear', '设置'],
    ]
    items.forEach(function (it) {
      var btn = el('button', { className: 'cds-nav', 'data-on': state.tab === it[0] ? '1' : '0', onclick: function () {
        if (it[0] === 'feedback') { openFeedbackDialog(); return }
        switchTab(it[0])
      } }, [icon(it[1]), el('span', { text: it[2] })])
      state.navEl.appendChild(btn)
    })
  }

  function switchTab(tab) {
    if (state.editor) closeEditor(true)
    state.tab = tab
    if (state.settings) {
      state.settings.ui = state.settings.ui || {}
      state.settings.ui.lastTab = tab
      api('/state.json', { method: 'POST', body: { ui: { lastTab: tab } } }).catch(function () {})
    }
    renderNav()
    renderPage()
  }

  function renderPage() {
    if (!state.mainEl) return
    if (!state.settings) { showLoading(); return }
    state.mainEl.scrollTop = 0
    var page = state.tab
    if (page === 'projects') return renderProjectsPage()
    if (page === 'references') return renderReferencesPage()
    if (page === 'styles') return renderStylesPage()
    if (page === 'trash') return renderTrashPage()
    if (page === 'producer') return renderProducerPage()
    if (page === 'settings') return renderSettingsPage()
    return renderCreatePage()
  }

  function pageHead(title, desc, extra) {
    return el('div', { className: 'cds-pagehead' }, [
      el('div', {}, [
        el('div', { className: 'cds-eyebrow', text: 'COVER STUDIO / DSH' }),
        el('h1', { text: title }),
        desc ? el('p', { text: desc }) : null,
      ]),
      el('div', { className: 'cds-spacer' }),
      extra || null,
    ])
  }

  // ───────────────────────────── 创作页 ─────────────────────────────

  function selectedRelay() {
    return state.settings.relays.find(function (r) { return r.id === state.form.relayId }) || state.settings.relays[0]
  }

  function styleById(id) {
    return state.styles.find(function (s) { return s.id === id })
  }

  function toggleStyle(id) {
    var arr = state.form.styles
    var idx = arr.indexOf(id)
    if (idx >= 0) { arr.splice(idx, 1); if (state.form.lastStyleId === id) state.form.lastStyleId = arr[0] || 'exclusive' }
    else { arr.push(id); state.form.lastStyleId = id }
    if (!arr.length) arr.push('exclusive')
    renderCreatePage()
  }

  function styleRefOf(s) {
    if (Array.isArray(s.references) && s.references.length) {
      var u = uploadById(s.references[0])
      if (u) return u
    }
    if (s.replicaSource && s.replicaSource.coverUrl) {
      return { url: s.replicaSource.coverUrl, thumbUrl: s.replicaSource.coverUrl }
    }
    if (s.isSection && s.sectionId) {
      var sec = (state.settings.sections || []).find(function (x) { return x.id === s.sectionId })
      var id = sec && sec.refs && sec.refs[0] && sec.refs[0].uploadId
      var v = id ? uploadById(id) : null
      if (v) return v
    }
    return null
  }

  function renderExclusiveStyleCard(container) {
    var ex = state.styles.find(function (s) { return s.id === 'exclusive' })
    if (!ex) return
    var on = state.form.styles.indexOf('exclusive') >= 0
    container.appendChild(el('button', { className: 'cds-exclusive', 'data-on': on ? '1' : '0', onclick: function () { toggleStyle('exclusive') } }, [
      el('div', { className: 'cds-ex-preview' }, [el('img', { src: API + '/assets/exclusive-preview.svg', alt: '' })]),
      el('div', { className: 'cds-ex-body' }, [
        el('div', { className: 'cds-ex-kicker', text: 'DEFAULT / 默认' }),
        el('div', { className: 'cds-ex-name', text: ex.name }),
        el('div', { className: 'cds-ex-tag', text: ex.tagline }),
        el('div', { className: 'cds-ex-points' }, [
          el('span', { text: '官方原画' }), el('span', { text: '巨型宋体' }), el('span', { text: '层叠标题' }), el('span', { text: '无红线' }),
        ]),
      ]),
      el('span', { className: 'cds-tick', text: on ? '✓' : '' }),
    ]))
  }

  function renderStyleCardButtons(container, styles) {
    (styles || []).filter(function (s) { return s.id !== 'exclusive' }).forEach(function (s) {
      var on = state.form.styles.indexOf(s.id) >= 0
      var layout = (s.layoutPool && s.layoutPool[0]) || 'left-stack'
      var ref = styleRefOf(s)
      var sw = el('div', { className: 'cds-swatch' + (ref ? ' has-ref' : '') }, ref ? [el('img', { src: ref.thumbUrl || ref.url, alt: '', loading: 'lazy' })] : [])
      var kind = s.isReplica ? (s.typography && s.typography.font ? '单张复刻' : '单张复刻 · 旧卡建议重新拆解') : (s.isSection ? '分区学习' : (s.isCustom ? '参考图学习' : ''))
      container.appendChild(el('button', { className: 'cds-style' + (s.isReplica ? ' is-replica' : ''), 'data-on': on ? '1' : '0', 'data-layout': layout, title: s.tagline || s.description || '', onclick: function () { toggleStyle(s.id) } }, [
        sw,
        el('div', { className: 'cds-style-body' }, [
          el('div', { className: 'cds-style-name', text: s.name }),
          el('div', { className: 'cds-style-tag', text: s.tagline || s.description || '' }),
          kind ? el('div', { className: 'cds-style-kind' + (s.isReplica ? ' replica' : ''), text: kind + (s.isReplica ? ' · 版式/配色/字体提示词' : '') }) : null,
        ]),
        el('span', { className: 'cds-tick', text: on ? '✓' : '' }),
      ]))
    })
  }

  function renderStyleCards(container, compact, styles) {
    var list = Array.isArray(styles) ? styles : state.styles
    if (list.some(function (s) { return s.id === 'exclusive' })) renderExclusiveStyleCard(container)
    renderStyleCardButtons(container, list)
  }

  function closeModelPickers(e) {
    if (e && e.target && e.target.closest && e.target.closest('.cds-modelpop')) return
    document.querySelectorAll('.cds-modelpick.open').forEach(function (w) { w.classList.remove('open') })
  }
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.cds-modelpick.open').forEach(function (w) {
      if (!w.contains(e.target)) w.classList.remove('open')
    })
  }, true)
  window.addEventListener('scroll', closeModelPickers, true)

  function modelPicker(relay, value, onChange) {
    var models = ((relay && relay.models) || []).slice()
    var wrap = el('div', { className: 'cds-modelpick' })
    var input = el('input', {
      className: 'cds-input', value: value || '', placeholder: '输入或选择模型', autocomplete: 'off', spellcheck: 'false',
      oninput: function (e) { onChange(e.target.value); build() },
      onfocus: function () { open() },
      onkeydown: function (e) {
        if (e.key === 'Escape') { wrap.classList.remove('open'); return }
        if (e.key === 'ArrowDown') { e.preventDefault(); open(); var first = wrap.querySelector('.cds-modelopt'); if (first) first.focus() }
      },
    })
    var pop = el('div', { className: 'cds-modelpop' })
    function open() { build(); wrap.classList.add('open') }
    function choose(m) {
      input.value = m
      onChange(m)
      wrap.classList.remove('open')
      input.focus()
    }
    function build() {
      clear(pop)
      var q = String(input.value || '').trim().toLowerCase()
      var list = models.filter(function (m) { return !q || String(m).toLowerCase().includes(q) })
      if (!list.length) {
        pop.appendChild(el('div', { className: 'cds-modelempty', text: models.length ? '没有匹配的模型，可直接输入自定义名称' : '这个中转站还没有模型列表，可直接输入模型名' }))
      }
      list.slice(0, 30).forEach(function (m) {
        pop.appendChild(el('button', {
          type: 'button', className: 'cds-modelopt' + (m === input.value ? ' on' : ''),
          onclick: function () { choose(m) },
          onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); choose(m) } },
        }, [el('span', { text: m }), m === input.value ? el('span', { className: 'cds-modelopt-tick', text: '✓' }) : null]))
      })
      var custom = String(input.value || '').trim()
      if (custom && !list.some(function (m) { return m === custom })) {
        pop.appendChild(el('button', { type: 'button', className: 'cds-modelopt custom', onclick: function () { choose(custom) } }, [el('span', { text: '使用自定义模型：' + custom })]))
      }
    }
    pop.addEventListener('wheel', function (e) { e.stopPropagation() }, { passive: true })
    var toggle = el('button', {
      type: 'button', className: 'cds-modeltoggle', title: '展开模型列表',
      onclick: function (e) { e.preventDefault(); e.stopPropagation(); if (wrap.classList.contains('open')) wrap.classList.remove('open'); else open() },
    }, [icon('down')])
    wrap.appendChild(input)
    wrap.appendChild(toggle)
    wrap.appendChild(pop)
    return wrap
  }

  function styleGroups() {
    var groups = [
      { id: 'exclusive', name: '默认风格', hint: '插件自带的设计语言', styles: [] },
      { id: 'replica', name: '单张复刻卡', hint: '每张参考封面单独拆解，最适合复刻某一张', styles: [] },
      { id: 'section', name: '分区风格', hint: '多个分区封面归纳出的共性', styles: [] },
      { id: 'reference', name: '参考图学习', hint: '上传参考图后学习成的自定义风格', styles: [] },
      { id: 'custom', name: '手写风格', hint: '自己写描述创建的风格', styles: [] },
      { id: 'builtin', name: '内置风格', hint: '插件自带的基础风格', styles: [] },
    ]
    var map = {}
    groups.forEach(function (g) { map[g.id] = g })
    ;(state.styles || []).forEach(function (s) {
      var key = s.id === 'exclusive' ? 'exclusive' : (s.isReplica ? 'replica' : (s.isSection ? 'section' : (s.isCustom ? (s.references && s.references.length ? 'reference' : 'custom') : 'builtin')))
      if (map[key]) map[key].styles.push(s)
    })
    return groups.filter(function (g) { return g.styles.length || g.id === 'exclusive' || g.id === 'replica' })
  }

  function renderStylePicker(container) {
    var groups = styleGroups()
    if (!state.styleGroups) {
      var replicaCount = (groups.find(function (g) { return g.id === 'replica'; }) || { styles: [] }).styles.length
      state.styleGroups = { exclusive: true, replica: replicaCount <= 4, section: false, reference: false, custom: false, builtin: false }
    }
    var selected = (state.form.styles || []).map(styleById).filter(Boolean)
    var head = el('div', { className: 'cds-stylepickhead' }, [
      el('div', { className: 'cds-stylepicksummary' }, selected.length
        ? selected.slice(0, 5).map(function (s) {
          return el('button', { className: 'cds-stylechip', title: '取消选择', onclick: function () { toggleStyle(s.id) } }, [el('span', { text: s.name }), el('span', { className: 'cds-stylechip-x', text: '×' })])
        }).concat(selected.length > 5 ? [el('span', { className: 'cds-tag', text: '+' + (selected.length - 5) })] : [])
        : [el('span', { className: 'cds-hint', text: '还没有选风格，默认使用「默认风格」' })]),
      el('div', { className: 'cds-spacer', style: { flex: 1 } }),
      el('button', { className: 'cds-btn ghost sm', onclick: function () {
        var anyClosed = groups.some(function (g) { return !state.styleGroups[g.id] })
        groups.forEach(function (g) { state.styleGroups[g.id] = anyClosed })
        renderCreatePage()
      } }, [el('span', { text: groups.some(function (g) { return !state.styleGroups[g.id] }) ? '展开全部' : '收起全部' })]),
    ])
    container.appendChild(head)
    groups.forEach(function (g) {
      var open = !!state.styleGroups[g.id]
      var picked = g.styles.filter(function (s) { return state.form.styles.indexOf(s.id) >= 0 }).length
      var fold = el('div', { className: 'cds-stylefold' + (open ? ' open' : '') })
      var headBtn = el('button', { className: 'cds-stylefoldhead', onclick: function (event) {
        if (event && event.target && event.target.closest('.cds-stylefold-use')) return
        state.styleGroups[g.id] = !open
        renderCreatePage()
      } }, [
        el('span', { className: 'cds-stylefoldarrow', text: open ? '▾' : '▸' }),
        el('span', { className: 'cds-stylefoldname', text: g.name }),
        el('span', { className: 'cds-stylefoldhint', text: g.hint }),
        el('span', { className: 'cds-spacer', style: { flex: 1 } }),
        picked ? el('span', { className: 'cds-badge ok', text: '已选 ' + picked }) : el('span', { className: 'cds-tag', text: g.styles.length + ' 个' }),
      ])
      fold.appendChild(headBtn)
      if (open) {
        var body = el('div', { className: 'cds-stylefoldbody' })
        if (g.id === 'replica' && !g.styles.length) {
          body.appendChild(el('div', { className: 'cds-hint', text: '还没有单张复刻卡。去「风格库 → 分区风格库」，展开任意分区，在封面卡片上点「复刻这张」；每张封面会单独生成一张配方卡。' }))
          body.appendChild(el('button', { className: 'cds-btn sm', onclick: function () { switchTab('styles') } }, [icon('layers'), el('span', { text: '去分区风格库' })]))
        }
        if (g.id === 'exclusive' && g.styles.some(function (s) { return s.id === 'exclusive' })) {
          var exGrid = el('div', { className: 'cds-styles' })
          renderExclusiveStyleCard(exGrid)
          body.appendChild(exGrid)
        } else {
          var grid = el('div', { className: 'cds-styles' })
          renderStyleCardButtons(grid, g.styles)
          body.appendChild(grid)
        }
        fold.appendChild(body)
      }
      container.appendChild(fold)
    })
    return container
  }

  function createModeBar() {
    return el('div', { className: 'cds-modes' }, [
      el('button', { 'data-on': state.createMode !== 'manual' ? '1' : '0', onclick: function () { switchCreateMode('ai') } }, [icon('spark'), el('span', { text: 'AI 生成' })]),
      el('button', { 'data-on': state.createMode === 'manual' ? '1' : '0', onclick: function () { switchCreateMode('manual') } }, [icon('edit'), el('span', { text: '手动创作' })]),
    ])
  }

  function switchCreateMode(mode) {
    state.createMode = mode === 'manual' ? 'manual' : 'ai'
    if (state.createMode === 'manual' && !state.manual.ratio) state.manual.ratio = state.form.ratio || '16:9'
    renderPage()
  }

  async function manualUploadBase(files) {
    var file = (files || [])[0]
    if (!file || !/^image\//.test(file.type || '')) { toast('请选择图片作为底图'); return }
    state.manual.busy = true
    try {
      var fd = new FormData()
      fd.append('file', file, file.name)
      var up = await api('/upload', { method: 'POST', body: fd })
      if (up.upload) {
        state.manual.upload = up.upload
        state.manual.uploadId = up.upload.id
        await loadState(true)
        toast('底图已就绪')
      }
    } catch (err) { toast('上传失败：' + err.message) }
    finally { state.manual.busy = false; renderCreatePage() }
  }

  async function manualFindAssets() {
    var q = await promptDialog('让 AI 找素材', '描述你想要的图片/贴纸/氛围', '例如：官方主视觉 蓝色夜景')
    if (!q) return
    toast('正在搜索并下载图片…')
    try {
      var data = await api('/search/images', { method: 'POST', body: { query: q, count: 8, page: 1 } })
      state.manual.assets = (data.uploads || []).concat(state.manual.assets || []).slice(0, 12)
      await loadState(true)
      renderCreatePage()
      toast('已找到 ' + ((data.uploads || []).length) + ' 张素材')
    } catch (err) { toast('找素材失败：' + err.message) }
  }

  async function manualStart(blank) {
    if (state.manual.busy) return
    if (!blank && !state.manual.uploadId) { toast('先上传一张底图，或选择空白画布'); return }
    state.manual.busy = true
    toast('正在准备画布…')
    try {
      var data = await api('/projects/manual', { method: 'POST', body: {
        uploadId: blank ? '' : state.manual.uploadId,
        ratio: state.manual.ratio,
        title: state.manual.title || '手动创作',
      } })
      await loadState(true)
      await openEditor(data.project.id, { assets: (state.manual.assets || []).map(function (a) { return a.id }) })
    } catch (err) { toast('创建画布失败：' + err.message) }
    finally { state.manual.busy = false }
  }

  function renderManualCreate() {
    var wrap = el('div', { className: 'cds-create' })
    var form = el('div', { className: 'cds-panel pad' })
    form.appendChild(el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '手动创作' }))
    form.appendChild(el('div', { className: 'cds-hint', text: '上传一张底图（官方原画、截图、旧封面都可以），进入自由画布后可以裁切缩放、加字、导入字体、贴纸和特效；也可以让 AI 找素材，或交给 AI 继续完善。' }))
    form.appendChild(el('div', { className: 'cds-field' }, [
      el('div', { className: 'cds-label' }, [el('span', { text: '作品名' }), el('small', { text: '可选' })]),
      el('input', { className: 'cds-input', placeholder: '例如：动画幕后杂谈', value: state.manual.title, oninput: function (e) { state.manual.title = e.target.value } }),
    ]))
    form.appendChild(el('div', { className: 'cds-field' }, [
      el('div', { className: 'cds-label' }, [el('span', { text: '画幅' }), el('small', { text: '进入画布后仍可改' })]),
      ratioPicker(state.manual.ratio, function (v) { state.manual.ratio = v; renderCreatePage() }),
    ]))
    var input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: function (e) { manualUploadBase(e.target.files); e.target.value = '' } })
    var drop = el('div', { className: 'cds-drop', onclick: function () { input.click() } }, [
      el('div', { className: 'cds-drop-title', text: state.manual.upload ? '底图已上传，点击更换' : '拖入底图，或点击上传' }),
      el('div', { className: 'cds-drop-hint', text: '建议用干净的官方原画/主视觉；进入画布后可以拖动裁切。' }),
    ])
    ;['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag') }) })
    ;['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag') }) })
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) manualUploadBase(e.dataTransfer.files) })
    form.appendChild(input)
    form.appendChild(drop)
    form.appendChild(el('div', { className: 'cds-row', style: { marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
      el('button', { className: 'cds-btn primary', disabled: state.manual.busy || !state.manual.uploadId, onclick: function () { manualStart(false) } }, [icon('edit'), el('span', { text: '进入画布' })]),
      el('button', { className: 'cds-btn', disabled: state.manual.busy, onclick: function () { manualStart(true) } }, [icon('plus'), el('span', { text: '空白画布' })]),
      el('button', { className: 'cds-btn', onclick: manualFindAssets }, [icon('spark'), el('span', { text: 'AI 找素材' })]),
    ]))
    form.appendChild(el('div', { className: 'cds-hint', text: '手动画布支持：底图裁切/缩放、横竖排文字、导入字体、图片/贴纸/表情包、亮度/对比度/饱和度/模糊、矩形/椭圆/直线/批注。' }))

    var base = state.manual.upload
    var stage = el('div', { className: 'cds-stage' })
    var box = el('div', { className: 'cds-stagebox' })
    box.style.aspectRatio = ratioCss(state.manual.ratio)
    box.style.minHeight = '0'
    if (targetSize(state.manual.ratio).h > targetSize(state.manual.ratio).w) { box.style.width = 'min(100%, 340px)'; box.style.margin = '0 auto' }
    if (base) box.appendChild(el('img', { className: 'cds-stageimg', src: base.url, alt: '底图', style: { cursor: 'zoom-in' }, onclick: function () { previewDialog(base.url, base.title || base.name || '底图') } }))
    else box.appendChild(el('div', { className: 'cds-empty' }, [
      el('div', { className: 'cds-empty-title', text: '上传底图或从空白开始' }),
      el('div', { className: 'cds-empty-hint', text: '进入画布后可以自由裁切、加字、贴纸和特效。' }),
    ]))
    stage.appendChild(box)
    if (state.manual.assets && state.manual.assets.length) {
      stage.appendChild(el('div', { className: 'cds-resulthead' }, [el('h2', { text: 'AI 找到的素材' }), el('span', { className: 'cds-tag', text: state.manual.assets.length + ' 张' })]))
      stage.appendChild(el('div', { className: 'cds-results' }, state.manual.assets.map(function (a) {
        return el('div', { className: 'cds-card' }, [
          el('div', { className: 'cds-cardimg', style: { cursor: 'pointer' }, onclick: function () { previewDialog(a.url, a.title || a.name) } }, [el('img', { src: a.thumbUrl || a.url, alt: a.title || a.name })]),
          el('div', { className: 'cds-cardbody' }, [
            el('div', { className: 'cds-cardtitle', text: a.title || a.name || '素材' }),
            el('div', { className: 'cds-cardmeta', text: (a.platform || '') + (a.downloadPath ? ' · 已下载' : '') }),
            el('div', { className: 'cds-cardacts' }, [
              el('button', { className: 'cds-btn sm', onclick: function () { state.manual.upload = a; state.manual.uploadId = a.id; renderCreatePage(); toast('已设为底图') } }, [el('span', { text: '设为底图' })]),
            ]),
          ]),
        ])
      })))
    }
    wrap.appendChild(form)
    wrap.appendChild(stage)
    return wrap
  }

  function renderCreatePage() {
    if (!state.mainEl) return
    applyFormDefaults()
    clear(state.mainEl)
    var page = el('div', { className: 'cds-page' })
    page.appendChild(pageHead('开始创作', state.createMode === 'manual' ? '自己上传底图、裁切、加字、贴纸和特效；也可以让 AI 找素材，或一键交给 AI 继续完善。' : 'AI 生成或手动创作都可以。AI 会读文档、找参考图、给灵感板，再生成 1–6 张不同版式。', el('button', { className: 'cds-btn', onclick: function () { loadState(true) } }, [icon('refresh'), el('span', { text: '刷新' })])))
    page.appendChild(createModeBar())
    if (state.createMode === 'manual') {
      page.appendChild(renderManualCreate())
      state.mainEl.appendChild(page)
      return
    }

    var create = el('div', { className: 'cds-create' })
    var formPanel = el('div', { className: 'cds-panel pad' })

    // brief
    formPanel.appendChild(el('div', { className: 'cds-field' }, [
      el('div', { className: 'cds-label' }, [el('span', { text: '视频主题 / 内容简介' }), el('small', { text: '必填' })]),
      el('textarea', { className: 'cds-textarea', placeholder: '例如：动画幕后杂谈，讲创作现场、动画制作公司如何把真实场景的质感做进动画……', oninput: function (e) { state.form.brief = e.target.value } }, state.form.brief),
    ]))
    formPanel.appendChild(el('div', { className: 'cds-row' }, [
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '主标题' })]),
        el('input', { className: 'cds-input', placeholder: '动画幕后杂谈', value: state.form.title, oninput: function (e) { state.form.title = e.target.value } }),
      ]),
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '副标题' })]),
        el('input', { className: 'cds-input', placeholder: '从创作现场，到观众的答案', value: state.form.subtitle, oninput: function (e) { state.form.subtitle = e.target.value } }),
      ]),
    ]))

    // styles
    formPanel.appendChild(el('div', { className: 'cds-label' }, [el('span', { text: '风格（可多选）' }), el('small', { text: '分组可折叠；复刻卡会锁定字体/文字位置' })]))
    var styleGrid = el('div', { className: 'cds-stylepicker' })
    renderStylePicker(styleGrid)
    formPanel.appendChild(styleGrid)

    // count + ratio
    formPanel.appendChild(el('div', { className: 'cds-row', style: { marginTop: '13px' } }, [
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '一次生成' }), el('small', { text: '1–6 张' })]),
        el('div', { className: 'cds-count' }, [1, 2, 3, 4, 5, 6].map(function (n) {
          return el('button', { 'data-on': state.form.count === n ? '1' : '0', onclick: function () { state.form.count = n; renderCreatePage() } }, [el('span', { text: String(n) })])
        })),
      ]),
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '画幅' }), el('small', { text: '横屏 / 竖屏 / 电影 / 自定义' })]),
        ratioPicker(state.form.ratio, function (v) { state.form.ratio = v; renderCreatePage() }),
      ]),
    ]))

    // relay + model
    var relay = selectedRelay()
    var relaySelect = el('select', { className: 'cds-select', onchange: function (e) { state.form.relayId = e.target.value; var r = selectedRelay(); if (r) state.form.model = r.defaultModel || (r.models && r.models[0]) || ''; renderCreatePage() } }, state.settings.relays.map(function (r) {
      return el('option', { value: r.id, selected: r.id === state.form.relayId }, [el('span', { text: r.name + (r.keySet ? '' : '（未填 Key）') })])
    }))
    var relayRow = el('div', { className: 'cds-row', style: { marginTop: '13px' } }, [
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '中转站' })]),
        relaySelect,
      ]),
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '生图模型' }), el('button', { className: 'cds-btn ghost sm', style: { height: '20px', padding: '0 4px' }, onclick: refreshModels }, [el('span', { text: '刷新模型' })])]),
        modelPicker(relay, state.form.model, function (v) { state.form.model = v }),
      ]),
    ])
    formPanel.appendChild(relayRow)
    if (!relay || !relay.keySet) {
      formPanel.appendChild(el('div', { className: 'cds-hint warn' }, [el('span', { text: '这个中转站还没有填写 API Key。' }), el('button', { className: 'cds-btn ghost sm', onclick: function () { switchTab('settings') } }, [el('span', { text: '去设置 →' })])]))
    }

    // reference uploader
    var fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/tiff,image/heic', multiple: true, style: { display: 'none' }, onchange: function (e) { uploadFiles(e.target.files); e.target.value = '' } })
    var drop = el('div', { className: 'cds-drop', onclick: function () { fileInput.click() } }, [
      el('div', { className: 'cds-drop-title', text: '拖拽参考图到这里，或点击上传' }),
      el('div', { className: 'cds-drop-hint', text: '支持 PNG / JPG / WebP / GIF / BMP 等；上传后自动识图，作为人物和构图参考。' }),
    ])
    ;['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag') }) })
    ;['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag') }) })
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files) })
    formPanel.appendChild(el('div', { className: 'cds-field' }, [
      el('div', { className: 'cds-label' }, [el('span', { text: '参考图 / 底图' }), el('button', { className: 'cds-btn ghost sm', style: { height: '20px', padding: '0 6px' }, onclick: findAiImages }, [icon('spark'), el('span', { text: 'AI 找图' })])]),
      drop,
      fileInput,
      referenceUploads().length ? el('div', { className: 'cds-thumbs' }, referenceUploads().slice(0, 8).map(function (u) {
        var on = state.form.referenceIds.indexOf(u.id) >= 0
        var base = state.form.baseReferenceId === u.id
        var t = el('div', { className: 'cds-thumb', 'data-primary': base ? '1' : '0', title: u.name, onclick: function () {
          var idx = state.form.referenceIds.indexOf(u.id)
          if (idx >= 0) state.form.referenceIds.splice(idx, 1)
          else state.form.referenceIds.push(u.id)
          if (base) state.form.baseReferenceId = ''
          renderCreatePage()
        }, ondblclick: function (e) { e.stopPropagation(); previewDialog(u.url || u.thumbUrl, u.title || u.name) } }, [
          el('img', { src: u.thumbUrl || u.url, alt: u.name, loading: 'lazy', decoding: 'async', onload: function (e) { if (e.target.naturalWidth && e.target.naturalWidth < 640) e.target.src = u.url } }),
          el('button', { className: 'cds-thumb-zoom', title: '放大查看原图', onclick: function (e) { e.stopPropagation(); previewDialog(u.url || u.thumbUrl, u.title || u.name) } }, [icon('eye')]),
          el('button', { className: 'cds-thumb-p', title: '设为底图', onclick: function (e) {
            e.stopPropagation()
            state.form.baseReferenceId = base ? '' : u.id
            if (!state.form.referenceIds.includes(u.id)) state.form.referenceIds.push(u.id)
            renderCreatePage()
          } }, [el('span', { text: base ? '底图 ✓' : '底图' })]),
        ])
        if (!on) t.style.opacity = '0.55'
        return t
      })) : null,
      el('div', { className: 'cds-hint', text: '点击缩略图勾选/取消；点“底图”让生图模型以这张为编辑底图。多张参考会一起参与风格分析。' }),
      el('div', { className: 'cds-basestatus ' + (state.form.baseReferenceId ? 'on' : '') }, [
        el('span', { className: 'cds-dot ' + (state.form.baseReferenceId ? 'on' : 'warn') }),
        el('span', { text: state.form.baseReferenceId ? ('当前底图：' + ((uploadById(state.form.baseReferenceId) || {}).title || (uploadById(state.form.baseReferenceId) || {}).name || '已选择') + ' · AI 会保留它并只改文字/构图') : '当前没有底图：AI 会按主题重新构图；要保留原画面请点缩略图上的“底图”' }),
      ]),
    ]))

    if (state.form.handoffPreviewId) {
      var hu = uploadById(state.form.handoffPreviewId)
      var handoffPanel = el('div', { className: 'cds-handoff' }, [
        hu ? el('img', { className: 'cds-handoffthumb', src: hu.thumbUrl || hu.url, alt: '手动画布预览', onclick: function () { previewDialog(hu.url || hu.thumbUrl, '手动画布预览') } }) : el('div', { className: 'cds-handoffthumb empty', text: '手动稿' }),
        el('div', { className: 'cds-handoffbody' }, [
          el('div', { className: 'cds-handoffkicker', text: 'HANDOFF / 来自手动画布' }),
          el('div', { className: 'cds-handofftitle', text: '已保留手动构图，AI 只重排文字' }),
          el('div', { className: 'cds-handoffmeta', text: (state.form.manualContext?.layerCount || 0) + ' 个图层 · ' + (state.form.manualContext?.ratio || state.form.ratio) + ' · 底图与手动图形会一起参考' }),
        ]),
        el('div', { className: 'cds-handoffacts' }, [
          el('button', { className: 'cds-btn sm', onclick: function () { if (state.form.handoffSource) openEditor(state.form.handoffSource) } }, [icon('edit'), el('span', { text: '回到画布' })]),
          el('button', { className: 'cds-btn sm', onclick: function () { if (hu) previewDialog(hu.url || hu.thumbUrl, '手动画布预览') } }, [icon('eye'), el('span', { text: '放大' })]),
          el('button', { className: 'cds-btn sm', onclick: function () {
            var ids = [state.form.handoffPreviewId]
            state.form.referenceIds = (state.form.referenceIds || []).filter(function (id) { return ids.indexOf(id) < 0 && (!state.form.baseReferenceId || id !== state.form.baseReferenceId) })
            state.form.baseReferenceId = state.form.referenceIds[0] || ''
            state.form.handoffPreviewId = ''
            state.form.handoffSource = ''
            state.form.handoffRefIds = []
            state.form.manualContext = null
            renderCreatePage()
            toast('已清除手动稿上下文')
          } }, [el('span', { text: '清除' })]),
        ]),
      ])
      formPanel.appendChild(handoffPanel)
    }

    // documents
    var docInput = el('input', { type: 'file', accept: '.txt,.md,.markdown,.pdf,.docx,.csv,.json', multiple: true, style: { display: 'none' }, onchange: function (e) { handleDocuments(e.target.files); e.target.value = '' } })
    var docDrop = el('div', { className: 'cds-drop doc', onclick: function () { docInput.click() } }, [
      el('div', { className: 'cds-drop-title', text: '拖入文档，AI 读取正文后结合参考图创作' }),
      el('div', { className: 'cds-drop-hint', text: '支持 TXT / MD / PDF / DOCX；也可以把文档里的卖点、脚本、资料直接拖进来。' }),
    ])
    ;['dragenter', 'dragover'].forEach(function (ev) { docDrop.addEventListener(ev, function (e) { e.preventDefault(); docDrop.classList.add('drag') }) })
    ;['dragleave', 'drop'].forEach(function (ev) { docDrop.addEventListener(ev, function (e) { e.preventDefault(); docDrop.classList.remove('drag') }) })
    docDrop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) handleDocuments(e.dataTransfer.files) })
    formPanel.appendChild(el('div', { className: 'cds-field' }, [
      el('div', { className: 'cds-label' }, [el('span', { text: '文档参考' }), el('small', { text: '可选' })]),
      docDrop,
      docInput,
      state.form.documents && state.form.documents.length ? el('div', { className: 'cds-docchips' }, state.form.documents.map(function (d, idx) {
        return el('span', { className: 'cds-docchip', title: d.name }, [el('span', { text: d.name + ' · ' + d.chars + '字' }), el('button', { onclick: function () { state.form.documents.splice(idx, 1); renderCreatePage() } }, [icon('close')])])
      })) : null,
    ]))

    // inspiration
    formPanel.appendChild(el('div', { className: 'cds-inspirebar' }, [
      el('button', { className: 'cds-btn', disabled: state.inspireBusy, onclick: makeInspiration }, [icon('spark'), el('span', { text: state.inspireBusy ? '正在想方向…' : 'AI 灵感板 · 4 个方向' })]),
      el('span', { className: 'cds-hint', text: '不知道做什么风格时，让 AI 先给构图方向。' }),
    ]))

    // custom style
    formPanel.appendChild(el('div', { className: 'cds-field' }, [
      el('div', { className: 'cds-label' }, [el('span', { text: '自定义方向' }), el('small', { text: '可选' })]),
      el('textarea', { className: 'cds-textarea', placeholder: '例如：想要竖排宋体、冷蓝色、人物在右侧、标题压在肩膀上；不要拼贴和红色横线……', oninput: function (e) { state.form.customStyle = e.target.value } }, state.form.customStyle),
    ]))

    // generate
    var busy = !!(state.job && (state.job.status === 'running' || state.job.status === 'queued'))
    var genBtn = el('button', { className: 'cds-btn primary wide', disabled: busy || state.uploadBusy || !state.settings.relays.length, onclick: generate, style: { height: '42px', marginTop: '4px' } }, [icon('spark'), el('span', { text: busy ? '生成中…' : (state.job && state.job.status === 'error' ? '重试 ' + state.form.count + ' 张' : '生成 ' + state.form.count + ' 张封面') })])
    formPanel.appendChild(genBtn)
    if (state.job) {
      var p = state.job
      formPanel.appendChild(el('div', { className: 'cds-progress', id: 'cds-progress' }, [
        el('div', { className: 'cds-prow' }, [el('span', { className: 'cds-pstep', text: p.step || '生成中' }), el('span', { className: 'cds-spacer' }), el('span', { text: (p.progress || 0) + '%' })]),
        el('div', { className: 'cds-pmsg', text: p.message || '' }),
        el('div', { className: 'cds-bar' }, [el('span', { style: { width: (p.progress || 0) + '%' } })]),
        p.status === 'error' ? el('div', { className: 'cds-hint err', text: p.error || p.message || '' }) : null,
        p.status === 'running' || p.status === 'queued' ? el('div', { style: { marginTop: '8px' } }, [el('button', { className: 'cds-btn sm', onclick: cancelJob }, [el('span', { text: '取消' })])]) : el('div', { style: { marginTop: '8px' } }, [el('button', { className: 'cds-btn sm', onclick: function () { state.job = null; renderCreatePage() } }, [el('span', { text: '关闭提示' })])]),
      ]))
    }
    formPanel.appendChild(el('div', { className: 'cds-hint', text: '生成会调用中转站生图 + 本地排版，按张计费；默认 3 张，耗时约 1–3 分钟。中途可以切到别的页面，任务会继续。' }))

    create.appendChild(formPanel)

    // stage
    var right = el('div')
    var stage = el('div', { className: 'cds-stage' })
    var stageBox = el('div', { className: 'cds-stagebox' })
    var first = state.results.find(function (r) { return r.ok && r.project })
    var last = first ? first.project : (state.projects[0] || null)
    var stageRatio = last ? last.ratio : state.form.ratio
    var stageSize = targetSize(stageRatio)
    stageBox.style.aspectRatio = ratioCss(stageRatio)
    stageBox.style.minHeight = '0'
    if (stageSize.h > stageSize.w) {
      stageBox.style.width = 'min(100%, 340px)'
      stageBox.style.margin = '0 auto'
    }
    if (last) {
      stageBox.appendChild(el('img', { className: 'cds-stageimg', src: last.coverUrl || last.thumbUrl, alt: last.title, onclick: function () { openEditor(last.id) }, ondblclick: function (e) { e.stopPropagation(); previewDialog(last.coverUrl || last.thumbUrl, last.title) } }))
    } else {
      stageBox.appendChild(el('div', { className: 'cds-empty' }, [
        el('div', { className: 'cds-empty-title', text: '你的封面会出现在这里' }),
        el('div', { className: 'cds-empty-hint', text: '官方原画为底，大号思源宋体标题由本地排版；生成后可直接在图上改字、加批注、导出。' }),
      ]))
    }
    stage.appendChild(stageBox)
    if (last) {
      stage.appendChild(el('div', { className: 'cds-resulthead' }, [
        el('h2', { text: first ? '本次生成' : '最近的作品' }),
        el('span', { className: 'cds-tag', text: last.styleName || last.styleId || '' }),
        el('span', { className: 'cds-tag', text: last.ratio || '' }),
        last.reframeOf ? el('span', { className: 'cds-reframebadge', text: '比例重绘 · 原图保留' }) : null,
        el('span', { className: 'cds-spacer' }),
        last.reframeOriginalUrl ? el('button', { className: 'cds-btn sm', onclick: function () { showReframePair(last) } }, [icon('grid'), el('span', { text: '原图 / 新图' })] ) : null,
        el('button', { className: 'cds-btn sm', onclick: function () { openEditor(last.id) } }, [icon('edit'), el('span', { text: '编辑' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { reframeProjectUI(last) } }, [icon('crop'), el('span', { text: '保持内容改比例' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { previewDialog(last.coverUrl || last.thumbUrl, last.title) } }, [icon('eye'), el('span', { text: '放大' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { exportProject(last.id) } }, [icon('download'), el('span', { text: '保存到文件夹' })]),
      ]))
    }
    right.appendChild(stage)
    if (state.results.length) right.appendChild(renderResults())
    var insp = renderInspiration()
    if (insp) right.appendChild(insp)
    create.appendChild(right)
    page.appendChild(create)
    state.mainEl.appendChild(page)
  }

  function renderResults() {
    var wrap = el('div')
    wrap.appendChild(el('div', { className: 'cds-resulthead' }, [el('h2', { text: '候选封面' }), el('span', { className: 'cds-tag', text: state.results.filter(function (r) { return r.ok }).length + ' 张' })]))
    var grid = el('div', { className: 'cds-results' })
    state.results.forEach(function (r) {
      if (!r.ok) {
        grid.appendChild(el('div', { className: 'cds-card' }, [el('div', { style: { padding: '16px' } }, [el('div', { className: 'cds-cardtitle', text: '这张生成失败' }), el('div', { className: 'cds-hint err', text: r.error || '' })])]))
        return
      }
      var p = r.project
      var ratio = ratioCss(p.ratio)
      var card = el('div', { className: 'cds-card', style: { '--cds-ratio': ratio } }, [
        el('div', { className: 'cds-cardimg', onclick: function () { openEditor(p.id) } }, [
          el('img', { src: p.coverUrl || p.thumbUrl, alt: p.title, loading: 'lazy', decoding: 'async' }),
          el('button', { className: 'cds-cardzoom', title: '放大预览', onclick: function (e) { e.stopPropagation(); previewDialog(p.coverUrl || p.thumbUrl, p.title) } }, [icon('eye')]),
          el('div', { className: 'cds-cardbadges' }, [el('span', { className: 'cds-badge', text: p.ratio || '' }), el('span', { className: 'cds-badge ok', text: p.styleName || p.styleId || '' }), p.reframeOf ? el('span', { className: 'cds-reframebadge', text: '比例重绘' }) : null]),
        ]),
        el('div', { className: 'cds-cardbody' }, [
          el('div', { className: 'cds-cardtitle', text: p.title || '未命名封面' }),
          el('div', { className: 'cds-cardmeta', text: (p.layoutId || '') + ' · ' + (r.model || '') + (p.reframeOf ? ' · 原图保留' : '') }),
          r.saved && (r.saved.png || r.saved.jpg) ? el('div', { className: 'cds-hint', style: { fontSize: '10px', marginTop: '3px', wordBreak: 'break-all' }, text: '已保存：' + (r.saved.png || r.saved.jpg) }) : null,
          el('div', { className: 'cds-cardacts' }, [
            el('button', { className: 'cds-btn sm', onclick: function () { openEditor(p.id) } }, [icon('edit'), el('span', { text: '编辑' })]),
            p.reframeOriginalUrl ? el('button', { className: 'cds-btn sm', onclick: function () { showReframePair(p) } }, [icon('grid'), el('span', { text: '原图 / 新图' })] ) : null,
            el('button', { className: 'cds-btn sm', onclick: function () { reframeProjectUI(p) } }, [icon('crop'), el('span', { text: '保持内容改比例' })]),
            el('button', { className: 'cds-btn sm', onclick: function () { exportProject(p.id) } }, [icon('download'), el('span', { text: '导出' })]),
            el('button', { className: 'cds-btn sm', onclick: function () { previewDialog(p.coverUrl || p.thumbUrl, p.title) } }, [icon('eye'), el('span', { text: '预览' })]),
            el('button', { className: 'cds-btn sm', onclick: function () { regenerateProject(p.id) } }, [icon('refresh'), el('span', { text: '重生成' })]),
          ]),
        ]),
      ])
      grid.appendChild(card)
    })
    if (!state.results.length) grid.appendChild(el('div', { className: 'cds-emptygrid', text: '还没有生成结果。' }))
    wrap.appendChild(grid)
    return wrap
  }

  async function refreshModels() {
    var relay = selectedRelay()
    if (!relay) return
    if (!relay.keySet) { toast('先去设置里填写这个中转站的 API Key'); return }
    toast('正在读取模型列表…')
    try {
      var data = await api('/relay/models', { method: 'POST', body: { relayId: relay.id } })
      if (data.ok && Array.isArray(data.models) && data.models.length) {
        relay.models = data.models
        if (!state.form.model || data.models.indexOf(state.form.model) < 0) state.form.model = data.models[0]
        if (!relay.defaultModel || data.models.indexOf(relay.defaultModel) < 0) relay.defaultModel = state.form.model
        state.settings.relays = state.settings.relays.map(function (r) { return r.id === relay.id ? relay : r })
        renderCreatePage()
        try {
          var relays = state.settings.relays.map(function (r) {
            return { id: r.id, name: r.name, baseUrl: r.baseUrl, protocol: r.protocol, models: r.models, defaultModel: r.defaultModel, fallbackModels: r.fallbackModels, size169: r.size169, size43: r.size43, size916: r.size916, size11: r.size11, quality: r.quality, extraParams: r.extraParams }
          })
          await api('/state.json', { method: 'POST', body: { relays: relays } })
        } catch {}
        toast('已读取并保存 ' + data.models.length + ' 个模型')
      } else {
        toast(data.error || '这个站没有返回模型列表，可直接手填模型名')
      }
    } catch (err) { toast('读取失败：' + err.message) }
  }

  async function uploadFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return f && f.type && f.type.indexOf('image/') === 0 })
    if (!list.length) { toast('请拖入图片文件'); return }
    state.uploadBusy = true
    try {
      for (var i = 0; i < list.length; i++) {
        var f = list[i]
        if (f.size > 50 * 1024 * 1024) { toast(f.name + ' 超过 50MB，跳过'); continue }
        toast('正在上传 ' + (i + 1) + '/' + list.length + '：' + f.name)
        var fd = new FormData()
        fd.append('file', f, f.name)
        var up
        try { up = await api('/upload', { method: 'POST', body: fd }) } catch (err) { toast('上传失败：' + err.message); continue }
        if (up.upload) {
          if (!state.form.referenceIds.includes(up.upload.id)) state.form.referenceIds.push(up.upload.id)
          toast('正在识图：' + f.name)
          try { await api('/analyze', { method: 'POST', body: { ids: [up.upload.id] } }) } catch (err) { toast('识图失败：' + err.message) }
        }
      }
      await loadState(true)
      if (state.tab === 'references') renderReferencesPage()
      else renderCreatePage()
      toast('参考图已上传并分析')
    } finally {
      state.uploadBusy = false
    }
  }

  function generate() {
    if (state.job) return
    if (!state.form.brief.trim() && !state.form.title.trim()) {
      toast('先写一下视频主题或主标题')
      return
    }
    var relay = selectedRelay()
    if (!relay) { toast('没有配置中转站，先去设置'); return }
    if (!relay.keySet) { toast('中转站还没填 API Key，先去设置'); switchTab('settings'); return }
    var body = {
      brief: state.form.brief,
      title: state.form.title,
      subtitle: state.form.subtitle,
      styles: (function () {
        var arr = state.form.styles.slice()
        if (state.form.lastStyleId && arr.indexOf(state.form.lastStyleId) >= 0) {
          arr = [state.form.lastStyleId].concat(arr.filter(function (x) { return x !== state.form.lastStyleId }))
        }
        return arr
      })(),
      count: state.form.count,
      ratio: state.form.ratio,
      relayId: state.form.relayId,
      model: state.form.model,
      referenceIds: state.form.referenceIds,
      baseReferenceId: state.form.baseReferenceId,
      customStyle: state.form.customStyle,
      documentText: (state.form.documents || []).map(function (d) { return d.text }).join('\n\n'),
      manualContext: state.form.manualContext || null,
    }
    state.results = []
    state.job = { status: 'queued', step: '提交任务', message: '', progress: 0 }
    renderCreatePage()
    api('/generate', { method: 'POST', body: body }).then(function (data) {
      if (!data.jobId) throw new Error('没有拿到任务 id')
      state.jobId = data.jobId
      pollJob(data.jobId)
    }).catch(function (err) {
      state.job = { status: 'error', step: '失败', message: err.message, error: err.message, progress: 0 }
      renderCreatePage()
    })
  }

  function pollJob(id) {
    clearInterval(state.jobTimer)
    state.jobTimer = setInterval(async function () {
      try {
        var data = await api('/jobs/' + encodeURIComponent(id))
        var job = data.job
        if (!job) return
        state.job = job
        if (job.status === 'done') {
          clearInterval(state.jobTimer)
          state.results = job.results || []
          state.job = null
          await loadState(true)
          var keptBase = (state.results || []).some(function (r) { return r && r.baseFallback })
          toast(keptBase ? '生成完成；AI 画面偏离底图，已自动改用原底图' : '生成完成')
          return
        }
        if (job.status === 'error' || job.status === 'cancelled') {
          clearInterval(state.jobTimer)
          state.job = job
          toast(job.status === 'cancelled' ? '已取消' : ('生成失败：' + (job.error || '')))
          renderCreatePage()
          return
        }
        if (state.tab === 'create') renderCreatePage()
      } catch (err) {
        clearInterval(state.jobTimer)
        state.job = { status: 'error', step: '轮询失败', message: err.message, error: err.message, progress: 0 }
        renderCreatePage()
      }
    }, 1500)
  }

  async function cancelJob() {
    if (!state.jobId) return
    try { await api('/jobs/' + encodeURIComponent(state.jobId) + '/cancel', { method: 'POST', body: {} }); toast('已请求取消') } catch (err) { toast(err.message) }
  }

  async function exportProject(id) {
    try {
      var data = await api('/projects/' + encodeURIComponent(id) + '/export', { method: 'POST', body: {} })
      toast('已保存：' + (data.png || data.dir || '输出目录'))
    } catch (err) { toast('保存失败：' + err.message) }
  }

  async function regenerateProject(id) {
    var ok = await confirmDialog('重新生成这张？', '会保留标题、副标题和版式，只重新生成背景并重新排版。', '开始重生成')
    if (!ok) return
    try {
      var data = await api('/projects/' + encodeURIComponent(id) + '/regenerate', { method: 'POST', body: {} })
      toast('已开始重生成…')
      var timer = setInterval(async function () {
        try {
          var j = await api('/jobs/' + encodeURIComponent(data.jobId))
          if (j.job && (j.job.status === 'done' || j.job.status === 'error' || j.job.status === 'cancelled')) {
            clearInterval(timer)
            if (j.job.status === 'done') { await loadState(true); toast('重生成完成') }
            else toast('重生成失败：' + (j.job.error || j.job.status))
          }
        } catch (e) { clearInterval(timer); toast(e.message) }
      }, 1500)
    } catch (err) { toast('重生成失败：' + err.message) }
  }

  function askRatio(current) {
    return new Promise(function (resolve) {
      var modal = el('div', { className: 'cds-modal' })
      var chosen = ''
      var mode = 'ai'
      var preserve = true
      var close = function (v) { if (modal.parentNode) modal.parentNode.removeChild(modal); resolve(v) }
      var ratioBtns = RATIOS.filter(function (r) { return r.id !== current }).map(function (r) {
        var btn = el('button', { className: 'cds-btn sm', 'data-on': '0', onclick: function () {
          chosen = r.id
          ratioBtns.forEach(function (b) { b.setAttribute('data-on', b === btn ? '1' : '0') })
          startBtn.disabled = false
          startBtn.querySelector('span').textContent = '开始改比例'
        } }, [el('span', { text: r.label + ' · ' + r.width + '×' + r.height })])
        return btn
      })
      var modeAi = el('button', { className: 'cds-btn sm', 'data-on': '1', onclick: function () { mode = 'ai'; refreshMode() } }, [el('span', { text: 'AI 扩图（更好看）' })])
      var modeLocal = el('button', { className: 'cds-btn sm', 'data-on': '0', onclick: function () { mode = 'local'; refreshMode() } }, [el('span', { text: '本地扩展（快、不耗中转站）' })])
      function refreshMode() {
        modeAi.setAttribute('data-on', mode === 'ai' ? '1' : '0')
        modeLocal.setAttribute('data-on', mode === 'local' ? '1' : '0')
        preserveBox.style.display = mode === 'ai' ? '' : 'none'
      }
      var preserveInput = el('input', { type: 'checkbox', checked: true, onchange: function (e) { preserve = e.target.checked } })
      var preserveBox = el('label', { className: 'cds-switch', style: { marginTop: '8px' } }, [preserveInput, el('span', { text: '保内容优先：把原画面完整叠回中心，AI 只补画边缘（推荐）' })])
      var startBtn = el('button', { className: 'cds-btn primary', disabled: true, onclick: function () {
        if (!chosen) { toast('先选一个新画幅'); return }
        close({ ratio: chosen, mode: mode, preserve: preserve })
      } }, [el('span', { text: '先选画幅' })])
      var dlg = el('div', { className: 'cds-dialog' }, [
        el('h3', { text: '保持内容，重绘比例' }),
        el('p', { text: '原图会保留；会新建一张新比例封面。AI 模式让中转站补全新画幅边缘；本地模式不调用中转站，秒出、内容 100% 保留。' }),
        el('div', { className: 'cds-ratio', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' } }, ratioBtns),
        el('div', { className: 'cds-label', style: { marginTop: '12px' }, text: '处理方式' }),
        el('div', { className: 'cds-ratio', style: { marginTop: '6px' } }, [modeAi, modeLocal]),
        preserveBox,
        el('div', { className: 'cds-dialogacts' }, [
          el('button', { className: 'cds-btn', onclick: function () { close(null) } }, [el('span', { text: '取消' })]),
          startBtn,
        ]),
      ])
      modal.appendChild(dlg)
      modal.addEventListener('click', function (e) { if (e.target === modal) close(null) })
      state.windowEl.appendChild(modal)
      refreshMode()
    })
  }

  function showReframeProgress(jobId) {
    return new Promise(function (resolve, reject) {
      var modal = el('div', { className: 'cds-modal' })
      var stepEl = el('div', { className: 'cds-pstep', text: '排队中' })
      var msgEl = el('div', { className: 'cds-hint', text: '正在准备…' })
      var fill = el('span', { style: { width: '2%' } })
      var pctEl = el('span', { className: 'cds-hint', text: '0%' })
      var timer = 0
      var closed = false
      var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
      function stopPoll() { if (timer) { clearInterval(timer); timer = 0 } }
      var dlg = el('div', { className: 'cds-dialog' }, [
        el('h3', { text: '正在保持内容改比例' }),
        el('p', { text: '任务已转到后台，不用等在这个窗口也可以。原图会一直保留。' }),
        el('div', { className: 'cds-reframeprog' }, [
          el('div', { className: 'cds-prow' }, [stepEl, el('span', { style: { flex: 1 } }), pctEl]),
          msgEl,
          el('div', { className: 'cds-reframebar' }, [fill]),
        ]),
        el('div', { className: 'cds-dialogacts' }, [
          el('button', { className: 'cds-btn', onclick: function () {
            stopPoll()
            close()
            if (!closed) { closed = true; resolve({ background: true, jobId: jobId }) }
            toast('任务在后台继续，完成后可在「我的封面」查看')
          } }, [el('span', { text: '后台运行' })]),
          el('button', { className: 'cds-btn danger', onclick: async function () {
            stopPoll()
            try { await api('/jobs/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST', body: {} }) } catch (e) {}
            close()
            if (!closed) { closed = true; reject(new Error('已取消改比例')) }
          } }, [el('span', { text: '取消任务' })]),
        ]),
      ])
      modal.appendChild(dlg)
      state.windowEl.appendChild(modal)
      async function poll() {
        try {
          var data = await api('/jobs/' + encodeURIComponent(jobId))
          var j = data.job || {}
          stepEl.textContent = j.step || '处理中'
          msgEl.textContent = j.message || '正在处理…'
          var pct = Math.max(2, Math.min(100, Number(j.progress) || 0))
          fill.style.width = pct + '%'
          pctEl.textContent = pct + '%'
          if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
            stopPoll()
            if (closed) return
            closed = true
            close()
            if (j.status === 'done') resolve({ job: j })
            else reject(new Error(j.error || '改比例失败'))
          }
        } catch (err) {
          stopPoll()
          if (closed) return
          closed = true
          close()
          reject(err)
        }
      }
      poll()
      timer = setInterval(poll, 1200)
    })
  }

  function showReframePair(project) {
    if (!project) return
    var originalUrl = project.reframeOriginalUrl || ''
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var note = project.reframeFallback
      ? '中转站本次不可用，已用本地扩展完成；原画面 100% 保留。'
      : (project.reframeMode === 'local'
        ? '本地扩展完成：原画面未裁切、未拉伸，四周用同图模糊填充。'
        : (project.reframePreserved ? '原画面已完整叠回中心，AI 只补全新画幅边缘。' : 'AI 扩图完成，原图仍保留在「我的封面」。'))
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '860px' } }, [
      el('h3', { text: '改比例完成 · 原图和新图都在' }),
      el('p', { text: note }),
      el('div', { className: 'cds-reframepair' }, [
        el('figure', {}, [
          originalUrl ? el('img', { src: originalUrl, alt: '原比例封面', onclick: function () { previewDialog(originalUrl, '原比例封面') } }) : el('div', { className: 'cds-replicanoimg', text: '原图已保留在项目里' }),
          el('figcaption', { text: '原比例 · ' + (project.reframeOriginalRatio || '') }),
        ]),
        el('figure', {}, [
          el('img', { src: project.coverUrl || project.thumbUrl, alt: '新比例封面', onclick: function () { previewDialog(project.coverUrl || project.thumbUrl, project.title) } }),
          el('figcaption', { text: '新比例 · ' + (project.ratio || '') }),
        ]),
      ]),
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '关闭' })]),
        el('button', { className: 'cds-btn', onclick: function () { close(); exportProject(project.id) } }, [icon('download'), el('span', { text: '导出新图' })]),
        el('button', { className: 'cds-btn primary', onclick: function () { close(); openEditor(project.id) } }, [icon('edit'), el('span', { text: '编辑新图' })]),
      ]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }

  function watchReframeJob(jobId) {
    var timer = setInterval(async function () {
      try {
        var data = await api('/jobs/' + encodeURIComponent(jobId))
        var j = data.job || {}
        if (j.status === 'done') {
          clearInterval(timer)
          await loadState(true)
          toast('改比例已在后台完成，可在「我的封面」查看原图和新图')
        } else if (j.status === 'error' || j.status === 'cancelled') {
          clearInterval(timer)
          toast('后台改比例' + (j.status === 'cancelled' ? '已取消' : '失败：' + (j.error || '')))
        }
      } catch (e) { clearInterval(timer) }
    }, 4000)
  }

  async function reframeProjectUI(project) {
    var id = typeof project === 'string' ? project : project.id
    var current = typeof project === 'object' ? project.ratio : ''
    var choice = await askRatio(current)
    if (!choice) return
    toast(choice.mode === 'local' ? '正在本地扩展画布…' : '已开始 AI 扩图，任务在后台运行…')
    try {
      var data = await api('/projects/' + encodeURIComponent(id) + '/reframe', { method: 'POST', body: { ratio: choice.ratio, mode: choice.mode, preserve: choice.preserve } })
      if (!data.jobId) throw new Error('没有返回任务 id')
      var outcome = await showReframeProgress(data.jobId)
      if (outcome && outcome.background) {
        watchReframeJob(data.jobId)
        toast('任务在后台继续；完成后可在「我的封面」看到原图和新比例两张')
        return
      }
      await loadState(true)
      var result = outcome && outcome.job && Array.isArray(outcome.job.results) ? outcome.job.results[0] : null
      var created = (result && result.project) || state.projects.find(function (p) { return p.reframeOf === id }) || null
      if (created) {
        if (!created.reframeOriginalUrl) {
          var orig = state.projects.find(function (p) { return p.id === id })
          created = { ...created, reframeOriginalUrl: orig && (orig.coverUrl || orig.thumbUrl) }
        }
        showReframePair(created)
      } else {
        switchTab('projects')
        toast('改比例完成，原图和新图都在「我的封面」')
      }
    } catch (err) {
      toast('改比例失败：' + err.message)
    }
  }

  // ───────────────────────────── 项目页 ─────────────────────────────

  function renderProjectsPage() {
    clear(state.mainEl)
    var page = el('div', { className: 'cds-page' })
    var selected = state.projectSel.filter(function (id) { return state.projects.some(function (p) { return p.id === id }) })
    state.projectSel = selected
    var headActions = el('div', { className: 'cds-selecthead' }, [
      el('button', { className: 'cds-btn sm', onclick: function () { loadState(true) } }, [icon('refresh'), el('span', { text: '刷新' })]),
      el('button', { className: 'cds-btn sm' + (state.projectSelectMode ? ' primary' : ''), onclick: function () {
        state.projectSelectMode = !state.projectSelectMode
        if (!state.projectSelectMode) state.projectSel = []
        renderProjectsPage()
      } }, [icon('check'), el('span', { text: state.projectSelectMode ? '完成选择' : '选择' })]),
    ])
    page.appendChild(pageHead('我的封面', '所有生成过的封面都保留原始背景和可编辑文字图层。点击任意一张进入画布编辑；选择模式支持批量删除。', headActions))
    if (state.projectSelectMode) {
      page.appendChild(el('div', { className: 'cds-batchbar' }, [
        el('span', { className: 'cds-batchcount', text: '已选 ' + state.projectSel.length + ' / ' + state.projects.length }),
        el('button', { className: 'cds-btn sm', onclick: function () {
          state.projectSel = state.projectSel.length === state.projects.length ? [] : state.projects.map(function (p) { return p.id })
          renderProjectsPage()
        } }, [el('span', { text: state.projectSel.length === state.projects.length ? '取消全选' : '全选' })]),
        el('span', { className: 'cds-spacer', style: { flex: 1 } }),
        el('button', { className: 'cds-btn sm danger', disabled: !state.projectSel.length, onclick: deleteSelectedProjects }, [icon('trash'), el('span', { text: '删除选中' })]),
      ]))
    }
    if (!state.projects.length) {
      page.appendChild(el('div', { className: 'cds-emptygrid', text: '还没有封面。去「开始创作」生成第一张。' }))
      state.mainEl.appendChild(page)
      return
    }
    var grid = el('div', { className: 'cds-projects' })
    state.projects.forEach(function (p) {
      var ratio = ratioCss(p.ratio)
      var picked = state.projectSel.indexOf(p.id) >= 0
      var card = el('div', { className: 'cds-project' + (picked ? ' is-picked' : ''), onclick: function () {
        if (state.projectSelectMode) toggleProjectSel(p.id)
        else openEditor(p.id)
      } }, [
        el('div', { className: 'cds-pimg', style: { aspectRatio: ratio } }, [
          el('img', { src: p.coverUrl || p.thumbUrl, alt: p.title, loading: 'lazy', decoding: 'async' }),
          p.reframeOf ? el('span', { className: 'cds-reframebadge cds-preframe', text: '比例重绘' }) : null,
          state.projectSelectMode ? el('span', { className: 'cds-pickcheck' + (picked ? ' on' : ''), text: picked ? '✓' : '' }) : null,
          el('button', { className: 'cds-cardzoom', title: '放大预览', onclick: function (e) { e.stopPropagation(); previewDialog(p.coverUrl || p.thumbUrl, p.title) } }, [icon('eye')]),
        ]),
        el('div', { className: 'cds-pbody' }, [
          el('div', { className: 'cds-ptitle', text: p.title || '未命名封面' }),
          el('div', { className: 'cds-pmeta', text: (p.styleName || p.styleId || '') + ' · ' + (p.ratio || '') + (p.reframeOf ? ' · 原图保留' : '') + ' · ' + fmtDate(p.updatedAt) }),
          el('div', { className: 'cds-cardacts' }, [
            el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); openEditor(p.id) } }, [icon('edit'), el('span', { text: '编辑' })]),
            p.reframeOriginalUrl ? el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); showReframePair(p) } }, [icon('grid'), el('span', { text: '原图 / 新图' })] ) : null,
            el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); reframeProjectUI(p) } }, [icon('crop'), el('span', { text: '改比例' })]),
            el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); exportProject(p.id) } }, [icon('download'), el('span', { text: '导出' })]),
            el('button', { className: 'cds-btn sm danger', onclick: async function (e) {
              e.stopPropagation()
              var ok = await confirmDialog('删除这个封面？', '会移到封面设计助手的数据回收站，不会立刻永久删除。', '删除', true)
              if (!ok) return
              try { await api('/projects/' + encodeURIComponent(p.id), { method: 'DELETE' }); await loadState(true); toast('已移入回收站') } catch (err) { toast(err.message) }
            } }, [icon('trash'), el('span', { text: '删除' })]),
          ]),
        ]),
      ])
      grid.appendChild(card)
    })
    page.appendChild(grid)
    state.mainEl.appendChild(page)
  }

  async function refreshTrash() {
    try {
      var data = await api('/trash')
      state.trash = data.items || []
    } catch (err) {
      state.trash = []
      toast('读取回收站失败：' + err.message)
    }
  }

  function renderTrashPage() {
    clear(state.mainEl)
    var page = el('div', { className: 'cds-page' })
    page.appendChild(pageHead('回收站', '删除的封面和参考图会在这里保留最多 7 天，到期自动永久删除；期间可以恢复或直接销毁。', el('div', { className: 'cds-selecthead' }, [
      el('button', { className: 'cds-btn sm', onclick: async function () { await refreshTrash(); renderTrashPage() } }, [icon('refresh'), el('span', { text: '刷新' })]),
      el('button', { className: 'cds-btn sm danger', onclick: async function () {
        var ok = await confirmDialog('清空回收站？', '里面所有封面和参考图都会被永久删除，无法恢复。', '清空', true)
        if (!ok) return
        try { await api('/trash/empty', { method: 'POST', body: {} }); await refreshTrash(); renderTrashPage(); toast('回收站已清空') } catch (err) { toast(err.message) }
      } }, [icon('trash'), el('span', { text: '清空回收站' })]),
    ])))
    if (!Array.isArray(state.trash)) {
      page.appendChild(el('div', { className: 'cds-hint', text: '正在读取回收站…' }))
      state.mainEl.appendChild(page)
      refreshTrash().then(function () { renderTrashPage() })
      return
    }
    if (!state.trash.length) {
      page.appendChild(el('div', { className: 'cds-emptygrid', text: '回收站是空的。删除封面或参考图后会先放到这里。' }))
      state.mainEl.appendChild(page)
      return
    }
    var grid = el('div', { className: 'cds-projects' })
    state.trash.forEach(function (it) {
      var isProject = it.type === 'project'
      var card = el('div', { className: 'cds-project', style: { cursor: 'default' } }, [
        el('div', { className: 'cds-pimg', style: { aspectRatio: '16/9' } }, [
          it.previewUrl ? el('img', { src: it.previewUrl, alt: it.title || it.name, loading: 'lazy', decoding: 'async', onclick: function () { previewDialog(it.previewUrl, it.title || it.name) } }) : el('div', { className: 'cds-emptygrid', text: isProject ? '封面' : '参考图' }),
        ]),
        el('div', { className: 'cds-pbody' }, [
          el('div', { className: 'cds-ptitle', text: (isProject ? '封面 · ' : '参考图 · ') + (it.title || it.name || '未命名') }),
          el('div', { className: 'cds-pmeta', text: [it.type === 'project' ? '封面项目' : '参考图', '删除于 ' + fmtDate(it.deletedAt), '剩余 ' + it.daysLeft + ' 天'].join(' · ') }),
          el('div', { className: 'cds-cardacts' }, [
            el('button', { className: 'cds-btn sm primary', onclick: async function () {
              try {
                await api('/trash/restore', { method: 'POST', body: { id: it.id } })
                state.trash = null
                await loadState(true)
                await refreshTrash()
                renderTrashPage()
                toast('已恢复')
              } catch (err) { toast('恢复失败：' + err.message) }
            } }, [icon('undo'), el('span', { text: '恢复' })]),
            el('button', { className: 'cds-btn sm danger', onclick: async function () {
              var ok = await confirmDialog('彻底删除？', '这项会被永久删除，无法恢复。', '永久删除', true)
              if (!ok) return
              try { await api('/trash/destroy', { method: 'POST', body: { id: it.id } }); await refreshTrash(); renderTrashPage(); toast('已永久删除') } catch (err) { toast(err.message) }
            } }, [icon('trash'), el('span', { text: '彻底删除' })]),
          ]),
        ]),
      ])
      grid.appendChild(card)
    })
    page.appendChild(grid)
    state.mainEl.appendChild(page)
  }

  function toggleProjectSel(id) {
    var i = state.projectSel.indexOf(id)
    if (i >= 0) state.projectSel.splice(i, 1)
    else state.projectSel.push(id)
    var top = state.mainEl ? state.mainEl.scrollTop : 0
    renderProjectsPage()
    if (state.mainEl) state.mainEl.scrollTop = top
  }

  async function deleteSelectedProjects() {
    var ids = state.projectSel.slice()
    if (!ids.length) return
    var ok = await confirmDialog('删除选中的 ' + ids.length + ' 张封面？', '会移到数据回收站，不会立刻永久删除。', '删除 ' + ids.length + ' 张', true)
    if (!ok) return
    var done = 0
    for (var id of ids) {
      try { await api('/projects/' + encodeURIComponent(id), { method: 'DELETE' }); done++ } catch (err) { toast('删除失败：' + err.message) }
    }
    state.projectSel = []
    state.projectSelectMode = false
    await loadState(true)
    toast('已删除 ' + done + ' 张封面')
  }

  // ───────────────────────────── 参考图页 ─────────────────────────────

  async function downloadReference() {
    var url = String(state.downloadUrl || '').trim()
    if (!url) { toast('先粘贴视频/图片链接'); return }
    state.referenceBusy = true
    toast('正在解析并下载封面…')
    try {
      var data = await api('/download', { method: 'POST', body: {
        url,
        dir: state.downloadDir || undefined,
        analyze: !!state.downloadAnalyze,
      } })
      await loadState(true)
      state.referenceBusy = false
      renderReferencesPage()
      toast('已下载：' + (data.title || '封面') + (data.file ? '（已保存到 ' + data.file + '）' : ''))
    } catch (err) {
      state.referenceBusy = false
      toast('下载失败：' + err.message)
    }
  }

  async function findReferences() {
    var q = await promptDialog('AI 找图', '想要什么画面/人物/风格？会从 Bing 图片搜索并下载到参考图库。', '例如：官方主视觉 蓝色夜景')
    if (!q) return
    toast('正在搜索并下载参考图…')
    try {
      var data = await api('/search/images', { method: 'POST', body: { query: q, count: 8, page: 1 } })
      await loadState(true)
      renderReferencesPage()
      toast('已下载 ' + ((data.uploads || []).length) + ' 张高清参考图')
    } catch (err) { toast('找图失败：' + err.message) }
  }

  function renderReferencesPage() {
    clear(state.mainEl)
    var page = el('div', { className: 'cds-page' })
    var selected = state.uploadSel.filter(function (id) { return referenceUploads().some(function (u) { return u.id === id }) })
    state.uploadSel = selected
    page.appendChild(pageHead('参考图库', '这里只放你主动上传、下载或从分区库里选进来的参考图。勾选后可以一键学习成新风格，学习结果会出现在风格库。', el('div', { className: 'cds-selecthead' }, [
      el('button', { className: 'cds-btn sm', onclick: function () { loadState(true) } }, [icon('refresh'), el('span', { text: '刷新' })]),
      el('button', { className: 'cds-btn sm' + (state.uploadSelectMode ? ' primary' : ''), onclick: function () {
        state.uploadSelectMode = !state.uploadSelectMode
        if (!state.uploadSelectMode) state.uploadSel = []
        renderReferencesPage()
      } }, [icon('check'), el('span', { text: state.uploadSelectMode ? '完成选择' : '选择' })]),
    ])))
    var downloadPanel = el('div', { className: 'cds-panel pad cds-downloadpanel' }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '从视频链接下载封面' }),
      el('div', { className: 'cds-hint', text: '支持 B 站、YouTube、抖音/快手/小红书等网页的分享链接；会优先取视频封面，失败时取页面大图。' }),
      el('div', { className: 'cds-downloadrow' }, [
        el('input', { className: 'cds-input', placeholder: '粘贴视频链接，例如 https://www.bilibili.com/video/BV...', value: state.downloadUrl || '', oninput: function (e) { state.downloadUrl = e.target.value } }),
        el('button', { className: 'cds-btn primary', disabled: !!state.referenceBusy, onclick: downloadReference }, [icon('download'), el('span', { text: state.referenceBusy ? '下载中…' : '下载封面' })]),
        el('button', { className: 'cds-btn', onclick: findReferences }, [icon('spark'), el('span', { text: 'AI 找图' })]),
      ]),
      el('div', { className: 'cds-downloadrow' }, [
        el('input', { className: 'cds-input', placeholder: '下载目录；留空用设置里的默认目录', value: state.downloadDir || '', oninput: function (e) { state.downloadDir = e.target.value } }),
        el('button', { className: 'cds-btn', onclick: async function () { var p = await chooseFolder(state.downloadDir || state.settings.coverDownloadDir); if (p) { state.downloadDir = p; renderReferencesPage() } } }, [icon('folder'), el('span', { text: '选择目录' })]),
        el('label', { className: 'cds-switch' }, [el('input', { type: 'checkbox', checked: !!state.downloadAnalyze, onchange: function (e) { state.downloadAnalyze = e.target.checked } }), el('span', { text: '下载后自动识图' })]),
      ]),
    ])
    page.appendChild(downloadPanel)
    var fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onchange: function (e) { uploadFiles(e.target.files); e.target.value = '' } })
    var drop = el('div', { className: 'cds-drop', style: { marginBottom: '14px' }, onclick: function () { fileInput.click() } }, [
      el('div', { className: 'cds-drop-title', text: '拖拽图片到这里，或点击上传' }),
      el('div', { className: 'cds-drop-hint', text: '会自动转成 PNG、生成缩略图，并调用 DeepSeekFlash 识图。支持多张一起拖入。' }),
    ])
    ;['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag') }) })
    ;['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag') }) })
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files) })
    page.appendChild(drop)
    page.appendChild(fileInput)
    if (state.uploadSelectMode) {
      page.appendChild(el('div', { className: 'cds-batchbar' }, [
        el('span', { className: 'cds-batchcount', text: '已选 ' + state.uploadSel.length + ' / ' + referenceUploads().length }),
        el('button', { className: 'cds-btn sm', onclick: function () {
          state.uploadSel = state.uploadSel.length === referenceUploads().length ? [] : referenceUploads().map(function (u) { return u.id })
          renderReferencesPage()
        } }, [el('span', { text: state.uploadSel.length === referenceUploads().length ? '取消全选' : '全选' })]),
        el('span', { className: 'cds-spacer', style: { flex: 1 } }),
        el('button', { className: 'cds-btn sm primary', disabled: !state.uploadSel.length, onclick: function () { learnUploadsAsStyle(state.uploadSel.slice()) } }, [icon('spark'), el('span', { text: '学习为新风格' })]),
        el('button', { className: 'cds-btn sm danger', disabled: !state.uploadSel.length, onclick: deleteSelectedUploads }, [icon('trash'), el('span', { text: '删除选中' })]),
      ]))
    }
    if (!referenceUploads().length) {
      page.appendChild(el('div', { className: 'cds-emptygrid', text: '还没有参考图。上传后可以逐张分析，或让默认风格学习。' }))
      state.mainEl.appendChild(page)
      return
    }
    var grid = el('div', { className: 'cds-uploadgrid' })
    referenceUploads().forEach(function (u) {
      var a = u.analysis || {}
      var picked = state.uploadSel.indexOf(u.id) >= 0
      var card = el('div', { className: 'cds-upload' + (picked ? ' is-picked' : ''), onclick: function () {
        if (state.uploadSelectMode) toggleUploadSel(u.id)
      } }, [
        el('div', { className: 'cds-uimg', style: { cursor: state.uploadSelectMode ? 'pointer' : 'zoom-in' }, onclick: function (e) {
          if (state.uploadSelectMode) return
          previewDialog(u.url || u.thumbUrl, u.title || u.name)
        } }, [
          el('img', { src: u.url || u.thumbUrl, alt: u.name, loading: 'lazy', decoding: 'async' }),
          state.uploadSelectMode ? el('span', { className: 'cds-pickcheck' + (picked ? ' on' : ''), text: picked ? '✓' : '' }) : null,
        ]),
        el('div', { className: 'cds-ubody' }, [
          el('div', { className: 'cds-uname', title: u.name, text: u.title || u.name }),
          u.platform ? el('div', { className: 'cds-umeta', text: [u.platform, u.author, u.views ? Number(u.views).toLocaleString('zh-CN') + ' 播放' : ''].filter(Boolean).join(' · ') }) : null,
          el('div', { className: 'cds-uanalysis', text: a.summary || a.description || '还没有分析' }),
          u.downloadPath ? el('div', { className: 'cds-uhint', title: u.downloadPath, text: '已保存：' + u.downloadPath }) : null,
          el('div', { className: 'cds-uacts' }, [
            el('button', { className: 'cds-btn sm', onclick: async function (e) {
              e.stopPropagation(); toast('正在分析…')
              try { await api('/analyze', { method: 'POST', body: { ids: [u.id] } }); await loadState(true); toast('分析完成') } catch (err) { toast(err.message) }
            } }, [icon('spark'), el('span', { text: '分析' })]),
            el('button', { className: 'cds-btn sm', disabled: !!state.replicaBusy[u.id], onclick: function (e) { e.stopPropagation(); learnReplicaForCover(null, u.id) } }, [icon('wand'), el('span', { text: replicaStyleFor(u.id) ? '复刻卡已生成' : (state.replicaBusy[u.id] ? '拆解中…' : '复刻这张') })]),
            el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); createTemplateFromUpload(u.id) } }, [icon('layers'), el('span', { text: '拆成模板' })]),
            el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); learnUploadsAsStyle([u.id]) } }, [icon('layers'), el('span', { text: '学习为新风格' })]),
            el('button', { className: 'cds-btn sm', onclick: function (e) {
              e.stopPropagation()
              if (!state.form.referenceIds.includes(u.id)) state.form.referenceIds.push(u.id)
              state.form.baseReferenceId = u.id
              state.form.handoffRefIds = (state.form.handoffRefIds || []).filter(function (id) { return id !== u.id })
              state.uploadSelectMode = false
              state.uploadSel = []
              state.createMode = 'ai'
              state.tab = 'create'
              if (state.settings) {
                state.settings.ui = state.settings.ui || {}
                state.settings.ui.lastTab = 'create'
                state.settings.ui.createMode = 'ai'
              }
              renderNav()
              renderCreatePage()
              api('/state.json', { method: 'POST', body: { ui: { lastTab: 'create' } } }).catch(function () {})
              toast('已设为底图，可在创作页看到“当前底图”')
            } }, [icon('image'), el('span', { text: '用这张' })]),
            el('button', { className: 'cds-btn sm danger', onclick: async function (e) {
              e.stopPropagation()
              var ok = await confirmDialog('删除参考图？', u.name + ' 会移入回收站，7 天内可恢复。', '删除', true)
              if (!ok) return
              try { await api('/uploads/' + encodeURIComponent(u.id), { method: 'DELETE' }); await loadState(true); toast('已删除') } catch (err) { toast(err.message) }
            } }, [icon('trash')]),
          ]),
        ]),
      ])
      grid.appendChild(card)
    })
    page.appendChild(grid)
    state.mainEl.appendChild(page)
  }

  function toggleUploadSel(id) {
    var i = state.uploadSel.indexOf(id)
    if (i >= 0) state.uploadSel.splice(i, 1)
    else state.uploadSel.push(id)
    var top = state.mainEl ? state.mainEl.scrollTop : 0
    renderReferencesPage()
    if (state.mainEl) state.mainEl.scrollTop = top
  }

  async function deleteSelectedUploads() {
    var ids = state.uploadSel.slice()
    if (!ids.length) return
    var ok = await confirmDialog('删除选中的 ' + ids.length + ' 张参考图？', '会移入回收站，7 天内可恢复；同时从分区参考里移除，避免留下空位。', '删除 ' + ids.length + ' 张', true)
    if (!ok) return
    var done = 0
    for (var id of ids) {
      try { await api('/uploads/' + encodeURIComponent(id), { method: 'DELETE' }); done++ } catch (err) { toast('删除失败：' + err.message) }
    }
    state.uploadSel = []
    state.uploadSelectMode = false
    await loadState(true)
    renderReferencesPage()
    toast('已删除 ' + done + ' 张参考图')
  }

  async function learnUploadsAsStyle(ids) {
    if (!ids || !ids.length) return
    var name = await promptDialog('创建新风格', '给这组参考图学出来的风格起个名字，之后会出现在风格库并可勾选使用。', '例如：冷蓝竖排 · 夜间动画')
    if (!name) return
    toast('正在识图并归纳「' + name + '」…')
    try {
      var data = await api('/styles/create', { method: 'POST', body: { ids: ids.slice(0, 8), name: name } })
      await loadState(true)
      state.uploadSel = []
      state.uploadSelectMode = false
      switchTab('styles')
      toast('已创建风格：' + (data.style?.name || name) + (data.via === 'fallback' ? '（本地归纳）' : ''))
    } catch (err) { toast('学习失败：' + err.message) }
  }

  // ───────────────────────────── 风格库页 ─────────────────────────────

  function sectionDialog(section) {
    var s = section || {}
    var modal = el('div', { className: 'cds-modal' })
    var name = el('input', { className: 'cds-input', placeholder: '分区名，例如：动画区 / 影视区 / 美食区', value: s.name || '' })
    var rid = el('input', { className: 'cds-input', type: 'number', placeholder: 'B 站分区 rid（可留空）', value: s.rid || '' })
    var kw = el('input', { className: 'cds-input', placeholder: '搜索关键词，逗号分隔，例如：动画杂谈, 番剧推荐', value: (s.keywords || []).join(', ') })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var dlg = el('div', { className: 'cds-dialog' }, [
      el('h3', { text: section ? '编辑分区' : '新增分区' }),
      el('div', { className: 'cds-field', style: { marginTop: '12px' } }, [el('div', { className: 'cds-label', text: '分区名' }), name]),
      el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'B 站 rid' }), rid]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '关键词' }), kw]),
      ]),
      el('div', { className: 'cds-hint', text: '留空 rid 时只用关键词搜索高点击封面。下面有常用分区 rid，点一下就能填入；B 站会调整分区，填错也不会坏，抓不到时会自动改用关键词。' }),
      el('details', { className: 'cds-ridref' }, [
        el('summary', { text: 'B 站分区 rid 参考表（点击填入）' }),
        el('div', { className: 'cds-ridgrid' }, [
          [1, '动画'], [13, '番剧'], [167, '国创'], [23, '电影'], [11, '电视剧'], [71, '综艺'], [177, '纪录片'],
          [36, '知识'], [188, '科技'], [95, '数码'], [4, '游戏'], [5, '娱乐'], [160, '生活'], [211, '美食'],
          [217, '动物圈'], [129, '舞蹈'], [119, '鬼畜'], [3, '音乐'], [181, '影视'], [223, '汽车'], [234, '运动'],
        ].map(function (row) {
          return el('button', { type: 'button', className: 'cds-ridchip', onclick: function () {
            rid.value = String(row[0])
            if (!name.value.trim()) name.value = row[1].replace(/（.*?）/, '') + '区'
          } }, [el('span', { text: row[1] }), el('b', { text: String(row[0]) })])
        })),
        el('div', { className: 'cds-hint', text: '科技区请用 188、游戏区请用 4（旧编号 190 / 5 目前会抓错或失效）；新版接口里动画/知识/科技/游戏还有 1005 / 1010 / 1012 / 1008。抓不到时留空只用关键词最稳。' }),
      ]),
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '取消' })]),
        el('button', { className: 'cds-btn primary', onclick: async function () {
          var n = name.value.trim()
          if (!n) { toast('先填分区名'); return }
          try {
            await api('/sections/save', { method: 'POST', body: { section: {
              id: s.id || '',
              name: n,
              icon: s.icon || n.slice(0, 1),
              rid: Number(rid.value) || 0,
              keywords: kw.value.split(/[,，]/).map(function (x) { return x.trim() }).filter(Boolean),
              enabled: true,
            } } })
            close()
            await loadState(true)
            renderStylesPage()
            toast('分区已保存')
          } catch (err) { toast('保存失败：' + err.message) }
        } }, [el('span', { text: '保存' })]),
      ]),
    ])
    modal.appendChild(dlg)
    state.windowEl.appendChild(modal)
    setTimeout(function () { name.focus() }, 30)
  }

  async function harvestSectionUI(sec) {
    if (state.sectionBusy[sec.id]) return
    var count = 4
    var page = Number(sec.harvestCursor) || 1
    state.sectionBusy[sec.id] = 'harvest'
    renderStylesPage()
    toast('正在抓取「' + sec.name + '」第 ' + page + ' 批高播放封面（跳过已有，' + count + ' 张）…')
    try {
      var data = await api('/sections/harvest', { method: 'POST', body: { sectionId: sec.id, count, page } })
      await loadState(true)
      renderStylesPage()
      toast('抓取完成：新增 ' + (data.added || 0) + ' 张参考封面' + (data.failed && data.failed.length ? '，' + data.failed.length + ' 张低清/失败已跳过' : ''))
    } catch (err) { toast('抓取失败：' + err.message) }
    finally { state.sectionBusy[sec.id] = '' }
  }

  async function harvestCreatorUI(sec) {
    if (state.sectionBusy[sec.id]) return
    var q = await promptDialog('抓取指定 UP 主', '输入 UP 主名字最稳（例如：影视飓风）。空间链接也能用，但 B 站偶尔会限流匿名空间接口；遇到失败就改输名字。', sec.creator || '例如：影视飓风')
    if (!q) return
    state.sectionBusy[sec.id] = 'creator'
    renderStylesPage()
    toast('正在抓取「' + q + '」的视频封面…')
    try {
      var data = await api('/sections/creator', { method: 'POST', body: { sectionId: sec.id, creator: q, count: 6 } })
      await loadState(true)
      renderStylesPage()
      toast('已抓取 ' + (data.added || 0) + ' 张 · ' + (data.creator || q))
    } catch (err) { toast('抓取失败：' + err.message) }
    finally { state.sectionBusy[sec.id] = '' }
  }

  async function learnSectionUI(sec) {
    if (state.sectionBusy[sec.id]) return
    var ok = await confirmDialog('学习「' + sec.name + '」？', '会调用识图模型分析该分区的参考封面（消耗少量 token），再归纳成 1–4 种可复用封面类型。参考图越多、越准，结果越接近你喜欢的博主风格。', '开始学习')
    if (!ok) return
    state.sectionBusy[sec.id] = 'learn'
    renderStylesPage()
    toast('正在识图并归纳分区风格…')
    try {
      var data = await api('/sections/learn', { method: 'POST', body: { sectionId: sec.id } })
      await loadState(true)
      renderStylesPage()
      toast('已学习：' + (data.learned?.coverTypes?.length || 0) + ' 种封面类型')
    } catch (err) { toast('学习失败：' + err.message) }
    finally { state.sectionBusy[sec.id] = '' }
  }

  function toggleSectionSel(sec, uploadId) {
    var arr = state.sectionSel[sec.id] || []
    var i = arr.indexOf(uploadId)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(uploadId)
    state.sectionSel[sec.id] = arr
    var top = state.mainEl ? state.mainEl.scrollTop : 0
    renderStylesPage()
    if (state.mainEl) state.mainEl.scrollTop = top
  }

  function toggleSectionSelectAll(sec, items) {
    var arr = state.sectionSel[sec.id] || []
    state.sectionSel[sec.id] = arr.length === items.length ? [] : items.map(function (it) { return it.upload.id })
    var top = state.mainEl ? state.mainEl.scrollTop : 0
    renderStylesPage()
    if (state.mainEl) state.mainEl.scrollTop = top
  }

  async function addSectionToLibrary(sec) {
    var ids = (state.sectionSel[sec.id] || []).slice()
    if (!ids.length) return
    try {
      await api('/uploads/library', { method: 'POST', body: { ids: ids, inLibrary: true } })
      await loadState(true)
      state.uploadSel = ids.slice()
      state.uploadSelectMode = true
      switchTab('references')
      toast('已把 ' + ids.length + ' 张分区封面加入参考图库，可继续勾选学习')
    } catch (err) { toast('加入参考图库失败：' + err.message) }
  }

  async function learnSectionSelected(sec) {
    var ids = (state.sectionSel[sec.id] || []).slice()
    if (!ids.length) return
    state.sectionBusy[sec.id] = 'learn'
    renderStylesPage()
    toast('正在用选中的 ' + ids.length + ' 张封面归纳分区风格…')
    try {
      var data = await api('/sections/learn', { method: 'POST', body: { sectionId: sec.id, uploadIds: ids } })
      await loadState(true)
      state.sectionBusy[sec.id] = ''
      renderStylesPage()
      toast('已学习：' + (data.learned?.coverTypes?.length || 0) + ' 种封面类型')
    } catch (err) {
      state.sectionBusy[sec.id] = ''
      renderStylesPage()
      toast('学习失败：' + err.message)
    }
  }

  async function learnSectionAsCards(sec) {
    var ids = (state.sectionSel[sec.id] || []).slice(0, 4)
    if (!ids.length) return
    var ok = await confirmDialog('把选中的 ' + ids.length + ' 张封面分别学成复刻卡？', '每张封面会单独拆解成一张带参考图、版式、字体和专用提示词的复刻卡；之后点卡片就能套用同款配方。会调用识图模型，消耗少量 token。', '开始拆解')
    if (!ok) return
    state.sectionBusy[sec.id] = 'cards'
    renderStylesPage()
    var created = 0
    var skipped = 0
    try {
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i]
        var already = (state.settings.customStyles || []).some(function (s) {
          return s.replica && s.replicaSource && s.replicaSource.uploadId === id
        })
        if (already) { skipped++; continue }
        var u = uploadById(id)
        var baseName = String((u && (u.title || u.name)) || '参考封面').replace(/\.[^.]+$/, '').slice(0, 34)
        toast('正在拆解复刻卡 ' + (i + 1) + '/' + ids.length + '：' + baseName)
        await api('/styles/replica', { method: 'POST', body: { uploadId: id, name: baseName } })
        created++
      }
      state.sectionBusy[sec.id] = ''
      await loadState(true)
      renderStylesPage()
      toast('已生成 ' + created + ' 张单张复刻卡' + (skipped ? '，' + skipped + ' 张已存在已跳过' : ''))
    } catch (err) {
      state.sectionBusy[sec.id] = ''
      renderStylesPage()
      toast('拆解复刻卡失败：' + err.message)
    }
  }

  function replicaStyleFor(uploadId) {
    return (state.settings.customStyles || []).find(function (s) {
      return s && s.replica && s.replicaSource && s.replicaSource.uploadId === uploadId
    })
  }

  function promptOfReplica(style) {
    var src = (style && style.replicaSource) || {}
    return [src.backgroundPrompt || style.prompt || '', src.negativePrompt ? 'Negative: ' + src.negativePrompt : ''].filter(Boolean).join('\n\n')
  }

  async function copyText(text, label) {
    try {
      var ok = false
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); ok = true } catch (e) {}
      }
      if (!ok) {
        var ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        ta.remove()
      }
      if (!ok) throw new Error('浏览器拒绝了剪贴板权限')
      toast((label || '内容') + '已复制')
    } catch (err) { toast('复制失败：' + err.message) }
  }

  function showReplicaDialog(style) {
    if (!style) return
    var refs = (Array.isArray(style.references) ? style.references : []).map(uploadById).filter(Boolean)
    var src = style.replicaSource || {}
    var coverUrl = refs[0] ? (refs[0].url || refs[0].thumbUrl) : (src.coverUrl || '')
    var typo = style.typography || src.typography || {}
    var prompt = promptOfReplica(style)
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var dir = String(style.directive || '').trim()
    var dlg = el('div', { className: 'cds-dialog cds-replicadialog' }, [
      el('h3', { text: style.name || '单张复刻卡' }),
      el('p', { text: style.tagline || src.summary || '从这张参考封面拆解出的同款配方。' }),
      el('div', { className: 'cds-replicatop' }, [
        coverUrl ? el('img', { src: coverUrl, alt: src.title || '', onclick: function () { previewDialog(coverUrl, src.title || '参考封面') } }) : el('div', { className: 'cds-replicanoimg', text: '参考图' }),
        el('div', { className: 'cds-replicainfo' }, [
          el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '版式' }), el('div', { className: 'cds-hint', text: src.layoutId || (style.layoutPool && style.layoutPool[0]) || 'left-stack' })]),
          src.titlePlacement ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '标题' }), el('div', { className: 'cds-hint', text: src.titlePlacement })]) : null,
          src.composition ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '构图' }), el('div', { className: 'cds-hint', text: src.composition })]) : null,
          typo.titleSize ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '字体' }), el('div', { className: 'cds-hint', text: '标题约 ' + Math.round(Number(typo.titleSize) * 1000) / 10 + '% 画宽 · ' + (typo.font === 'sans' ? '黑体' : '宋体') + ' · ' + (typo.align || 'left') })] ) : null,
          (style.palette || src.palette || []).length ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '配色' }), el('div', { className: 'cds-lscolors' }, (style.palette || src.palette || []).slice(0, 8).map(function (c) { return el('span', { className: 'cds-lscolor', style: { background: c }, title: c }) }))]) : null,
        ]),
      ]),
      prompt ? el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '这张封面的专用生图提示词' }), el('button', { className: 'cds-btn ghost sm', onclick: function () { copyText(prompt, '提示词') } }, [el('span', { text: '复制' })])]),
        el('textarea', { className: 'cds-textarea cds-replicaprompt', readonly: true }, [prompt]),
      ]) : null,
      dir ? el('details', { className: 'cds-ridref', style: { marginTop: '8px' } }, [
        el('summary', { text: '查看中文拆解与复刻说明' }),
        el('div', { className: 'cds-hint', style: { whiteSpace: 'pre-wrap', marginTop: '8px', maxHeight: '200px', overflow: 'auto' }, text: dir }),
      ]) : null,
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '关闭' })]),
        el('button', { className: 'cds-btn', onclick: function () {
          close()
          var uid = (refs[0] && refs[0].id) || src.uploadId
          if (uid) learnReplicaForCover(null, uid, true)
        } }, [icon('refresh'), el('span', { text: '重新拆解' })]),
        el('button', { className: 'cds-btn', onclick: function () {
          close()
          var uid = (refs[0] && refs[0].id) || src.uploadId
          if (uid) createTemplateFromUpload(uid)
        } }, [icon('layers'), el('span', { text: '拆成可编辑模板' })]),
        el('button', { className: 'cds-btn primary', onclick: function () {
          close()
          useLearnedStyle({ ...style, isCustom: true, id: style.id })
        } }, [icon('spark'), el('span', { text: '套用这个复刻风格' })]),
      ]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }

  async function learnReplicaForCover(sec, uploadId, force) {
    if (!uploadId) return
    var existing = replicaStyleFor(uploadId)
    if (existing && !force) { showReplicaDialog({ ...existing, references: existing.references || [], replicaSource: existing.replicaSource }); return }
    if (state.replicaBusy[uploadId]) return
    if (!force) {
      var ok = await confirmDialog('复刻这张封面？', '会调用识图模型单独拆解这一张封面的版式、标题、字体、配色和画面气质，生成一张专用复刻卡（少量 token）。之后生成时会严格按这张的配方来，不再混用其他封面。', '开始拆解')
      if (!ok) return
    }
    function refreshReplicaHost() {
      if (state.tab === 'styles') renderStylesPage()
      else if (state.tab === 'references') renderReferencesPage()
      else if (state.tab === 'create') renderCreatePage()
    }
    state.replicaBusy[uploadId] = true
    refreshReplicaHost()
    toast(force ? '正在重新拆解这张封面…' : '正在拆解这张封面的版式与提示词…')
    try {
      var u = uploadById(uploadId)
      var baseName = String((u && (u.title || u.name)) || '参考封面').replace(/\.[^.]+$/, '').slice(0, 34)
      var data = await api('/styles/replica', { method: 'POST', body: { uploadId: uploadId, name: baseName } })
      await loadState(true)
      showReplicaDialog(data.style)
      toast(data.updated ? '复刻卡已更新' : '复刻卡已生成')
    } catch (err) { toast('复刻拆解失败：' + err.message) }
    finally {
      state.replicaBusy[uploadId] = false
      refreshReplicaHost()
    }
  }

  async function removeSectionSelected(sec) {
    var ids = (state.sectionSel[sec.id] || []).slice()
    if (!ids.length) return
    var ok = await confirmDialog('从分区移除选中的 ' + ids.length + ' 张封面？', '只从「' + sec.name + '」移除，不会删除图片本身，也不会删除分区。', '移除', true)
    if (!ok) return
    try {
      var data = await api('/sections/remove', { method: 'POST', body: { sectionId: sec.id, uploadIds: ids } })
      state.sectionSel[sec.id] = []
      await loadState(true)
      renderStylesPage()
      toast('已从分区移除 ' + (data.removed || ids.length) + ' 张封面')
    } catch (err) { toast('移除失败：' + err.message) }
  }

  function useSectionRefs(sec) {
    var refs = (sec.refs || []).slice(0, 8)
    var added = 0
    refs.forEach(function (r) {
      var u = uploadById(r.uploadId)
      if (!u) return
      if (!state.form.referenceIds.includes(u.id)) { state.form.referenceIds.push(u.id); added++ }
    })
    toast(added ? '已加入 ' + added + ' 张分区参考图（只做风格参考，需要底图请单独点“底图”）' : '这些参考图已经在当前参考里了')
  }

  function useSectionStyle(sec) {
    var id = 'section:' + sec.id
    if (!state.styles.some(function (s) { return s.id === id })) { toast('先学习这个分区，生成风格后才能选用'); return }
    if (!state.form.styles.includes(id)) state.form.styles.push(id)
    state.createMode = 'ai'
    state.tab = 'create'
    if (state.settings) {
      state.settings.ui = state.settings.ui || {}
      state.settings.ui.lastTab = 'create'
      state.settings.ui.createMode = 'ai'
    }
    renderNav()
    renderCreatePage()
    api('/state.json', { method: 'POST', body: { ui: { lastTab: 'create' } } }).catch(function () {})
    toast('已选用分区风格：' + sec.name + '，已回到创作页')
  }

  function renderSectionLibrary() {
    var wrap = el('div', { style: { marginBottom: '16px' } })
    var head = el('div', { className: 'cds-resulthead' }, [
      el('h2', { text: '分区风格库' }),
      el('span', { className: 'cds-tag', text: '高播放封面 · 学习/复刻风格' }),
      el('span', { className: 'cds-spacer' }),
      el('button', { className: 'cds-btn sm', onclick: function () { sectionDialog(null) } }, [icon('plus'), el('span', { text: '新增分区' })]),
    ])
    wrap.appendChild(head)
    wrap.appendChild(el('div', { className: 'cds-hint', text: '每次抓取都会跳过已有封面，继续拿下一批高清高播放封面；也可以指定 UP 主。抓到后用 AI 归纳 1–4 种类型。只模仿版式、字体气质和配色，不复刻具体人物与文字。' }))
    var sections = (state.settings.sections || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0) })
    if (!sections.length) {
      wrap.appendChild(el('div', { className: 'cds-emptygrid', text: '还没有分区。点「新增分区」开始。' }))
      return wrap
    }
    sections.forEach(function (sec) {
      var open = !!state.sectionOpen[sec.id]
      var busy = state.sectionBusy[sec.id]
      var learned = sec.learned && sec.learned.stylePrompt
      var headBtn = el('button', { className: 'cds-sectionhead', onclick: function () { state.sectionOpen[sec.id] = !open; renderStylesPage() } }, [
        el('span', { className: 'cds-secicon', text: sec.icon || sec.name.slice(0, 1) }),
        el('div', { className: 'cds-sectitle' }, [el('div', { className: 'cds-secname', text: sec.name }), el('div', { className: 'cds-secmeta', text: [sec.rid ? 'B站分区 ' + sec.rid : '关键词搜索', sec.creator ? 'UP主 ' + sec.creator : '', (sec.refs || []).length + ' 张参考', learned ? '已学习 ' + (sec.types || []).length + ' 种类型' : '待学习'].filter(Boolean).join(' · ') })]),
        el('span', { className: 'cds-spacer' }),
        learned ? el('span', { className: 'cds-badge ok', text: '已学习' }) : el('span', { className: 'cds-badge', text: '待学习' }),
        el('span', { className: 'cds-secchevron' }, [icon(open ? 'up' : 'down')]),
      ])
      var body = null
      if (open) {
        body = el('div', { className: 'cds-sectionbody' })
        body.appendChild(el('div', { className: 'cds-hint', text: '关键词：' + ((sec.keywords || []).join('、') || '未填') + '。' + (learned ? ' ' + (sec.learned.summary || '') : '') }))
        if (learned && sec.types && sec.types.length) {
          body.appendChild(el('div', { className: 'cds-typebadges' }, sec.types.map(function (t) {
            return el('span', { className: 'cds-typebadge', title: t.description || '', text: t.name || '类型' })
          })))
        }
        var items = (sec.refs || []).map(function (r) { return { ref: r, upload: uploadById(r.uploadId) } }).filter(function (it) { return it.upload && (!it.upload.width || it.upload.width >= 800) })
        var sel = (state.sectionSel[sec.id] || []).filter(function (id) { return items.some(function (it) { return it.upload.id === id }) })
        state.sectionSel[sec.id] = sel
        if (items.length) {
          body.appendChild(el('div', { className: 'cds-sectiongrid' }, items.map(function (it, idx) {
            var picked = sel.indexOf(it.upload.id) >= 0
            var learnedReplica = replicaStyleFor(it.upload.id)
            var replicaBusy = !!state.replicaBusy[it.upload.id]
            return el('div', { className: 'cds-sectioncard' + (picked ? ' is-picked' : '') }, [
              el('div', { className: 'cds-sectionimg' }, [
                el('img', { src: it.upload.url, alt: it.ref.title || it.upload.name, loading: 'lazy', decoding: 'async', onclick: function () { previewDialog(it.upload.url, it.ref.title || it.upload.name) } }),
                el('span', { className: 'cds-sectionnum', text: String(idx + 1).padStart(2, '0') }),
                el('span', { className: 'cds-pickcheck' + (picked ? ' on' : ''), text: picked ? '✓' : '', title: '选中这张参考', onclick: function (e) { e.stopPropagation(); toggleSectionSel(sec, it.upload.id) } }),
                (it.upload.width && it.upload.width < 900) ? el('span', { className: 'cds-badge warn cds-lowres', text: '低清' }) : null,
                el('button', { className: 'cds-replicabtn' + (learnedReplica ? ' on' : ''), title: learnedReplica ? '查看这张封面的复刻配方' : '只复刻这一张封面的版式、字体、配色和提示词', disabled: replicaBusy, onclick: function (e) { e.stopPropagation(); learnReplicaForCover(sec, it.upload.id) } }, [
                  el('span', { text: replicaBusy ? '拆解中…' : (learnedReplica ? '已复刻 · 查看' : '复刻这张') }),
                ]),
              ]),
              el('div', { className: 'cds-sectionname', text: it.ref.title || '参考封面' }),
              el('div', { className: 'cds-sectionsub', text: [it.ref.author, it.ref.views ? Number(it.ref.views).toLocaleString('zh-CN') + ' 播放' : ''].filter(Boolean).join(' · ') }),
            ])
          })))
        } else {
          body.appendChild(el('div', { className: 'cds-emptygrid', text: '还没有参考封面。先抓 4 张高播放封面。' }))
        }
        var count = sel.length
        body.appendChild(el('div', { className: 'cds-sectionacts' }, [
          el('button', { className: 'cds-btn sm primary', disabled: !!busy, onclick: function () { harvestSectionUI(sec) } }, [icon('download'), el('span', { text: busy === 'harvest' ? '抓取中…' : '抓取 4 张高播放封面' })]),
          el('button', { className: 'cds-btn sm', disabled: !!busy, onclick: function () { harvestCreatorUI(sec) } }, [icon('download'), el('span', { text: busy === 'creator' ? '抓取 UP 主中…' : '指定 UP 主抓取' })]),
          el('button', { className: 'cds-btn sm', disabled: !!busy || !items.length, onclick: function () { learnSectionUI(sec) } }, [icon('spark'), el('span', { text: busy === 'learn' ? '学习中…' : '学习全部并归纳 4 种类型' })]),
          el('button', { className: 'cds-btn sm', disabled: !items.length, onclick: function () { toggleSectionSelectAll(sec, items) } }, [icon('check'), el('span', { text: sel.length === items.length ? '取消全选' : '全选' })]),
          el('button', { className: 'cds-btn sm primary', disabled: !count || !!busy, onclick: function () { learnSectionSelected(sec) } }, [icon('spark'), el('span', { text: '学习选中 ' + count + ' 张' })]),
          el('button', { className: 'cds-btn sm', disabled: !count || !!busy, onclick: function () { learnSectionAsCards(sec) } }, [icon('layers'), el('span', { text: busy === 'cards' ? '正在生成复刻卡…' : '选中封面拆成复刻卡' })]),
          el('button', { className: 'cds-btn sm', disabled: !count, onclick: function () { addSectionToLibrary(sec) } }, [icon('image'), el('span', { text: '加入参考图库 ' + count + ' 张' })]),
          el('button', { className: 'cds-btn sm danger', disabled: !count || !!busy, onclick: function () { removeSectionSelected(sec) } }, [icon('trash'), el('span', { text: '移除选中 ' + count + ' 张' })]),
          learned ? el('button', { className: 'cds-btn sm', onclick: function () { useSectionStyle(sec) } }, [icon('check'), el('span', { text: '用这个风格' })]) : null,
          el('button', { className: 'cds-btn sm', onclick: function () { sectionDialog(sec) } }, [el('span', { text: '编辑' })]),
          el('button', { className: 'cds-btn sm danger', onclick: async function () {
            var ok = await confirmDialog('删除整个分区？', '只会删除分区「' + sec.name + '」；参考图本身不会删除。如果只想去掉几张封面，请用「移除选中」。', '删除分区', true)
            if (!ok) return
            try { await api('/sections/delete', { method: 'POST', body: { sectionId: sec.id } }); await loadState(true); renderStylesPage(); toast('已删除分区') } catch (err) { toast(err.message) }
          } }, [icon('trash'), el('span', { text: '删除分区' })]),
        ]))
      }
      wrap.appendChild(el('div', { className: 'cds-section' }, [headBtn, body]))
    })
    return wrap
  }

  function learnedStyleCard(s) {
    state.styleExpanded = state.styleExpanded || {}
    var expanded = !!state.styleExpanded[s.id]
    var refs = (Array.isArray(s.references) ? s.references : []).map(uploadById).filter(Boolean)
    var rep = s.replicaSource && typeof s.replicaSource === 'object' ? s.replicaSource : null
    var thumb = refs[0] ? (refs[0].thumbUrl || refs[0].url) : (rep && rep.coverUrl ? rep.coverUrl : '')
    var layouts = (Array.isArray(s.layoutPool) ? s.layoutPool : []).map(function (x) {
      return typeof x === 'string' ? x : (x && (x.name || x.id)) || ''
    }).filter(Boolean)
    if (rep && rep.layoutId && layouts.indexOf(rep.layoutId) < 0) layouts.unshift(rep.layoutId)
    var colors = (Array.isArray(s.palette) ? s.palette : []).map(function (c) {
      return typeof c === 'string' ? c : (c && (c.hex || c.color)) || ''
    }).filter(function (c) { return /^#[0-9a-f]{3,8}$/i.test(c) }).slice(0, 8)
    var typo = s.typography && typeof s.typography === 'object'
      ? Object.keys(s.typography).slice(0, 6).map(function (k) {
        var v = s.typography[k]
        return k + '：' + (typeof v === 'string' ? v : JSON.stringify(v))
      }).join(' · ').slice(0, 260)
      : ''
    var replicaPrompt = rep ? promptOfReplica({ ...s, replicaSource: rep }) : ''
    var effectInput = el('input', { className: 'cds-input', placeholder: '在此基础上补充效果，例如：标题更克制，加一条细青线' })
    var card = el('div', { className: 'cds-lstyle' + (expanded ? ' open' : '') + (s.isReplica ? ' is-replica' : ''), onclick: function (e) {
      if (e.target.closest('button, input, textarea, img')) return
      useLearnedStyle(s)
    } }, [
      el('div', { className: 'cds-lstylehead' }, [
        el('div', { className: 'cds-lstyleimg' }, thumb ? el('img', { src: thumb, alt: s.name, loading: 'lazy' }) : el('span', { text: '参考图' })),
        el('div', { className: 'cds-lstylebody' }, [
          el('div', { className: 'cds-lstylename', text: s.name }),
          el('div', { className: 'cds-lstyletag', text: s.tagline || '从参考图学习到的风格' }),
          el('div', { className: 'cds-lstylemeta' }, [
            el('span', { className: 'cds-lstylekind' + (s.isReplica ? ' replica' : (s.isMixedSection ? ' mixed' : '')), text: s.isReplica ? '单张复刻' : (s.isMixedSection ? '分区归纳 · 混合多张' : (s.isSection ? '分区学习' : '参考图学习')) }),
            el('span', { text: [refs.length ? refs.length + ' 张参考' : '', layouts.length ? layouts.length + ' 种版式' : '', colors.length ? colors.length + ' 个主色' : ''].filter(Boolean).join(' · ') || '可展开查看参数' }),
          ]),
        ]),
        el('div', { className: 'cds-lstyleacts' }, [
          el('button', { className: 'cds-btn sm primary', onclick: function (e) { e.stopPropagation(); useLearnedStyle(s) } }, [icon('spark'), el('span', { text: s.isReplica ? '套用同款' : '使用这个风格' })]),
          s.isReplica && refs[0] ? el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); createTemplateFromUpload(refs[0].id) } }, [icon('layers'), el('span', { text: '做模板' })]) : null,
          el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); state.styleExpanded[s.id] = !expanded; renderStylesPage() } }, [el('span', { text: expanded ? '收起参数' : '展开参数' })]),
        ]),
      ]),
      expanded ? el('div', { className: 'cds-lstyledetails' }, [
        rep && rep.titlePlacement ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '标题' }), el('div', { className: 'cds-hint', text: rep.titlePlacement })]) : null,
        rep && rep.composition ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '构图' }), el('div', { className: 'cds-hint', text: rep.composition })]) : null,
        rep && rep.lighting ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '光影' }), el('div', { className: 'cds-hint', text: rep.lighting })]) : null,
        rep && rep.decorations && rep.decorations !== 'none' ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '装饰' }), el('div', { className: 'cds-hint', text: rep.decorations })]) : null,
        replicaPrompt ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '提示词' }), el('div', {}, [
          el('div', { className: 'cds-hint', style: { maxHeight: '110px', overflow: 'auto', whiteSpace: 'pre-wrap' }, text: replicaPrompt }),
          el('button', { className: 'cds-btn ghost sm', onclick: function (e) { e.stopPropagation(); copyText(replicaPrompt, '提示词') } }, [el('span', { text: '复制提示词' })]),
        ])]) : null,
        colors.length ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '配色' }), el('div', { className: 'cds-lscolors' }, colors.map(function (c) { return el('span', { className: 'cds-lscolor', style: { background: c }, title: c }) }))]) : null,
        layouts.length ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '版式' }), el('div', { className: 'cds-lstags' }, layouts.map(function (x) { return el('span', { className: 'cds-tag', text: x }) }))]) : null,
        typo ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '字体' }), el('div', { className: 'cds-hint', text: typo })]) : null,
        el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '风格描述' }), el('div', { className: 'cds-hint', text: String(s.directive || s.description || '').slice(0, 700) || '暂无描述' })]),
        refs.length ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '参考图' }), el('div', { className: 'cds-lsrefs' }, refs.slice(0, 6).map(function (u) { return el('img', { src: u.thumbUrl || u.url, alt: u.title || u.name, title: u.title || u.name, loading: 'lazy', onclick: function () { previewDialog(u.url || u.thumbUrl, u.title || u.name) } }) }))]) : null,
        refs[0] ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '模板' }), el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); createTemplateFromUpload(refs[0].id) } }, [icon('layers'), el('span', { text: '拆成可编辑模板' })])]) : null,
        effectInput ? el('div', { className: 'cds-lsrow' }, [el('span', { className: 'cds-lslabel', text: '补充效果' }), el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [effectInput, el('button', { className: 'cds-btn sm', onclick: function (e) { e.stopPropagation(); appendStyleEffect(s, effectInput.value) } }, [el('span', { text: '追加' })])])]) : null,
      ]) : null,
    ])
    return card
  }

  async function appendStyleEffect(s, text) {
    var extra = String(text || '').trim()
    if (!extra) { toast('先写要补充的效果'); return }
    var current = state.settings.customStyles || []
    var next
    var isReplica = !!(s.isReplica || s.replica)
    if (s.isCustom) {
      next = current.map(function (x) {
        if (x.id !== s.id) return x
        var out = {
          ...x,
          directive: [String(x.directive || '').trim(), '补充效果：' + extra].filter(Boolean).join('\n').slice(0, 12000),
        }
        if (x.replica) {
          out.prompt = [String(x.prompt || x.replicaSource?.backgroundPrompt || '').trim(), 'Additional art direction: ' + extra].filter(Boolean).join('\n').slice(0, 9000)
          out.replicaSource = { ...(x.replicaSource || {}), backgroundPrompt: out.prompt }
        }
        return out
      })
    } else {
      var copiedPrompt = [String(s.prompt || '').trim(), 'Additional art direction: ' + extra].filter(Boolean).join('\n').slice(0, 9000)
      next = current.concat([{
        id: 'custom-' + Date.now().toString(36),
        name: String(s.name || '风格') + ' · 补充',
        tagline: '在原风格基础上追加效果：' + extra.slice(0, 40),
        directive: [String(s.directive || '').trim(), '补充效果：' + extra].filter(Boolean).join('\n').slice(0, 12000),
        prompt: copiedPrompt,
        negativePrompt: s.negativePrompt || '',
        layoutPool: Array.isArray(s.layoutPool) ? s.layoutPool : [],
        palette: Array.isArray(s.palette) ? s.palette : [],
        typography: s.typography && typeof s.typography === 'object' ? s.typography : {},
        references: Array.isArray(s.references) ? s.references : [],
        ...(isReplica ? { replica: true, replicaSource: { ...(s.replicaSource || {}), backgroundPrompt: copiedPrompt } } : {}),
        createdAt: new Date().toISOString(),
      }]).slice(-80)
    }
    try {
      await api('/state.json', { method: 'POST', body: { customStyles: next } })
      await loadState(true)
      renderStylesPage()
      toast(s.isCustom ? '已把补充效果写入风格「' + s.name + '」' : '已复制为新的自定义风格并追加效果')
    } catch (err) { toast('保存失败：' + err.message) }
  }

  function useLearnedStyle(s) {
    var id = (s.isExclusive || s.id === 'exclusive') ? 'exclusive' : s.id
    if (!state.form.styles.includes(id)) state.form.styles.push(id)
    state.createMode = 'ai'
    state.tab = 'create'
    if (state.settings) {
      state.settings.ui = state.settings.ui || {}
      state.settings.ui.lastTab = 'create'
      state.settings.ui.createMode = 'ai'
    }
    renderNav()
    renderCreatePage()
    api('/state.json', { method: 'POST', body: { ui: { lastTab: 'create' } } }).catch(function () {})
    toast('已选用风格「' + s.name + '」，已回到创作页')
  }

  async function createTemplateFromUpload(uploadId) {
    var u = uploadById(uploadId)
    if (!u) { toast('参考图不存在了'); return }
    var ok = await confirmDialog('拆成可编辑模板？', '会用识图模型识别原图文字、位置、字体、颜色和主体，再让中转站生成一张干净的无字背景；文字层可编辑。需要消耗一次识图和一次生图，原图保留。', '开始 AI 拆解')
    if (!ok) return
    toast('AI 正在拆解模板：识别文字和版式 → 生成干净无字背景…')
    try {
      var data = await api('/uploads/' + encodeURIComponent(uploadId) + '/template', { method: 'POST', body: {} })
      await loadState(true)
      toast('AI 模板已生成：文字图层可编辑，可在编辑器里用「AI 重绘 / 换人物」')
      if (data.project) openEditor(data.project.id)
    } catch (err) { toast('拆模板失败：' + err.message) }
  }

  async function aiRemixTemplate(projectId, opts) {
    var ed = state.editor
    if (!ed) return
    try {
      setEditorBusy(true, 'AI 正在按新提示词重绘模板，通常需要 30–90 秒…')
      var saved = await editorSave(true)
      if (!saved) return
      var data = await api('/projects/' + encodeURIComponent(projectId) + '/remix-template', {
        method: 'POST',
        body: {
          prompt: opts.prompt || '',
          subjectDescription: opts.subjectDescription || '',
          subjectUploadId: opts.subjectUploadId || '',
        },
      })
      closeEditor(true)
      await loadState(true)
      toast('AI 重绘完成：文字图层已保留，新画面已生成')
      if (data.project) openEditor(data.project.id)
    } catch (err) { toast('AI 重绘失败：' + err.message) }
    finally { setEditorBusy(false) }
  }

  function openAiRemixDialog() {
    var ed = state.editor
    if (!ed) return
    var project = ed.project
    var projectId = project.id
    var selected = ''
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var prompt = el('textarea', { className: 'cds-textarea', style: { minHeight: '150px' } }, [String(project.templatePrompt || project.templateStyleSummary || '')])
    var subject = el('input', { className: 'cds-input', placeholder: '例如：换成一位穿西装的女性，站在同样的工厂前；不填则由提示词决定' })
    var uploads = referenceUploads().slice(0, 24)
    var grid = el('div', { className: 'cds-sources' }, uploads.map(function (u) {
      return el('button', { type: 'button', className: 'cds-source', onclick: function () {
        selected = u.id
        Array.prototype.forEach.call(grid.children, function (child) {
          if (child.classList) child.classList.toggle('on', child.dataset && child.dataset.uid === selected)
        })
      }, 'data-uid': u.id }, [
        el('img', { src: u.thumbUrl || u.url, alt: u.title || u.name, loading: 'lazy' }),
        el('span', { text: u.title || u.name || '素材' }),
      ])
    }))
    if (!uploads.length) grid.appendChild(el('div', { className: 'cds-hint', text: '没有可选人物图；可以只改提示词，或点下面上传一张新图。' }))
    var fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async function (e) {
      var file = e.target.files && e.target.files[0]
      e.target.value = ''
      if (!file) return
      try {
        var fd = new FormData()
        fd.append('file', file, file.name)
        var up = await api('/upload', { method: 'POST', body: fd })
        if (!up.upload) throw new Error('上传失败')
        await loadState(true)
        close()
        await aiRemixTemplate(projectId, { prompt: prompt.value, subjectDescription: subject.value, subjectUploadId: up.upload.id })
      } catch (err) { toast('上传人物参考图失败：' + err.message) }
    } })
    var confirmBtn = el('button', { className: 'cds-btn primary', onclick: function () {
      close()
      aiRemixTemplate(projectId, { prompt: prompt.value, subjectDescription: subject.value, subjectUploadId: selected })
    } }, [icon('spark'), el('span', { text: 'AI 重绘并生成新版本' })])
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '760px' } }, [
      el('h3', { text: 'AI 重绘 / 换人物' }),
      el('p', { text: '反推提示词已经填在下面，你可以直接修改。AI 会按修改后的提示词重新生成一张同风格画面，并沿用当前文字图层；原模板会保留。需要换人时可上传/选择一张人物参考图。' }),
      el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '画面提示词（可修改）' }), prompt]),
      el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '新人物 / 新主体描述（可选）' }), subject]),
      el('div', { className: 'cds-label', text: '人物参考图（可选）' }),
      grid,
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '取消' })]),
        el('button', { className: 'cds-btn', onclick: function () { fileInput.click() } }, [icon('plus'), el('span', { text: '上传人物参考图' })]),
        fileInput,
        confirmBtn,
      ]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }


  function renderStylesPage() {
    clear(state.mainEl)
    var page = el('div', { className: 'cds-page' })
    page.appendChild(pageHead('风格库', '默认风格不是另训一个模型，而是把版式、字体和标题规则固化成设计约束，每次生成都会遵循。'))
    var ex = state.exclusive || {}
    var exCard = el('div', { className: 'cds-panel pad', style: { marginBottom: '16px' } }, [
      el('div', { className: 'cds-ex-kicker', text: 'DEFAULT / 默认风格' }),
      el('div', { style: { fontSize: '17px', fontWeight: '700', marginTop: '4px' }, text: ex.name || '默认风格' }),
      el('div', { className: 'cds-hint', text: ex.summary || '', style: { maxWidth: '820px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }),
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } }, (ex.principles || []).slice(0, 6).map(function (p) { return el('span', { className: 'cds-tag', text: p }) })),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '13px', flexWrap: 'wrap' } }, [
        el('button', { className: 'cds-btn', onclick: function () { switchTab('references') } }, [icon('image'), el('span', { text: '用参考图继续学习' })]),
        el('button', { className: 'cds-btn', onclick: function () {
          if (!state.form.styles.includes('exclusive')) state.form.styles.push('exclusive')
          toast('已选为当前风格')
        } }, [icon('check'), el('span', { text: '选为当前风格' })]),
        el('button', { className: 'cds-btn', onclick: async function () {
          try { await api('/state.json', { method: 'POST', body: { defaultStyles: ['exclusive'] } }); await loadState(true); toast('已设为默认风格') } catch (err) { toast(err.message) }
        } }, [icon('layers'), el('span', { text: '设为默认' })]),
      ]),
    ])
    page.appendChild(exCard)
    var customLearned = (state.settings.customStyles || []).filter(function (s) {
      return Array.isArray(s.references) && s.references.length
    }).map(function (s) { return { ...s, isCustom: true, isReplica: !!s.replica } })
    var replicaLearned = customLearned.filter(function (s) { return s.isReplica }).reverse()
    var otherLearned = customLearned.filter(function (s) { return !s.isReplica }).reverse()
    var sectionLearned = (state.settings.sections || []).filter(function (sec) {
      return sec.learned && (sec.refs || []).length && (sec.learned.stylePrompt || sec.learned.summary)
    }).map(function (sec) {
      return {
        id: 'section:' + sec.id,
        isSection: true,
        sectionId: sec.id,
        name: '分区 · ' + sec.name,
        tagline: sec.learned.summary || '从分区封面归纳的版式与气质',
        references: (sec.refs || []).slice(0, 8).map(function (r) { return r.uploadId }).filter(Boolean),
        layoutPool: (sec.types || []).map(function (t) { return t.name }).filter(Boolean),
        palette: sec.learned.palette || [],
        typography: sec.learned.typography || {},
        directive: sec.learned.stylePrompt || sec.learned.summary || '',
        isMixedSection: true,
      }
    })
    var learnedStyles = replicaLearned.concat(otherLearned).concat(sectionLearned).slice(0, 60)
    if (!learnedStyles.length && ex.learned && Array.isArray(ex.learned.notes) && ex.learned.notes.length) {
      var oldRefs = (ex.learned.references || []).map(function (r) { return uploadById(r.id) }).filter(Boolean)
      learnedStyles = [{
        id: 'exclusive',
        isExclusive: true,
        name: (ex.name || '默认风格') + ' · 参考图强化',
        tagline: '从你最近学习的参考图归纳出的设计 DNA',
        references: oldRefs.map(function (u) { return u.id }),
        directive: ex.learned.notes.slice(-4).join('\n'),
        layoutPool: (ex.principles || []).slice(0, 8),
        palette: [],
        typography: ex.typography || {},
      }]
    }
    if (learnedStyles.length) {
      page.appendChild(el('div', { className: 'cds-h2', text: '单张复刻与参考风格' }))
      page.appendChild(el('div', { className: 'cds-hint', text: '要复刻某一张封面，请在下面的分区库里点那张图上的「复刻这张」。每一张会单独生成配方；分区归纳卡混合了多张，只适合参考共性。' }))
      page.appendChild(el('div', { className: 'cds-lstyles' }, learnedStyles.map(learnedStyleCard)))
    }
    page.appendChild(renderSectionLibrary())
    page.appendChild(el('div', { className: 'cds-h2', text: '全部风格' }))
    var grid = el('div', { className: 'cds-styles' })
    renderStyleCards(grid, false)
    page.appendChild(grid)
    page.appendChild(el('div', { className: 'cds-h2', text: '自定义风格' }))
    var nameInput = el('input', { className: 'cds-input', placeholder: '风格名字，例如：冷蓝竖排' })
    var tagInput = el('input', { className: 'cds-input', placeholder: '一句话说明，例如：冷蓝、竖排宋体、人物在右' })
    var dirInput = el('textarea', { className: 'cds-textarea', placeholder: '描述构图、气质、配色、标题位置、要避免的东西……' })
    page.appendChild(el('div', { className: 'cds-panel pad', style: { marginBottom: '16px' } }, [
      el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '名字' }), nameInput]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '说明' }), tagInput]),
      ]),
      el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '风格描述' }), dirInput]),
      el('button', { className: 'cds-btn primary', onclick: async function () {
        var name = nameInput.value.trim()
        var directive = dirInput.value.trim()
        if (!name || !directive) { toast('名字和风格描述都要填'); return }
        var custom = (state.settings.customStyles || []).concat([{ id: 'custom-' + Date.now().toString(36), name: name, tagline: tagInput.value.trim() || '自定义风格', directive: directive }])
        try { await api('/state.json', { method: 'POST', body: { customStyles: custom } }); await loadState(true); toast('已保存自定义风格') } catch (err) { toast(err.message) }
      } }, [icon('plus'), el('span', { text: '保存自定义风格' })]),
    ]))
    if (state.settings.customStyles && state.settings.customStyles.length) {
      page.appendChild(el('div', { className: 'cds-projects' }, state.settings.customStyles.map(function (s) {
        return el('div', { className: 'cds-project', style: { cursor: 'default' } }, [
          el('div', { className: 'cds-pbody' }, [
            el('div', { className: 'cds-ptitle', text: s.name }),
            el('div', { className: 'cds-pmeta', text: s.tagline || '' }),
            el('div', { className: 'cds-hint', text: s.directive, style: { fontSize: '10px', maxHeight: '48px', overflow: 'hidden' } }),
            el('div', { className: 'cds-cardacts' }, [
              el('button', { className: 'cds-btn sm', onclick: function () { if (!state.form.styles.includes(s.id)) state.form.styles.push(s.id); toast('已选为当前风格') } }, [icon('check'), el('span', { text: '选用' })]),
              el('button', { className: 'cds-btn sm danger', onclick: async function () {
                var ok = await confirmDialog('删除这个自定义风格？', s.name, '删除', true)
                if (!ok) return
                var next = state.settings.customStyles.filter(function (x) { return x.id !== s.id })
                try { await api('/state.json', { method: 'POST', body: { customStyles: next } }); await loadState(true); toast('已删除') } catch (err) { toast(err.message) }
              } }, [icon('trash')]),
            ]),
          ]),
        ])
      })))
    }
    state.mainEl.appendChild(page)
  }

  // ───────────────────────────── 制作人 / 反馈 ─────────────────────────────

  function safeHttpUrl(value) {
    try {
      var u = new URL(String(value || ''))
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : ''
    } catch (e) { return '' }
  }

  function feedbackDiagnostics() {
    var s = state.settings || {}
    var lines = [
      '封面设计助手 v' + (state.version || '未知版本'),
      '时间：' + fmtDate(new Date().toISOString()),
      '系统：' + (navigator.platform || navigator.userAgent),
      '浏览器：' + (navigator.userAgent || ''),
      '窗口：' + window.innerWidth + '×' + window.innerHeight,
      '当前页面：' + (state.tab || ''),
      '项目：' + (state.projects || []).length + ' · 参考图：' + (state.uploads || []).length,
      '中转站：' + ((s.relays || []).length) + ' 个（默认：' + ((s.relays || []).find(function (r) { return r.id === s.defaultRelayId; }) || {}).name + '）',
      '主模型：' + ((s.mainModel || {}).mode === 'custom' ? '自定义' : '跟随 DSH') + ' · ' + ((s.mainModel || {}).model || ''),
      '风格卡：' + ((s.customStyles || []).length) + ' · 分区：' + ((s.sections || []).length),
    ]
    if (state.errors && state.errors.length) {
      lines.push('最近前端错误：')
      state.errors.slice(-4).forEach(function (e) {
        lines.push('- ' + fmtDate(e.at) + ' ' + e.text)
      })
    }
    return lines.join('\n')
  }

  function openFeedbackDialog() {
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var diag = feedbackDiagnostics()
    var formUrl = safeHttpUrl(CREATOR.feishuUrl || '')
    var formLabel = '飞书问题反馈'
    var openForm = function () {
      if (!formUrl) { close(); toast('问题反馈链接未配置'); return }
      try { window.open(formUrl, '_blank', 'noopener,noreferrer') } catch (e) { toast('浏览器拦截了新窗口，请允许弹窗'); return }
      copyText(diag, '诊断信息')
      toast('已打开飞书表单；诊断信息已复制，粘贴到表单即可')
    }
    var cta = el('button', { className: 'cds-feedbackcta', type: 'button', onclick: openForm }, [
      el('span', { className: 'cds-feedbackcta-icon' }, [icon('external')]),
      el('span', { className: 'cds-feedbackcta-body' }, [
        el('span', { className: 'cds-feedbackcta-title', text: formUrl ? '打开' + formLabel : '配置' + formLabel }),
        el('span', { className: 'cds-feedbackcta-hint', text: formUrl ? '在飞书表单里填写问题、上传截图；提交后制作人会在飞书后台实时看到。' : '反馈链接未配置，请联系维护者。' }),
      ]),
      el('span', { className: 'cds-feedbackcta-arrow', text: '→' }),
    ])
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '620px' } }, [
      el('h3', { text: '问题反馈' }),
      el('p', { text: '请直接打开飞书问题反馈表单填写；表单支持上传截图，提交后制作人会在飞书后台统一处理。' }),
      el('div', { className: 'cds-label', style: { marginTop: '12px' }, text: '问题描述与截图' }),
      cta,
      el('details', { className: 'cds-ridref', style: { marginTop: '12px' } }, [
        el('summary', { text: '查看会自动复制的诊断信息（不含密钥）' }),
        el('div', { className: 'cds-feedbackdiag', text: diag }),
      ]),
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '关闭' })]),
        el('button', { className: 'cds-btn', onclick: function () { copyText(diag, '诊断信息') } }, [icon('save'), el('span', { text: '只复制诊断信息' })]),
      ]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }

  function renderProducerPage() {
    clear(state.mainEl)
    var page = el('div', { className: 'cds-page' })
    page.appendChild(pageHead('制作人'))
    var card = el('div', { className: 'cds-panel pad' }, [
      el('div', { className: 'cds-producer' }, [
        el('div', { className: 'cds-producer-avatar' }, CREATOR.avatarUrl
          ? [el('img', { src: CREATOR.avatarUrl, alt: CREATOR.name, onerror: function (e) { e.target.style.display = 'none'; if (e.target.parentNode) e.target.parentNode.textContent = '明' } })]
          : [el('span', { text: '明' })]),
        el('div', {}, [
          el('div', { className: 'cds-eyebrow', text: 'CREATOR / 制作人' }),
          el('div', { className: 'cds-producer-name', text: CREATOR.name }),
          el('div', { className: 'cds-producer-uid', text: CREATOR.platform + ' · UID ' + CREATOR.uid }),
          el('div', { className: 'cds-producer-acts' }, [
            el('a', { className: 'cds-btn primary', href: CREATOR.spaceUrl, target: '_blank', rel: 'noopener noreferrer' }, [icon('external'), el('span', { text: '去 B 站关注 ' + CREATOR.name })]),
            el('button', { className: 'cds-btn', onclick: function () { copyText(CREATOR.uid, 'UID') } }, [el('span', { text: '复制 UID' })]),
          ]),
        ]),
      ]),
    ])
    page.appendChild(card)
    page.appendChild(el('div', { className: 'cds-note cds-disclaimer', style: { marginTop: '16px' } }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '免责声明' }),
      el('p', { text: '本插件是本地封面创作辅助工具，生成内容仅供学习、研究和个人创作参考。' }),
      el('p', { text: '使用者应自行确认所用图片、字体、角色、商标、视频封面等素材的版权与授权，不得用于侵权、冒充、虚假宣传、违法内容或商业冒充。AI 生成结果可能存在偏差，发布前请人工审核。' }),
      el('p', { text: '中转站 API 的费用、额度、稳定性和数据处理由使用者与对应服务商负责；插件不会把本地素材、项目数据或 API Key 上传到作者服务器。' }),
      el('p', { text: '因使用本插件、第三方中转站或生成内容产生的一切后果由使用者自行承担，作者不对第三方服务、生成内容及使用结果承担责任。第三方开源组件与模型遵循各自许可证。' }),
    ]))
    page.appendChild(el('div', { className: 'cds-note', style: { marginTop: '16px' } }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '关于这个项目' }),
      el('p', { text: '封面设计助手是一个安装在 DeepSeekHarness 里的本地插件：中转站生图、本地思源宋体排版、参考图学习、手动画布与抠图都在本机完成。安装、配置中转站和第一次使用说明见仓库 README。' }),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, [
        el('span', { className: 'cds-tag', text: '版本 v' + (state.version || '1.3.1') }),
        el('span', { className: 'cds-tag', text: 'License: MIT' }),
        el('span', { className: 'cds-tag', text: '数据只存本机' }),
        el('span', { className: 'cds-tag', text: 'API Key 不回显' }),
      ]),
    ]))
    state.mainEl.appendChild(page)
    if (Date.now() - (state.creatorRefreshedAt || 0) > 60000) {
      state.creatorRefreshedAt = Date.now()
      api('/creator/profile?refresh=1').then(function (data) {
        if (!data || !data.creator) return
        CREATOR = Object.freeze({ ...CREATOR, ...data.creator, immutable: true })
        if (state.tab === 'producer') renderProducerPage()
      }).catch(function () {})
    }
  }

  function ensureSettingsDraft() {
    if (!state.settings) return
    if (!state.settingsDraft) {
      state.settingsDraft = JSON.parse(JSON.stringify(state.settings))
      state.settingsDraft.mainModelApiKey = ''
      state.settingsDraft.clearMainKey = false
    }
    if (!state.relayDraft) {
      state.relayDraft = state.settings.relays.map(function (r) { return Object.assign({}, r, { apiKey: '', clearKey: false }) })
    }
  }

  function addProviderPreset(p) {
    ensureSettingsDraft()
    if (!state.relayDraft) return
    var exists = state.relayDraft.some(function (r) { return String(r.baseUrl || '').replace(/\/+$/, '') === p.baseUrl })
    if (exists) { toast('已经添加过「' + p.name + '」，直接填 Key 即可'); return }
    state.relayDraft.push({
      id: 'relay-' + Date.now().toString(36),
      name: p.name,
      baseUrl: p.baseUrl,
      protocol: 'openai-images',
      models: p.models.slice(),
      defaultModel: p.defaultModel,
      fallbackModels: [],
      size169: p.size169,
      size43: p.size43,
      size916: p.size916,
      size11: p.size11,
      quality: 'high',
      keySet: false,
      apiKey: '',
      clearKey: false,
    })
    renderSettingsPage()
    toast('已填入 ' + p.name + ' 的接口和模型，只需要填 API Key')
  }

  function renderSettingsPage() {
    ensureSettingsDraft()
    clear(state.mainEl)
    var s = state.settingsDraft
    var page = el('div', { className: 'cds-page' })
    page.appendChild(pageHead('设置', '主模型默认跟随 DSH 的 DeepSeekFlash；中转站可以配置多个，生成时自由选择。密钥只保存在本机，不会回显。'))
    var grid = el('div', { className: 'cds-settings' })
    var left = el('div')

    // appearance
    var ap = state.appearance || defaultAppearance()
    function themeOption(id, name, desc, accent) {
      return el('button', { className: 'cds-theme-option', 'data-on': ap.theme === id ? '1' : '0', onclick: function () {
        updateAppearance({
          theme: id,
          accent: accent,
          scheme: (id === 'film' || id === 'midnight') ? 'dark' : (id === 'guizang' || id === 'cream' || id === 'mono' ? 'light' : ap.scheme),
          radius: id === 'guizang' || id === 'mono' ? 2 : (id === 'film' || id === 'cream' ? 10 : 8),
        }, true)
      } }, [
        el('span', { className: 'cds-theme-swatch ' + id }),
        el('span', { className: 'cds-theme-name', text: name }),
        el('span', { className: 'cds-theme-desc', text: desc }),
      ])
    }
    left.appendChild(el('div', { className: 'cds-panel pad', style: { marginBottom: '14px' } }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '外观主题' }),
      el('div', { className: 'cds-hint', text: '纸感、胶片、午夜、极简黑白等主题；支持自定义强调色、明暗和圆角。主题只保存在本机浏览器。' }),
      el('div', { className: 'cds-theme-grid', style: { marginTop: '10px' } }, [
        themeOption('guizang', '素纸墨色', '纸白、墨黑、克莱因蓝、细线直角', '#002FA7'),
        themeOption('film', '深色胶片', '深灰底、金色强调、柔和圆角', '#E4B363'),
        themeOption('dsh', 'DSH 原生', '跟随 DSH 自己的明暗与品牌色', '#0169CC'),
        themeOption('cream', '奶油纸张', '暖白纸、棕墨、陶土色强调', '#B4552D'),
        themeOption('midnight', '午夜蓝调', '深蓝底、冷光、青蓝强调', '#6EA8FE'),
        themeOption('mono', '极简黑白', '纯灰阶、无彩强调、清晰层级', '#111111'),
      ]),
      el('div', { className: 'cds-row', style: { marginTop: '10px' } }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '强调色' }), el('input', { className: 'cds-input', type: 'color', value: ap.accent, oninput: function (e) { updateAppearance({ accent: e.target.value }) } })]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '明暗' }), el('div', { className: 'cds-ratio' }, ['light', 'dark'].map(function (v) {
          var disabled = ap.theme === 'film' || ap.theme === 'midnight' || ap.theme === 'dsh'
          var effectiveScheme = (ap.theme === 'film' || ap.theme === 'midnight') ? 'dark' : ap.scheme
          return el('button', { disabled: disabled, title: disabled ? (ap.theme === 'dsh' ? 'DSH 原生跟随 DSH 主题' : '这个主题固定为深色') : '', 'data-on': effectiveScheme === v ? '1' : '0', onclick: function () { updateAppearance({ scheme: v }, true) } }, [el('span', { text: v === 'light' ? '浅色' : '深色' })])
        }))]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '圆角 ' + ap.radius + 'px' }), el('input', { className: 'cds-input', type: 'range', min: '0', max: '16', step: '1', value: String(ap.radius), oninput: function (e) { updateAppearance({ radius: Number(e.target.value) }) } })]),
      ]),
    ]))

    // main model
    left.appendChild(el('div', { className: 'cds-panel pad', style: { marginBottom: '14px' } }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '主模型' }),
      el('div', { className: 'cds-hint', text: '主模型负责：理解主题、规划 1–6 张不同版式、识图分析参考图、按你的话修改。默认直接复用 DSH 当前配置的 DeepSeekFlash。' }),
      el('div', { className: 'cds-ratio', style: { marginTop: '10px' } }, [
        el('button', { 'data-on': s.mainModel.mode !== 'custom' ? '1' : '0', onclick: function () { s.mainModel.mode = 'dsh'; renderSettingsPage() } }, [el('span', { text: '跟随 DSH（推荐）' })]),
        el('button', { 'data-on': s.mainModel.mode === 'custom' ? '1' : '0', onclick: function () { s.mainModel.mode = 'custom'; renderSettingsPage() } }, [el('span', { text: '自定义 API' })]),
      ]),
      s.mainModel.mode !== 'custom' ? (function () {
        var dshModels = ((state.models && state.models.models) || []).map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || '') }).filter(Boolean)
        var dshReady = !!(s.mainModel.dshLlmAvailable || s.mainModel.dshKeyAvailable)
        var statusText = s.mainModel.dshLlmAvailable
          ? 'DSH 模型服务可用，插件会复用当前 DSH 模型，无需单独填 Key。'
          : (s.mainModel.dshKeyAvailable ? '已检测到 DSH 直连凭据，可作为备用。' : '未检测到 DSH 模型服务：请确认插件已在 DSH 内启用，或改用自定义 API。')
        return el('div', { style: { marginTop: '10px' } }, [
          el('div', { className: 'cds-row' }, [
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'Provider' }), el('input', { className: 'cds-input', value: s.mainModel.provider, oninput: function (e) { s.mainModel.provider = e.target.value } })]),
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'Model' }), el('input', { className: 'cds-input', value: s.mainModel.model, oninput: function (e) { s.mainModel.model = e.target.value } })]),
          ]),
          el('div', { className: 'cds-statusline ' + (dshReady ? 'ok' : 'warn') }, [el('span', { className: 'cds-dot ' + (dshReady ? 'on' : 'warn') }), el('span', { text: statusText })]),
          dshModels.length ? el('div', { className: 'cds-modelchips' }, dshModels.map(function (m) {
            return el('button', { type: 'button', className: 'cds-modelchip', 'data-on': s.mainModel.model === m ? '1' : '0', title: '使用 ' + m, onclick: function () { s.mainModel.model = m; renderSettingsPage(); toast('已选择 ' + m + '，点「保存设置」生效') } }, [el('span', { text: m })])
          })) : null,
          el('div', { className: 'cds-hint', text: dshReady ? '封面生成可直接复用 DSH 当前模型；识图/参考分析还需要可用的视觉模型 Key。' : '封面生成需要 DSH 模型服务；如果当前是独立预览，请改用自定义 API。' }),
          el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
            el('button', { className: 'cds-btn sm', onclick: testMain }, [icon('spark'), el('span', { text: '测试主模型' })]),
            el('button', { className: 'cds-btn sm', onclick: loadMainModels }, [icon('refresh'), el('span', { text: '读取 DSH 模型列表' })]),
          ]),
        ])
      })() : el('div', { style: { marginTop: '10px' } }, [
        el('div', { className: 'cds-row' }, [
          el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'Base URL' }), el('input', { className: 'cds-input', value: s.mainModel.baseUrl, placeholder: 'https://api.deepseek.com', oninput: function (e) { s.mainModel.baseUrl = e.target.value } })]),
          el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'Model' }), el('input', { className: 'cds-input', value: s.mainModel.model, placeholder: 'deepseek-flash', oninput: function (e) { s.mainModel.model = e.target.value } })]),
        ]),
        el('div', { className: 'cds-row' }, [
          el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '识图模型' }), el('input', { className: 'cds-input', value: s.mainModel.visionModel, placeholder: 'deepseek-flash', oninput: function (e) { s.mainModel.visionModel = e.target.value } })]),
          el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'API Key' }), el('input', { className: 'cds-input', type: 'password', placeholder: s.mainModel.customKeySet ? '已保存，留空不修改' : 'sk-…', value: s.mainModelApiKey || '', oninput: function (e) { s.mainModelApiKey = e.target.value } })]),
        ]),
        el('div', { className: 'cds-statusline ' + (s.mainModel.customKeySet || String(s.mainModelApiKey || '').trim() ? 'ok' : 'warn') }, [el('span', { className: 'cds-dot ' + (s.mainModel.customKeySet || String(s.mainModelApiKey || '').trim() ? 'on' : 'warn') }), el('span', { text: s.mainModel.customKeySet || String(s.mainModelApiKey || '').trim() ? '自定义主模型 Key 已填写。' : '还没有填写自定义 Key；生成时会自动回退到 DSH 模型。' })]),
        el('label', { className: 'cds-switch' }, [el('input', { type: 'checkbox', checked: !!s.clearMainKey, onchange: function (e) { s.clearMainKey = e.target.checked } }), el('span', { text: '清除已保存的自定义主模型 Key' })]),
        el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [el('button', { className: 'cds-btn sm', onclick: testMain }, [icon('spark'), el('span', { text: '测试主模型' })])]),
      ]),
    ]))

    // output
    left.appendChild(el('div', { className: 'cds-panel pad', style: { marginBottom: '14px' } }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '输出与行为' }),
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '封面保存位置' }), el('small', { text: '保存时自动复制 PNG + JPG' })]),
        el('div', { className: 'cds-output' }, [
          el('input', { className: 'cds-input', value: s.outputDir, oninput: function (e) { s.outputDir = e.target.value } }),
          el('button', { className: 'cds-btn', onclick: pickFolder }, [icon('folder'), el('span', { text: '浏览' })]),
          el('button', { className: 'cds-btn', onclick: function () { api('/open-folder', { method: 'POST', body: { which: 'output' } }).then(function (d) { toast('已打开：' + d.path) }).catch(function (e) { toast(e.message) }) } }, [icon('external'), el('span', { text: '打开' })]),
        ]),
      ]),
      el('div', { className: 'cds-field' }, [
        el('div', { className: 'cds-label' }, [el('span', { text: '视频封面下载目录' }), el('small', { text: '参考图库/分区抓取保存到这里' })]),
        el('div', { className: 'cds-output' }, [
          el('input', { className: 'cds-input', value: s.coverDownloadDir || '', oninput: function (e) { s.coverDownloadDir = e.target.value } }),
          el('button', { className: 'cds-btn', onclick: async function () { var p = await chooseFolder(s.coverDownloadDir); if (p) { s.coverDownloadDir = p; renderSettingsPage() } } }, [icon('folder'), el('span', { text: '浏览' })]),
        ]),
      ]),
      el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '默认张数' }), el('div', { className: 'cds-count' }, [1, 2, 3, 4, 5, 6].map(function (n) { return el('button', { 'data-on': Number(s.defaultCount) === n ? '1' : '0', onclick: function () { s.defaultCount = n; renderSettingsPage() } }, [el('span', { text: String(n) })]) }))]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '默认画幅' }), ratioPicker(s.defaultRatio, function (v) { s.defaultRatio = v; renderSettingsPage() })]),
      ]),
      el('label', { className: 'cds-switch' }, [el('input', { type: 'checkbox', checked: !!s.autoSave, onchange: function (e) { s.autoSave = e.target.checked } }), el('span', { text: '生成完成后自动复制到保存位置' })]),
      el('div', { className: 'cds-row', style: { marginTop: '12px' } }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '标题宋体字体文件' }), el('input', { className: 'cds-input', value: s.fontSerif, oninput: function (e) { s.fontSerif = e.target.value } })]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '副标题无衬线字体文件' }), el('input', { className: 'cds-input', value: s.fontSans, oninput: function (e) { s.fontSans = e.target.value } })]),
      ]),
      el('div', { className: 'cds-statusline', id: 'cds-fontstatus' }, [el('span', { className: 'cds-dot' }), el('span', { text: '字体在保存后重新加载；标题默认思源宋体 Heavy。' })]),
    ]))

    // relays
    left.appendChild(el('div', { className: 'cds-panel pad', style: { marginBottom: '14px' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
        el('div', { className: 'cds-h2', style: { margin: 0 }, text: '中转站 API' }),
        el('span', { className: 'cds-spacer', style: { flex: 1 } }),
        el('button', { className: 'cds-btn sm', onclick: function () {
          state.relayDraft.push({ id: 'relay-' + Date.now().toString(36), name: '新中转站', baseUrl: '', protocol: 'openai-images', models: [], defaultModel: '', fallbackModels: [], size169: '1536x1024', size43: '1536x1152', size916: '1024x1536', size11: '1024x1024', quality: 'high', keySet: false, apiKey: '', clearKey: false })
          renderSettingsPage()
        } }, [icon('plus'), el('span', { text: '添加中转站' })]),
      ]),
      el('div', { className: 'cds-hint', text: '支持 OpenAI Images 兼容的中转站。Base URL 填 API 接口地址，不是控制台网页地址，一般以 /v1 结尾（例如 https://api.example.com/v1）；填控制台地址会出现「测试 200 但没有模型」。Key 只保存在本机。' }),
      el('div', { className: 'cds-providers' }, IMAGE_PROVIDERS.map(function (p) {
        var present = (state.relayDraft || []).some(function (r) { return String(r.baseUrl || '').replace(/\/+$/, '') === p.baseUrl })
        return el('div', { className: 'cds-provider' + (present ? ' on' : '') }, [
          el('button', { className: 'cds-provider-main', type: 'button', onclick: function () { addProviderPreset(p) }, title: '点击预填 ' + p.baseUrl }, [
            el('span', { className: 'cds-provider-name', text: p.name }),
            el('span', { className: 'cds-provider-note', text: p.note }),
          ]),
          el('span', { className: 'cds-provider-links' }, [
            p.keyUrl ? el('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer', title: '打开官网获取 API Key' }, [el('span', { text: '拿 Key' })]) : null,
            p.docsUrl ? el('a', { href: p.docsUrl, target: '_blank', rel: 'noopener noreferrer', title: '打开官方文档' }, [el('span', { text: '文档' })]) : null,
          ]),
        ])
      }).concat([el('div', { className: 'cds-provider' }, [
        el('button', { className: 'cds-provider-main', type: 'button', onclick: function () {
          state.relayDraft.push({ id: 'relay-' + Date.now().toString(36), name: '自定义中转站', baseUrl: '', protocol: 'openai-images', models: [], defaultModel: '', fallbackModels: [], size169: '1536x1024', size43: '1536x1152', size916: '1024x1536', size11: '1024x1024', quality: 'high', keySet: false, apiKey: '', clearKey: false })
          renderSettingsPage()
        } }, [el('span', { className: 'cds-provider-name', text: '自定义中转站' }), el('span', { className: 'cds-provider-note', text: '任意 OpenAI 兼容接口' })]),
        el('span', { className: 'cds-provider-links' }, [el('span', { className: 'cds-provider-custom', text: '可加多个' })]),
      ])])),
      el('div', { style: { marginTop: '12px' } }, state.relayDraft.map(function (r, idx) {
        var prov = providerForRelay(r)
        return el('div', { className: 'cds-relay' }, [
          el('div', { className: 'cds-relayhead' }, [
            el('input', { className: 'cds-input', value: r.name, style: { maxWidth: '220px' }, oninput: function (e) { r.name = e.target.value } }),
            el('span', { className: 'cds-relaybadge ' + (r.keySet ? '' : 'off'), text: r.keySet ? 'Key 已保存' : '未填 Key' }),
            el('span', { style: { flex: 1 } }),
            prov && prov.keyUrl ? el('a', { className: 'cds-provider-inline', href: prov.keyUrl, target: '_blank', rel: 'noopener noreferrer' }, [el('span', { text: '官网拿 Key' })]) : null,
            prov && prov.docsUrl ? el('a', { className: 'cds-provider-inline', href: prov.docsUrl, target: '_blank', rel: 'noopener noreferrer' }, [el('span', { text: '文档' })]) : null,
            el('button', { className: 'cds-btn sm', onclick: async function () {
              s.defaultRelayId = r.id
              s.defaultModel = r.defaultModel || (r.models && r.models[0]) || ''
              await saveSettings(true)
              toast('已设为默认中转站')
            } }, [icon('check'), el('span', { text: '设为默认' })]),
            el('button', { className: 'cds-btn sm danger', onclick: async function () {
              var ok = await confirmDialog('删除这个中转站？', r.name, '删除', true)
              if (!ok) return
              state.relayDraft.splice(idx, 1)
              renderSettingsPage()
            } }, [icon('trash')]),
          ]),
          el('div', { className: 'cds-relaygrid' }, [
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'Base URL' }), el('input', { className: 'cds-input', value: r.baseUrl, placeholder: 'https://example.com/v1', oninput: function (e) { r.baseUrl = e.target.value } })]),
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: 'API Key' }), el('input', { className: 'cds-input', type: 'password', value: r.apiKey || '', placeholder: r.keySet ? '已保存，留空不修改' : 'sk-…', oninput: function (e) { r.apiKey = e.target.value } })]),
          ]),
          el('div', { className: 'cds-relaygrid', style: { marginTop: '8px' } }, [
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '模型（逗号分隔）' }), el('input', { className: 'cds-input', value: (r.models || []).join(', '), placeholder: 'gpt-image-2.6-sunburst, gpt-image-2.5', oninput: function (e) { r.models = e.target.value.split(',').map(function (x) { return x.trim() }).filter(Boolean) } })]),
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '默认模型' }), el('input', { className: 'cds-input', value: r.defaultModel || '', placeholder: 'gpt-image-2.6-sunburst', oninput: function (e) { r.defaultModel = e.target.value.trim() } })]),
          ]),
          el('div', { className: 'cds-relaygrid', style: { marginTop: '8px' } }, [
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '16:9 生成尺寸' }), el('input', { className: 'cds-input', value: r.size169, placeholder: '1536x1024', oninput: function (e) { r.size169 = e.target.value.trim() } })]),
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '4:3 生成尺寸' }), el('input', { className: 'cds-input', value: r.size43, placeholder: '1536x1152', oninput: function (e) { r.size43 = e.target.value.trim() } })]),
          ]),
          el('div', { className: 'cds-relaygrid', style: { marginTop: '8px' } }, [
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '9:16 生成尺寸' }), el('input', { className: 'cds-input', value: r.size916 || '1024x1536', placeholder: '1024x1536', oninput: function (e) { r.size916 = e.target.value.trim() } })]),
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '1:1 生成尺寸' }), el('input', { className: 'cds-input', value: r.size11 || '1024x1024', placeholder: '1024x1024', oninput: function (e) { r.size11 = e.target.value.trim() } })]),
          ]),
          el('div', { className: 'cds-relaygrid', style: { marginTop: '8px' } }, [
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '备用模型（逗号分隔）' }), el('input', { className: 'cds-input', value: (r.fallbackModels || []).join(', '), oninput: function (e) { r.fallbackModels = e.target.value.split(',').map(function (x) { return x.trim() }).filter(Boolean) } })]),
            el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '质量' }), el('input', { className: 'cds-input', value: r.quality || 'high', oninput: function (e) { r.quality = e.target.value.trim() } })]),
          ]),
          el('div', { className: 'cds-relayacts' }, [
            el('button', { className: 'cds-btn sm', onclick: async function () {
              await saveSettings(true)
              toast('正在测试…')
              try { var data = await api('/relay/test', { method: 'POST', body: { relayId: r.id } }); toast((data.result.ok ? '连接正常：' : '连接失败：') + (data.result.note || data.result.error || '')) } catch (err) { toast(err.message) }
            } }, [icon('spark'), el('span', { text: '测试连接' })]),
            el('button', { className: 'cds-btn sm', onclick: async function () {
              var relayId = r.id
              var saved = await saveSettings(true)
              if (!saved) return
              try {
                var data = await api('/relay/models', { method: 'POST', body: { relayId: relayId } })
                if (data.models && data.models.length) {
                  var draft = (state.relayDraft || []).find(function (x) { return x.id === relayId })
                  if (draft) {
                    draft.models = data.models
                    if (!draft.defaultModel || data.models.indexOf(draft.defaultModel) < 0) draft.defaultModel = data.models[0]
                  }
                  await saveSettings(true)
                  toast('已读取并保存 ' + data.models.length + ' 个模型')
                } else toast('这个站没有返回模型列表，可直接手填模型名')
              } catch (err) { toast('读取失败：' + err.message) }
            } }, [icon('refresh'), el('span', { text: '读取模型' })]),
            el('label', { className: 'cds-switch' }, [el('input', { type: 'checkbox', checked: !!r.clearKey, onchange: function (e) { r.clearKey = e.target.checked } }), el('span', { text: '清除 Key' })]),
          ]),
        ])
      })),
    ]))

    var saveBtn = el('button', { className: 'cds-btn primary', onclick: function () { saveSettings(false) } }, [icon('save'), el('span', { text: '保存设置' })])
    left.appendChild(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [saveBtn, el('span', { className: 'cds-hint', text: '保存后会重新加载字体并刷新模型状态。' })]))

    grid.appendChild(left)
    var side = el('div')
    side.appendChild(el('div', { className: 'cds-panel pad' }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '数据与扩展' }),
      el('div', { className: 'cds-hint', text: '项目和参考图都在 DSH 数据目录里，不上传云端。插件源码是普通工作区文件，DSH 可以直接修改和扩展。' }),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '11px' } }, [
        el('button', { className: 'cds-btn', onclick: function () { api('/open-folder', { method: 'POST', body: { which: 'data' } }).then(function (d) { toast('已打开：' + d.path) }).catch(function (e) { toast(e.message) }) } }, [icon('folder'), el('span', { text: '打开数据目录' })]),
        el('button', { className: 'cds-btn', onclick: function () { api('/open-folder', { method: 'POST', body: { which: 'output' } }).then(function (d) { toast('已打开：' + d.path) }).catch(function (e) { toast(e.message) }) } }, [icon('external'), el('span', { text: '打开保存目录' })]),
        el('button', { className: 'cds-btn', onclick: function () { loadState(true) } }, [icon('refresh'), el('span', { text: '刷新全部数据' })]),
      ]),
    ]))
    side.appendChild(el('div', { className: 'cds-panel pad', style: { marginTop: '14px' } }, [
      el('div', { className: 'cds-h2', style: { marginTop: 0 }, text: '当前状态' }),
      el('div', { className: 'cds-statusline ' + ((state.settings.mainModel.dshLlmAvailable || state.settings.mainModel.dshKeyAvailable) ? 'ok' : 'warn') }, [el('span', { className: 'cds-dot ' + ((state.settings.mainModel.dshLlmAvailable || state.settings.mainModel.dshKeyAvailable) ? 'on' : 'warn') }), el('span', { text: state.settings.mainModel.dshLlmAvailable ? 'DSH 主模型服务可用' : (state.settings.mainModel.dshKeyAvailable ? 'DSH 直连凭据可用' : 'DSH 主模型服务未检测到') })]),
      el('div', { className: 'cds-statusline' }, [el('span', { className: 'cds-dot' }), el('span', { text: '已保存中转站：' + state.settings.relays.filter(function (r) { return r.keySet }).length + ' / ' + state.settings.relays.length })]),
      el('div', { className: 'cds-statusline' }, [el('span', { className: 'cds-dot' }), el('span', { text: '项目：' + state.projects.length + ' · 参考图：' + referenceUploads().length })]),
    ]))
    grid.appendChild(side)
    page.appendChild(grid)
    state.mainEl.appendChild(page)
  }

  async function saveSettings(silent) {
    var s = state.settingsDraft
    var relays = state.relayDraft.map(function (r) {
      var copy = {}
      Object.keys(r).forEach(function (k) { if (k !== 'apiKey' && k !== 'clearKey' && k !== 'keySet') copy[k] = r[k] })
      if (r.apiKey && String(r.apiKey).trim()) copy.apiKey = String(r.apiKey).trim()
      if (r.clearKey) copy.clearKey = true
      return copy
    })
    var patch = {
      outputDir: s.outputDir,
      coverDownloadDir: s.coverDownloadDir,
      defaultCount: s.defaultCount,
      defaultRatio: s.defaultRatio,
      autoSave: s.autoSave,
      fontSerif: s.fontSerif,
      fontSans: s.fontSans,
      mainModel: s.mainModel,
      relays: relays,
      defaultRelayId: s.defaultRelayId,
      defaultModel: s.defaultModel,
    }
    if (s.mainModelApiKey && String(s.mainModelApiKey).trim()) patch.mainModelApiKey = String(s.mainModelApiKey).trim()
    if (s.clearMainKey) patch.clearMainKey = true
    try {
      var data = await api('/state.json', { method: 'POST', body: patch })
      state.settings = data.settings
      state.settingsDraft = null
      state.relayDraft = null
      reloadFontFaces()
      await loadState(true)
      if (!silent) toast('设置已保存')
      return true
    } catch (err) {
      toast('保存失败：' + err.message)
      return false
    }
  }

  function reloadFontFaces() {
    var node = document.getElementById('dsh-cover-studio-fonts')
    if (!node) return
    var v = Date.now()
    node.textContent =
      '@font-face{font-family:"Cover Serif";src:url("' + API + '/fonts/serif?v=' + v + '") format("truetype");font-weight:900;font-style:normal;font-display:swap;}' +
      '@font-face{font-family:"Cover Serif";src:url("' + API + '/fonts/serif?v=' + v + '") format("truetype");font-weight:400;font-style:normal;font-display:swap;}' +
      '@font-face{font-family:"Cover Sans";src:url("' + API + '/fonts/sans?v=' + v + '") format("truetype");font-weight:400 700;font-style:normal;font-display:swap;}'
  }


  function installCustomFonts(fonts) {
    if (!window.FontFace || !document.fonts) return
    state.installedFonts = state.installedFonts || {}
    ;(fonts || []).forEach(function (f) {
      if (!f || !f.family || state.installedFonts[f.id]) return
      try {
        var src = f.url || (API + '/fonts/custom/' + encodeURIComponent(f.id))
        if (src.charAt(0) !== '/') src = API + src
        var face = new FontFace(f.family, 'url("' + src + '")')
        face.load().then(function (loaded) {
          document.fonts.add(loaded)
          state.installedFonts[f.id] = true
        }).catch(function () {})
      } catch (e) {}
    })
  }

  async function chooseFolder(initial) {
    try {
      var data = await api('/pick-folder', { method: 'POST', body: { initial: initial || '' } })
      return data.path || ''
    } catch (err) { toast('无法打开选择器：' + err.message); return '' }
  }

  function referenceUploads() {
    var picked = (state.form && Array.isArray(state.form.referenceIds)) ? state.form.referenceIds : []
    var sectionRefs = new Set()
    ;((state.settings && state.settings.sections) || []).forEach(function (sec) {
      ;(sec.refs || []).forEach(function (r) { if (r.uploadId) sectionRefs.add(r.uploadId) })
      ;(sec.types || []).forEach(function (t) { if (t.refUploadId) sectionRefs.add(t.refUploadId) })
    })
    return (state.uploads || []).filter(function (u) {
      if (picked.indexOf(u.id) >= 0) return true
      if (state.uploadSel && state.uploadSel.indexOf(u.id) >= 0) return true
      if (u.platform === 'cutout' || u.platform === 'inspire') return false
      if (u.inReferenceLibrary === false) return false
      if (u.temporary && u.inReferenceLibrary !== true) return false
      if (sectionRefs.has(u.id) && u.inReferenceLibrary !== true) return false
      return true
    })
  }

  function uploadById(id) {
    return state.uploads.find(function (u) { return u.id === id })
  }

  async function findAiImages() {
    var q = await promptDialog('让 AI 找图', '描述你希望参考的画面/人物/氛围', '例如：官方主视觉 群像 蓝色夜景')
    if (!q) return
    toast('正在搜索并下载参考图…')
    try {
      var data = await api('/search/images', { method: 'POST', body: { query: q, count: 8, page: 1 } })
      await loadState(true)
      ;(data.uploads || []).forEach(function (u) {
        if (!state.form.referenceIds.includes(u.id)) state.form.referenceIds.push(u.id)
      })
      renderCreatePage()
      toast('已加入 ' + ((data.uploads || []).length) + ' 张参考图；需要当底图时点缩略图上的“底图”')
    } catch (err) { toast('找图失败：' + err.message) }
  }

  async function handleDocuments(files) {
    var list = Array.prototype.slice.call(files || [])
    if (!list.length) return
    for (var i = 0; i < list.length; i++) {
      var file = list[i]
      if (file.size > 14 * 1024 * 1024) { toast(file.name + ' 超过 14MB'); continue }
      var fd = new FormData()
      fd.append('file', file, file.name)
      toast('正在读取 ' + file.name + '…')
      try {
        var data = await api('/document', { method: 'POST', body: fd })
        state.form.documents = (state.form.documents || []).filter(function (d) { return d.name !== data.name })
        state.form.documents.push({ name: data.name, text: data.text, chars: data.chars, kind: data.kind })
        toast('已读取 ' + data.name + '（' + data.chars + ' 字）')
      } catch (err) { toast('读取失败：' + err.message) }
    }
    renderCreatePage()
  }

  async function makeInspiration() {
    if (state.inspireBusy) return
    if (!state.form.brief.trim() && !state.form.title.trim()) { toast('先写一下主题或标题，AI 才有方向'); return }
    state.inspireBusy = true
    toast('AI 正在想 4 个不同的封面方向…')
    try {
      var data = await api('/inspire', { method: 'POST', body: {
        brief: state.form.brief, title: state.form.title, subtitle: state.form.subtitle,
        ratio: state.form.ratio, styles: state.form.styles,
        documentText: (state.form.documents || []).map(function (d) { return d.text }).join('\n\n'),
      } })
      state.inspire = data.directions || []
      state.uploads = data.uploads || state.uploads
      renderCreatePage()
      toast('灵感板已生成')
    } catch (err) { toast('生成灵感板失败：' + err.message) }
    finally { state.inspireBusy = false }
  }

  function applyDirection(dir) {
    if (!dir) return
    if (dir.title) state.form.title = dir.title
    if (dir.subtitle) state.form.subtitle = dir.subtitle
    if (dir.styleId) {
      state.form.styles = state.form.styles.filter(function (id) { return id !== 'exclusive' })
      if (!state.form.styles.includes(dir.styleId)) state.form.styles.push(dir.styleId)
    }
    state.form.customStyle = [dir.visual, dir.composition, dir.why].filter(Boolean).join('；')
    if (dir.uploadId && !state.form.referenceIds.includes(dir.uploadId)) state.form.referenceIds.push(dir.uploadId)
    renderCreatePage()
    toast('已填入方向：' + dir.name)
  }

  function renderInspiration() {
    if (!state.inspire || !state.inspire.length) return null
    var wrap = el('div', { style: { marginTop: '16px' } })
    wrap.appendChild(el('div', { className: 'cds-resulthead' }, [el('h2', { text: 'AI 灵感板' }), el('span', { className: 'cds-tag', text: '构图草图 · 不是最终画面' }), el('span', { className: 'cds-spacer' }), el('button', { className: 'cds-btn sm', onclick: function () { state.inspire = null; renderCreatePage() } }, [el('span', { text: '收起' })])]))
    var grid = el('div', { className: 'cds-results' })
    state.inspire.forEach(function (d) {
      grid.appendChild(el('div', { className: 'cds-card' }, [
        el('div', { className: 'cds-cardimg', style: { cursor: 'pointer' }, onclick: function () { if (d.sketchUrl) previewDialog(d.sketchUrl, d.name) } }, [
          d.sketchUrl ? el('img', { src: d.sketchUrl, alt: d.name }) : el('div', { className: 'cds-empty', style: { minHeight: '100px' } }, [el('span', { text: '草图渲染失败' })]),
          el('div', { className: 'cds-cardbadges' }, [el('span', { className: 'cds-badge ok', text: d.name || '方向' }), el('span', { className: 'cds-badge', text: d.layoutId || '' })]),
        ]),
        el('div', { className: 'cds-cardbody' }, [
          el('div', { className: 'cds-cardtitle', text: d.title || '未命名' }),
          el('div', { className: 'cds-cardmeta', text: (d.subtitle || '').slice(0, 36) }),
          el('div', { className: 'cds-hint', text: d.why || d.composition || '', style: { fontSize: '11px' } }),
          el('div', { className: 'cds-cardacts' }, [
            el('button', { className: 'cds-btn sm primary', onclick: function () { applyDirection(d) } }, [icon('check'), el('span', { text: '用这个方向' })]),
            el('button', { className: 'cds-btn sm', onclick: function () { applyDirection(d); setTimeout(generate, 120) } }, [icon('spark'), el('span', { text: '直接生成这版' })]),
            d.uploadId ? el('button', { className: 'cds-btn sm', onclick: function () {
              if (!state.form.referenceIds.includes(d.uploadId)) state.form.referenceIds.push(d.uploadId)
              toast('已加入参考图；需要底图时在缩略图上点“底图”')
            } }, [el('span', { text: '设为参考' })]) : null,
          ]),
        ]),
      ]))
    })
    wrap.appendChild(grid)
    return wrap
  }

  async function testMain() {
    await saveSettings(true)
    toast('正在测试主模型…')
    try {
      var data = await api('/main/test', { method: 'POST', body: {} })
      var r = data.result || {}
      toast(r.ok ? '主模型可用（' + r.via + ' / ' + r.model + '，' + r.latencyMs + 'ms）' : '主模型失败：' + (r.error || ''))
    } catch (err) { toast(err.message) }
  }

  async function loadMainModels() {
    try {
      var data = await api('/main/models')
      state.models = data
      if (data.source === 'dsh') {
        if (state.settings && state.settings.mainModel) state.settings.mainModel.dshLlmAvailable = true
        if (state.settingsDraft) state.settingsDraft.mainModel.dshLlmAvailable = true
      }
      var models = (data.models || []).map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || '') }).filter(Boolean)
      if (state.settingsDraft) {
        var providers = (data.providers || []).map(function (p) { return typeof p === 'string' ? p : (p.id || p.name || '') }).filter(Boolean)
        if (providers.length && providers.indexOf(state.settingsDraft.mainModel.provider) < 0) state.settingsDraft.mainModel.provider = providers[0]
        if (models.length && (!state.settingsDraft.mainModel.model || models.indexOf(state.settingsDraft.mainModel.model) < 0)) state.settingsDraft.mainModel.model = models[0]
      }
      toast(models.length ? '可用模型：' + models.join('、') : 'DSH 没有返回模型目录')
      renderSettingsPage()
    } catch (err) { toast(err.message) }
  }

  async function pickFolder() {
    toast('正在打开文件夹选择器…')
    try {
      var data = await api('/pick-folder', { method: 'POST', body: {} })
      if (data.path) { state.settingsDraft.outputDir = data.path; renderSettingsPage(); toast('已选择：' + data.path) }
      else toast('没有选择文件夹')
    } catch (err) { toast('无法打开选择器，请直接输入路径：' + err.message) }
  }

  // ───────────────────────────── 外壳 ─────────────────────────────

  function bindWindowDrag(handle) {
    if (!handle) return
    handle.style.cursor = 'grab'
    handle.addEventListener('mousedown', function (e) {
      var win = state.windowEl
      var overlay = state.overlay
      if (!win || !overlay || e.button !== 0 || state.maximized) return
      if (e.target.closest('button, input, textarea, select, a, .cds-edcanvasbox')) return
      e.preventDefault()
      var startX = e.clientX
      var startY = e.clientY
      var r = win.getBoundingClientRect()
      var or = overlay.getBoundingClientRect()
      var startLeft = r.left - or.left
      var startTop = r.top - or.top
      var width = r.width
      var height = r.height
      var dx = 0
      var dy = 0
      var lastLeft = startLeft
      var lastTop = startTop
      var raf = 0
      var moved = false
      win.style.position = 'absolute'
      win.style.margin = '0'
      win.style.width = width + 'px'
      win.style.height = height + 'px'
      win.style.left = startLeft + 'px'
      win.style.top = startTop + 'px'
      win.style.willChange = 'transform'
      overlay.classList.add('cds-dragging')
      handle.style.cursor = 'grabbing'
      document.body.style.cursor = 'grabbing'
      function paint() {
        raf = 0
        win.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)'
      }
      function move(ev) {
        dx = Math.max(4 - startLeft, Math.min(or.width - width - 4 - startLeft, ev.clientX - startX))
        dy = Math.max(4 - startTop, Math.min(or.height - height - 4 - startTop, ev.clientY - startY))
        lastLeft = startLeft + dx
        lastTop = startTop + dy
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
        if (!raf) raf = requestAnimationFrame(paint)
      }
      function up() {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        if (raf) { cancelAnimationFrame(raf); raf = 0 }
        win.style.transform = ''
        win.style.willChange = ''
        win.style.left = lastLeft + 'px'
        win.style.top = lastTop + 'px'
        overlay.classList.remove('cds-dragging')
        handle.style.cursor = 'grab'
        document.body.style.cursor = ''
        if (moved) {
          try {
            var now = win.getBoundingClientRect()
            var root = overlay.getBoundingClientRect()
            localStorage.setItem('cds-window-size', JSON.stringify({
              w: Math.round(now.width), h: Math.round(now.height),
              left: Math.round(now.left - root.left), top: Math.round(now.top - root.top),
            }))
          } catch (e2) {}
        }
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  }

  function placeMinipill(pill) {
    var saved = null
    try { saved = JSON.parse(localStorage.getItem('cds-minipill-pos') || 'null') } catch {}
    if (!saved || !Number.isFinite(Number(saved.left)) || !Number.isFinite(Number(saved.top))) return
    var r = pill.getBoundingClientRect()
    var w = r.width || 150
    var h = r.height || 42
    pill.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, Number(saved.left))) + 'px'
    pill.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, Number(saved.top))) + 'px'
    pill.style.right = 'auto'
    pill.style.bottom = 'auto'
  }

  function bindMinipillDrag(pill) {
    pill.style.touchAction = 'none'
    pill.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      var r = pill.getBoundingClientRect()
      var startX = e.clientX
      var startY = e.clientY
      var startLeft = r.left
      var startTop = r.top
      var width = r.width
      var height = r.height
      var moved = false
      pill.style.right = 'auto'
      pill.style.bottom = 'auto'
      pill.style.left = startLeft + 'px'
      pill.style.top = startTop + 'px'
      pill.classList.add('is-dragging')
      pill.setPointerCapture && pill.setPointerCapture(e.pointerId)
      function move(ev) {
        var left = startLeft + ev.clientX - startX
        var top = startTop + ev.clientY - startY
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true
        pill.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, left)) + 'px'
        pill.style.top = Math.max(8, Math.min(window.innerHeight - height - 8, top)) + 'px'
      }
      function up(ev) {
        pill.removeEventListener('pointermove', move)
        pill.removeEventListener('pointerup', up)
        pill.removeEventListener('pointercancel', up)
        pill.releasePointerCapture && pill.releasePointerCapture(ev.pointerId)
        pill.classList.remove('is-dragging')
        if (!moved) {
          restoreStudio()
          return
        }
        pill._cdsMovedAt = Date.now()
        try { localStorage.setItem('cds-minipill-pos', JSON.stringify({ left: Math.round(pill.getBoundingClientRect().left), top: Math.round(pill.getBoundingClientRect().top) })) } catch {}
      }
      pill.addEventListener('pointermove', move)
      pill.addEventListener('pointerup', up)
      pill.addEventListener('pointercancel', up)
    })
  }

  function minimizeStudio() {
    var overlay = state.overlay
    var win = state.windowEl
    if (!overlay || !win) return
    overlay.classList.add('cds-minimized')
    var pill = document.querySelector('.cds-minipill')
    if (!pill) {
      pill = el('button', { className: 'cds-minipill', title: '拖动可移动 · 单击恢复封面设计助手', onclick: function () {
        if (pill._cdsMovedAt && Date.now() - pill._cdsMovedAt < 350) return
        restoreStudio()
      } }, [el('img', { src: API + '/icon.svg', alt: '' }), el('span', { text: '封面设计助手' }), el('span', { className: 'cds-minipill-grip', text: '⠿' })])
      bindMinipillDrag(pill)
      document.body.appendChild(pill)
      placeMinipill(pill)
    }
  }

  function restoreStudio() {
    var overlay = state.overlay
    if (!overlay) return
    overlay.classList.remove('cds-minimized')
    var pill = document.querySelector('.cds-minipill')
    if (pill) pill.remove()
  }

  function renderShell() {
    state.maximized = false
    var overlay = el('div', { id: 'cds-overlay' })
    var win = el('div', { id: 'cds-window' })
    var titlebar = el('div', { className: 'cds-titlebar' }, [
      el('div', { className: 'cds-brand' }, [el('img', { src: API + '/icon.svg', alt: '' })]),
      el('div', {}, [el('div', { className: 'cds-title', text: '封面设计助手' }), el('div', { className: 'cds-subtitle', text: '官方原画 · 默认风格 · 可编辑画布' })]),
      el('div', { className: 'cds-spacer' }),
      el('button', { className: 'cds-btn sm primary', style: { marginRight: '4px' }, title: '用当前设置生成封面', onclick: function () {
        if (state.tab !== 'create') switchTab('create')
        setTimeout(generate, 60)
      } }, [icon('spark'), el('span', { text: '生成' })]),
      el('button', { className: 'cds-iconbtn', title: '刷新', onclick: function () { loadState(true) } }, [icon('refresh')]),
      el('button', { className: 'cds-iconbtn', title: '最大化 / 还原（双击标题栏也可以）', 'data-maxbtn': '1', onclick: function () { toggleMaximize() } }, [icon('maximize')]),
      el('button', { className: 'cds-iconbtn', title: '最小化到右下角', onclick: function () { minimizeStudio() } }, [el('span', { style: { fontSize: '18px', lineHeight: '16px' }, text: '—' })]),
      el('button', { className: 'cds-iconbtn', title: '关闭', onclick: closeStudio }, [icon('close')]),
    ])
    var body = el('div', { className: 'cds-body' })
    var nav = el('div', { className: 'cds-sidebar' })
    var navItems = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } })
    var foot = el('div', { className: 'cds-sidefoot' })
    nav.appendChild(navItems)
    nav.appendChild(foot)
    var main = el('div', { className: 'cds-main' })
    body.appendChild(nav)
    body.appendChild(main)
    win.appendChild(titlebar)
    win.appendChild(body)
    var minW = 980
    var minH = 620
    function maxBounds() {
      var or = overlay.getBoundingClientRect()
      return { w: Math.max(minW, or.width - 44), h: Math.max(minH, or.height - 44), left: 22, top: 22, right: or.width - 22, bottom: or.height - 22 }
    }
    function applySavedRect() {
      try {
        var saved = JSON.parse(localStorage.getItem('cds-window-size') || 'null')
        if (!saved) return
        var b = maxBounds()
        var w = Math.max(minW, Math.min(b.w, Number(saved.w) || 0))
        var h = Math.max(minH, Math.min(b.h, Number(saved.h) || 0))
        if (!w || !h) return
        win.style.width = w + 'px'
        win.style.height = h + 'px'
        if (Number.isFinite(Number(saved.left)) && Number.isFinite(Number(saved.top))) {
          var left = Math.max(22, Math.min(b.right - w, Number(saved.left)))
          var top = Math.max(22, Math.min(b.bottom - h, Number(saved.top)))
          win.style.position = 'absolute'
          win.style.margin = '0'
          win.style.left = left + 'px'
          win.style.top = top + 'px'
        }
      } catch (e) {}
    }
    function saveRect() {
      var r = win.getBoundingClientRect()
      var or = overlay.getBoundingClientRect()
      if (r.width < 300 || r.height < 200) return
      try {
        localStorage.setItem('cds-window-size', JSON.stringify({
          w: Math.round(r.width), h: Math.round(r.height),
          left: Math.round(r.left - or.left), top: Math.round(r.top - or.top),
        }))
      } catch {}
    }
    function toggleMaximize() {
      if (!state.maximized) {
        var r = win.getBoundingClientRect()
        state.normalRect = { left: r.left, top: r.top, w: r.width, h: r.height }
        state.maximized = true
        win.classList.add('max')
        win.style.position = ''
        win.style.left = ''
        win.style.top = ''
        win.style.width = ''
        win.style.height = ''
        win.style.margin = ''
      } else {
        state.maximized = false
        win.classList.remove('max')
        if (state.normalRect) {
          var or = overlay.getBoundingClientRect()
          var b = maxBounds()
          var nw = Math.max(minW, Math.min(b.w, state.normalRect.w))
          var nh = Math.max(minH, Math.min(b.h, state.normalRect.h))
          win.style.position = 'absolute'
          win.style.margin = '0'
          win.style.width = nw + 'px'
          win.style.height = nh + 'px'
          win.style.left = Math.max(22, Math.min(b.right - nw, state.normalRect.left - or.left)) + 'px'
          win.style.top = Math.max(22, Math.min(b.bottom - nh, state.normalRect.top - or.top)) + 'px'
        }
        if (state.editor) fitEditorCanvas()
      }
      var btn = titlebar.querySelector('[data-maxbtn]')
      if (btn) { btn.innerHTML = ''; btn.appendChild(icon(state.maximized ? 'restore' : 'maximize')) }
    }
    ;['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (dir) {
      var handle = el('div', { className: 'cds-rz cds-rz-' + dir, title: '拖动调整窗口大小' })
      handle.addEventListener('mousedown', function (e) {
        if (state.maximized) return
        e.preventDefault()
        e.stopPropagation()
        var startX = e.clientX
        var startY = e.clientY
        var r = win.getBoundingClientRect()
        var or = overlay.getBoundingClientRect()
        var start = { left: r.left - or.left, top: r.top - or.top, w: r.width, h: r.height }
        var b = maxBounds()
        win.style.position = 'absolute'
        win.style.margin = '0'
        win.style.width = start.w + 'px'
        win.style.height = start.h + 'px'
        win.style.left = start.left + 'px'
        win.style.top = start.top + 'px'
        function move(ev) {
          var dx = ev.clientX - startX
          var dy = ev.clientY - startY
          var left = start.left
          var top = start.top
          var width = start.w
          var height = start.h
          if (dir.includes('e')) width = start.w + dx
          if (dir.includes('s')) height = start.h + dy
          if (dir.includes('w')) { width = start.w - dx; left = start.left + dx }
          if (dir.includes('n')) { height = start.h - dy; top = start.top + dy }
          if (width < minW) { if (dir.includes('w')) left = start.left + (start.w - minW); width = minW }
          if (height < minH) { if (dir.includes('n')) top = start.top + (start.h - minH); height = minH }
          if (left < 12) { width += left - 12; left = 12 }
          if (top < 12) { height += top - 12; top = 12 }
          if (left + width > b.right + 22) width = b.right + 22 - left
          if (top + height > b.bottom + 22) height = b.bottom + 22 - top
          width = Math.max(minW, Math.min(width, b.right + 22 - left))
          height = Math.max(minH, Math.min(height, b.bottom + 22 - top))
          win.style.left = left + 'px'
          win.style.top = top + 'px'
          win.style.width = width + 'px'
          win.style.height = height + 'px'
        }
        function up() {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
          document.body.style.cursor = ''
          saveRect()
          if (state.editor) fitEditorCanvas()
        }
        document.body.style.cursor = getComputedStyle(handle).cursor
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
      })
      win.appendChild(handle)
    })
    titlebar.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) toggleMaximize() })
    bindWindowDrag(titlebar)
    try {
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          if (state.maximized) return
          var r = win.getBoundingClientRect()
          if (r.width > 400 && r.height > 300) localStorage.setItem('cds-window-size', JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }))
        })
        ro.observe(win)
      }
    } catch (e) {}
    overlay.appendChild(win)
    document.body.appendChild(overlay)
    state.overlay = overlay
    state.windowEl = win
    state.mainEl = main
    state.navEl = navItems
    state.footEl = foot
    applySavedRect()
    applyAppearance()
    state.keyHandler = function (e) {
      if (e.key !== 'Escape') return
      if (state.editor) { e.preventDefault(); closeEditor(false); return }
      if (state.overlay && state.overlay.style.display !== 'none') { e.preventDefault(); closeStudio() }
    }
    document.addEventListener('keydown', state.keyHandler)
    showLoading('正在连接封面设计助手…')
    loadState(true)
  }

  function closeStudio() {
    if (state.jobTimer) { clearInterval(state.jobTimer); state.jobTimer = null }
    if (state.editor) closeEditor(true)
    var mini = document.querySelector('.cds-minipill')
    if (mini) mini.remove()
    if (state.overlay && state.overlay.parentNode) state.overlay.parentNode.removeChild(state.overlay)
    if (state.keyHandler) document.removeEventListener('keydown', state.keyHandler)
    state.overlay = null
    state.windowEl = null
    state.mainEl = null
    state.navEl = null
    state.footEl = null
    state.toastEl = null
    if (typeof state.onClose === 'function') state.onClose()
  }

  // ───────────────────────────── 画布编辑器 ─────────────────────────────
  // 说明：文字和基础形状会以图层形式保存，可再次编辑；铅笔、荧光笔、箭头会烘焙进导出图。
  //       这是为了保证导出图和屏幕所见一致，同时不引入额外的路径渲染依赖。

  var FONT_MAP = { CoverSerif: 'Cover Serif', CoverSans: 'Cover Sans' }
  var FONT_MAP_REV = { 'Cover Serif': 'CoverSerif', 'Cover Sans': 'CoverSans' }

  function showTemplatePromptModal(project) {
    if (!project) return
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var prompt = String(project.templatePrompt || '').trim()
    var style = String(project.templateStyleSummary || '').trim()
    var subject = String(project.templateSubjectDescription || '').trim()
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '700px' } }, [
      el('h3', { text: '参考封面的反推提示词' }),
      el('p', { text: '这是从原封面拆出来的画面/版式描述。可以复制去别的生图工具，也可以直接在这个模板里改字，或用「AI 重绘 / 换人物」重新生成画面。' }),
      style ? el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '风格与版式拆解' }), el('div', { className: 'cds-hint', style: { whiteSpace: 'pre-wrap' }, text: style })]) : null,
      subject ? el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '主体描述' }), el('div', { className: 'cds-hint', text: subject })]) : null,
      el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label' }, [el('span', { text: '生图提示词' }), el('button', { className: 'cds-btn ghost sm', onclick: function () { copyText(prompt, '提示词') } }, [el('span', { text: '复制' })])]), el('textarea', { className: 'cds-textarea cds-replicaprompt', readonly: true }, [prompt || '这条模板没有生成额外的画面提示词，可以直接编辑画布。'])]),
      el('div', { className: 'cds-dialogacts' }, [el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '关闭' })])]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }

  async function openEditor(projectId, options) {
    options = options || {}
    if (!state.windowEl) return
    var data
    try { data = await api('/projects/' + encodeURIComponent(projectId)) } catch (err) { toast('打开失败：' + err.message); return }
    var project = data.project
    if (!project) { toast('项目不存在'); return }
    if (!window.fabric) { toast('Fabric 还没加载完，请稍等'); return }
    if (state.editor) closeEditor(true)
    try { await document.fonts.load('900 100px "Cover Serif"') } catch (e) {}
    var ed = el('div', { className: 'cds-editor' })
    var top = el('div', { className: 'cds-edtop' }, [
      el('button', { className: 'cds-iconbtn', title: '返回', onclick: function () { closeEditor(false) } }, [icon('left')]),
      el('div', {}, [el('div', { className: 'cds-edtitle', text: project.title || '未命名封面' }), el('div', { className: 'cds-edmeta', text: (project.styleName || project.styleId || '') + ' · ' + (project.ratio || '') + ' · ' + (project.layoutId || '') })]),
      el('div', { className: 'cds-spacer', style: { flex: 1 } }),
      el('button', { className: 'cds-btn sm', id: 'cds-undo', title: '撤销', onclick: function () { editorUndo() } }, [icon('undo')]),
      el('button', { className: 'cds-btn sm', title: '重做', onclick: function () { editorRedo() } }, [icon('redo')]),
      el('span', { style: { width: '6px' } }),
      project.manual ? el('button', { className: 'cds-btn sm', onclick: editorHandoff }, [icon('spark'), el('span', { text: '交给 AI 继续完善' })]) : null,
      project.templateFromUpload ? el('button', { className: 'cds-btn sm', onclick: function () { showTemplatePromptModal(project) } }, [icon('spark'), el('span', { text: '反推提示词' })]) : null,
      project.templateFromUpload ? el('button', { className: 'cds-btn sm', onclick: openAiRemixDialog }, [icon('spark'), el('span', { text: 'AI 重绘 / 换人物' })]) : null,
      el('button', { className: 'cds-btn sm', onclick: editorExport }, [icon('download'), el('span', { text: '保存到文件夹' })]),
      el('button', { className: 'cds-btn sm primary', onclick: function () { editorSave() } }, [icon('save'), el('span', { text: '保存项目' })]),
      el('button', { className: 'cds-iconbtn', title: '最小化到右下角', onclick: function () { minimizeStudio() } }, [el('span', { style: { fontSize: '18px', lineHeight: '16px' }, text: '—' })]),
      el('button', { className: 'cds-iconbtn', title: '关闭', onclick: function () { closeEditor(false) } }, [icon('close')]),
    ])
    bindWindowDrag(top)
    var body = el('div', { className: 'cds-edbody' })
    var tools = el('div', { className: 'cds-edtools' })
    var stage = el('div', { className: 'cds-edstage' })
    var wrap = el('div', { className: 'cds-edcanvaswrap' })
    var canvasBox = el('div', { className: 'cds-edcanvasbox' })
    var brushDock = el('div', { className: 'cds-brushdock' })
    var canvasEl = el('canvas', { id: 'cds-fcanvas' })
    canvasBox.appendChild(canvasEl)
    wrap.appendChild(canvasBox)
    var zoomLabel = el('span', { className: 'cds-zoomlabel', text: '100%' })
    var zoomBar = el('div', { className: 'cds-zoombar' }, [
      el('button', { title: '缩小', onclick: function () { setEditorZoom(0.85) } }, [el('span', { text: '−' })]),
      zoomLabel,
      el('button', { title: '放大', onclick: function () { setEditorZoom(1.18) } }, [el('span', { text: '+' })]),
      el('button', { title: '把画布居中', onclick: function () { centerEditorCanvas() } }, [el('span', { text: '居中' })]),
      el('button', { title: '恢复 100% 并让画布回到视野中央', onclick: function () { resetEditorZoom() } }, [el('span', { text: '适应' })]),
    ])
    wrap.appendChild(zoomBar)
    var aiBar = el('div', { className: 'cds-edaibar', style: { position: 'relative', zIndex: '7', pointerEvents: 'auto' } })
    var aiInput = el('input', { className: 'cds-input', tabindex: '0', placeholder: '直接说修改要求，例如：主标题放大一点，副标题改成两行，标题往右移……', onkeydown: function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); editorAiEdit(aiInput.value) } } })
    var aiStatus = el('span', { className: 'cds-edaistatus', text: '选中文字/图层后可以说修改要求；Enter 发送' })
    aiInput.style.pointerEvents = 'auto'
    aiBar.appendChild(aiInput)
    aiBar.appendChild(aiStatus)
    aiBar.appendChild(el('button', { className: 'cds-btn primary sm', onclick: function () { editorAiEdit(aiInput.value) } }, [icon('spark'), el('span', { text: 'AI 修改' })]))
    aiBar.appendChild(el('button', { className: 'cds-btn sm', onclick: function () { aiInput.value = '主标题放大 10%，副标题保持两行，整体更简洁'; aiInput.focus(); aiInput.setSelectionRange(aiInput.value.length, aiInput.value.length); aiStatus.textContent = '已填入示例，可继续修改或直接发送'; } }, [el('span', { text: '示例' })]))
    aiBar.addEventListener('mousedown', function (e) { if (e.target === aiBar) { e.preventDefault(); aiInput.focus() } })
    stage.appendChild(wrap)
    stage.appendChild(brushDock)
    stage.appendChild(aiBar)
    var props = el('div', { className: 'cds-edprops' })
    body.appendChild(tools)
    body.appendChild(stage)
    body.appendChild(props)
    ed.appendChild(top)
    ed.appendChild(body)
    state.windowEl.appendChild(ed)
    state.editor = { project: project, manual: !!project.manual, assets: options.assets || [], canvas: null, scale: 1, displayW: 0, displayH: 0, targetW: 0, targetH: 0, dirty: false, undo: [], redo: [], active: null, tool: 'select', shapeStart: null, shapeEnd: null, temp: null, editorEl: ed, propsEl: props, toolsEl: tools, aiInput: aiInput, aiStatus: aiStatus, canvasEl: canvasEl, canvasBox: canvasBox, brushDock: brushDock, saving: false, imageInput: null, cutTarget: null, boxStart: null, boxTemp: null, layerDrag: null, busy: null, safeEl: null, zoomLabel: zoomLabel, zoomBar: zoomBar, zoom: 1, layerSelection: [], penColor: '#F7F3EA', penWidth: 4, markerColor: '#7FC4E6', markerWidth: 26, markerOpacity: 0.35, shapeColor: '#F7F3EA', shapeWidth: 4, brushColor: '#F7F3EA', brushWidth: 4 }

    var imageInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: function (e) { addImageFile(e.target.files && e.target.files[0]); e.target.value = '' } })
    state.editor.imageInput = imageInput
    ed.appendChild(imageInput)
    ;['dragenter', 'dragover'].forEach(function (ev) {
      canvasBox.addEventListener(ev, function (e) {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        try { e.dataTransfer.dropEffect = 'copy' } catch {}
        canvasBox.classList.add('drag-over')
      })
    })
    canvasBox.addEventListener('dragleave', function () { canvasBox.classList.remove('drag-over') })
    canvasBox.addEventListener('drop', async function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return
      e.preventDefault()
      e.stopPropagation()
      canvasBox.classList.remove('drag-over')
      var files = Array.from(e.dataTransfer.files).filter(function (f) { return /^image\//.test(f.type || '') })
      if (!files.length) { toast('拖入的是文件，不是图片；支持 PNG / JPG / WebP'); return }
      var rect = canvasBox.getBoundingClientRect()
      var zoom = (state.editor && state.editor.canvas && state.editor.canvas.getZoom) ? state.editor.canvas.getZoom() : 1
      var point = { x: (e.clientX - rect.left) / Math.max(0.01, zoom), y: (e.clientY - rect.top) / Math.max(0.01, zoom) }
      for (var i = 0; i < files.length; i++) {
        await addImageFile(files[i], { point: { x: point.x + i * 26, y: point.y + i * 26 } })
      }
    })
    buildEditorTools()
    buildEditorProps()
    await initFabric(project, canvasBox, wrap)
    if (state.editor && state.editor.assets && state.editor.assets.length) {
      for (var ai = 0; ai < state.editor.assets.length; ai++) {
        var asset = uploadById(state.editor.assets[ai])
        if (asset) await addAssetLayer(asset)
      }
    }
    setTimeout(function () { fitEditorCanvas() }, 60)
    window.addEventListener('resize', fitEditorCanvas)
    state.editor.resizeHandler = fitEditorCanvas
    state.editor.keyHandler = function (e) {
      if (!state.editor || e.defaultPrevented) return
      var t = e.target
      var typing = t && (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable)
      if (typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (state.editor && (state.editor.layerSelection || []).length > 1) deleteLayerSelection()
        else deleteActive()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) editorRedo(); else editorUndo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); editorRedo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateActive(); }
    }
    document.addEventListener('keydown', state.editor.keyHandler)
  }

  function closeEditor(force) {
    var ed = state.editor
    if (!ed) return
    if (!force && ed.dirty) {
      confirmDialog('放弃未保存的修改？', '画布上有还没保存的改动。', '放弃修改', true).then(function (ok) { if (ok) closeEditor(true) })
      return
    }
    if (ed.resizeHandler) window.removeEventListener('resize', ed.resizeHandler)
    if (ed.keyHandler) document.removeEventListener('keydown', ed.keyHandler)
    if (force && state.windowEl) {
      Array.prototype.forEach.call(state.windowEl.querySelectorAll('.cds-modal'), function (m) { if (m.parentNode) m.parentNode.removeChild(m) })
    }
    if (ed.canvas) { try { ed.canvas.dispose() } catch (e) {} }
    if (ed.editorEl && ed.editorEl.parentNode) ed.editorEl.parentNode.removeChild(ed.editorEl)
    state.editor = null
    if (state.overlay) loadState(true)
  }

  function buildEditorTools() {
    var ed = state.editor
    if (!ed) return
    clear(ed.toolsEl)
    function toolButton(id, iconName, label, onclick) {
      ed.toolsEl.appendChild(el('button', { className: 'cds-tool', title: label, 'data-on': ed.tool === id ? '1' : '0', onclick: onclick || function () { setEditorTool(id); buildEditorTools() } }, [icon(iconName)]))
    }
    function sep() { ed.toolsEl.appendChild(el('div', { className: 'cds-toolseparator' })) }
    toolButton('select', 'square', '选择 / 移动（V）')
    toolButton('background', 'crop', '裁切 / 移动底图（AI 作品也可以）')
    sep()
    toolButton('cutout', 'wand', '智能抠图：AI 识别主体或按描述抠图', function () { beginSmartCutout() })
    toolButton('cutbox', 'crop', '手动抠图：智能去边 / 矩形保留 / 擦除', function () { beginBoxCutout() })
    toolButton('cutbrush', 'pen', '画笔抠图：涂抹要保留的主体，橡皮修改', function () { beginBrushCutout() })
    sep()
    toolButton('text', 'text', '横排文字（T）')
    toolButton('vtext', 'text', '竖排文字')
    toolButton('image', 'image', '图片 / 贴纸（上传本地文件 / 拖入画布）')
    toolButton('template', 'template', '快速标题组：主标题 + 副标题', function () { addTitleTemplate(); setEditorTool('select'); buildEditorTools() })
    toolButton('aiasset', 'sticker', 'AI 找素材', function () { findEditorAssets() })
    sep()
    toolButton('rect', 'square', '矩形（连续绘制）')
    toolButton('ellipse', 'circle', '椭圆（连续绘制）')
    toolButton('line', 'line', '直线（连续绘制）')
    toolButton('arrow', 'arrow', '箭头（连续绘制，烘焙进导出图）')
    toolButton('pen', 'pen', '铅笔（连续绘制，烘焙进导出图）')
    toolButton('marker', 'marker', '荧光笔（连续绘制，烘焙进导出图）')
    sep()
    toolButton('safe', 'align', '显示 / 隐藏标题安全区参考线', function () { toggleSafeArea(); buildEditorTools() })
    sep()
    var spacer = el('div', { style: { flex: 1 } })
    ed.toolsEl.appendChild(spacer)
    ed.toolsEl.appendChild(el('button', { className: 'cds-tool danger', title: '删除选中图层（Delete）', onclick: function () { if ((ed.layerSelection || []).length > 1) deleteLayerSelection(); else deleteActive() } }, [icon('trash')]))
  }

  function setEditorTool(tool) {
    var ed = state.editor
    if (!ed) return
    if (tool === 'image') {
      if (ed.imageInput) ed.imageInput.click()
      else toast('图片输入框还没准备好，请重新打开画布')
      return
    }
    if (tool === 'aiasset') { findEditorAssets(); return }
    if (tool === 'cutout') { beginSmartCutout(); return }
    if (tool === 'cutbox') { beginBoxCutout(); return }
    if (tool === 'cutbrush') { beginBrushCutout(); return }
    if (!ed.canvas) { ed.tool = tool; return }
    var c = ed.canvas
    if (tool === 'background') {
      var bg = c.getObjects().find(function (o) { return o.cdaRole === 'background' })
      if (!bg) { toast('这个画布没有底图，先用图片工具加一张'); return }
      ed.tool = 'background'
      c.isDrawingMode = false
      c.selection = true
      c.defaultCursor = 'move'
      c.forEachObject(function (o) { o.selectable = o.cdaRole === 'background'; o.evented = o.cdaRole === 'background' })
      c.setActiveObject(bg)
      c.requestRenderAll()
      buildEditorProps()
      return
    }
    ed.tool = tool
    c.isDrawingMode = tool === 'pen' || tool === 'marker'
    c.selection = tool === 'select'
    c.defaultCursor = tool === 'select' ? 'default' : 'crosshair'
    c.forEachObject(function (o) { if (o.cdaRole !== 'background') o.selectable = tool === 'select'; o.evented = tool === 'select' })
    if (tool === 'pen') { c.freeDrawingBrush.color = ed.penColor || '#F7F3EA'; c.freeDrawingBrush.width = Math.max(1, Number(ed.penWidth) || 4) }
    if (tool === 'marker') { c.freeDrawingBrush.color = hexToRgba(ed.markerColor || '#7FC4E6', Number(ed.markerOpacity) || 0.35); c.freeDrawingBrush.width = Math.max(4, Number(ed.markerWidth) || 26) }
    if (['pen', 'marker', 'arrow', 'rect', 'ellipse', 'line'].includes(tool)) buildEditorProps()
    if (tool === 'select') c.discardActiveObject()
    c.requestRenderAll()
    if (tool === 'text') addText(false)
    if (tool === 'vtext') addText(true)
    ed.canvas.off('mouse:down')
    ed.canvas.off('mouse:move')
    ed.canvas.off('mouse:up')
    if (['rect', 'ellipse', 'line', 'arrow'].includes(tool)) bindShapeDraw(tool)
    if (tool === 'select') c.selection = true
  }

  function toggleSafeArea() {
    var ed = state.editor
    if (!ed || !ed.canvasBox) return
    if (ed.safeEl && ed.safeEl.parentNode) {
      ed.safeEl.parentNode.removeChild(ed.safeEl)
      ed.safeEl = null
      if (ed.tool === 'safe') ed.tool = 'select'
      return
    }
    ed.safeEl = el('div', { className: 'cds-safearea' }, [
      el('span', { className: 'cds-safeline h' }),
      el('span', { className: 'cds-safeline v' }),
      el('span', { className: 'cds-safelabel', text: '标题安全区 90%' }),
    ])
    ed.canvasBox.appendChild(ed.safeEl)
    ed.tool = 'safe'
  }

  function addTitleTemplate() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var c = ed.canvas
    var fontSize = Math.max(20, Math.round(62 * ed.scale))
    var main = new fabric.IText('主标题', {
      left: ed.displayW * 0.07, top: ed.displayH * 0.27,
      fontSize: fontSize, fontFamily: 'Cover Serif', fontWeight: 900, fill: '#F7F3EA',
      lineHeight: 1.02, shadow: new fabric.Shadow({ color: 'rgba(0,0,0,.55)', blur: 14, offsetY: 5 }),
      cdaRole: 'annotation', cdaType: 'text', cdaLayerId: 't-' + Date.now().toString(36),
    })
    var sub = new fabric.IText('副标题 / 一句话说明', {
      left: ed.displayW * 0.075, top: ed.displayH * 0.53,
      fontSize: Math.max(11, Math.round(22 * ed.scale)), fontFamily: 'Cover Sans', fontWeight: 500, fill: 'rgba(247,243,234,.86)',
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,.45)', blur: 10, offsetY: 3 }),
      cdaRole: 'annotation', cdaType: 'text', cdaLayerId: 't-' + (Date.now() + 1).toString(36),
    })
    c.add(main, sub)
    c.setActiveObject(main)
    markDirty(); pushUndo(); buildEditorProps(); c.requestRenderAll()
    toast('已加入标题组，双击文字直接改')
  }

  function duplicateActive() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var objs = activeObjects()
    if (!objs.length) { toast('先选中要复制的图层'); return }
    var last = null
    objs.forEach(function (o) {
      o.clone(function (x) {
        x.set({ left: o.left + 24, top: o.top + 24, cdaLayerId: 'copy-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5) })
        ed.canvas.add(x)
        ed.canvas.setActiveObject(x)
        last = x
        ed.canvas.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps()
      })
    })
    if (objs.length) toast('已复制图层')
  }

  function arrowPolygonPoints(x1, y1, x2, y2, color) {
    var dx = x2 - x1
    var dy = y2 - y1
    var len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return [[x1, y1], [x2, y2], [x2, y2]]
    var ux = dx / len
    var uy = dy / len
    var px = -uy
    var py = ux
    var head = Math.min(30, Math.max(10, len * 0.28))
    var headW = Math.min(18, Math.max(6, len * 0.16))
    var shaft = 5
    var bx = x2 - ux * head
    var by = y2 - uy * head
    return [
      [x1 + px * shaft, y1 + py * shaft],
      [bx + px * shaft, by + py * shaft],
      [bx + px * headW, by + py * headW],
      [x2, y2],
      [bx - px * headW, by - py * headW],
      [bx - px * shaft, by - py * shaft],
      [x1 - px * shaft, y1 - py * shaft],
    ]
  }

  function makeArrowObject(start, end, color) {
    var pts = arrowPolygonPoints(start.x, start.y, end.x, end.y)
    var d = 'M ' + pts.map(function (p) { return (Math.round(p[0] * 100) / 100) + ' ' + (Math.round(p[1] * 100) / 100) }).join(' L ') + ' Z'
    var path = new fabric.Path(d, {
      fill: color,
      stroke: color,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      objectCaching: false,
      cdaRole: 'annotation',
      cdaType: 'arrow',
      cdaLayerId: 'arrow-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      cdaArrow: { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
    })
    return path
  }

  function bindShapeDraw(tool) {
    var ed = state.editor
    var c = ed.canvas
    c.on('mouse:down', function (opt) {
      if (ed.tool !== tool) return
      var color = ed.shapeColor || '#F7F3EA'
      var width = Math.max(1, Number(ed.shapeWidth) || 4)
      var p = c.getPointer(opt.e)
      ed.shapeStart = p
      ed.shapeEnd = p
      if (tool === 'arrow') {
        ed.temp = makeArrowObject(p, p, color)
        c.add(ed.temp)
      } else if (tool === 'line') {
        ed.temp = new fabric.Line([p.x, p.y, p.x, p.y], { stroke: color, strokeWidth: width, selectable: false, evented: false, cdaRole: 'annotation', cdaType: 'line' })
        c.add(ed.temp)
      } else if (tool === 'ellipse') {
        ed.temp = new fabric.Ellipse({ left: p.x, top: p.y, rx: 1, ry: 1, originX: 'left', originY: 'top', fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth: Math.max(1, width - 1), selectable: false, evented: false, cdaRole: 'annotation', cdaType: 'ellipse' })
        c.add(ed.temp)
      } else {
        ed.temp = new fabric.Rect({ left: p.x, top: p.y, width: 1, height: 1, fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth: Math.max(1, width - 1), selectable: false, evented: false, cdaRole: 'annotation', cdaType: 'rect', rx: 2, ry: 2 })
        c.add(ed.temp)
      }
      c.requestRenderAll()
    })
    c.on('mouse:move', function (opt) {
      if (!ed.temp || !ed.shapeStart) return
      var p = c.getPointer(opt.e)
      ed.shapeEnd = p
      if (tool === 'arrow') {
        var color = ed.shapeColor || '#F7F3EA'
        var next = makeArrowObject(ed.shapeStart, p, color)
        c.remove(ed.temp)
        ed.temp = next
        c.add(next)
      } else if (tool === 'line') {
        ed.temp.set({ x2: p.x, y2: p.y })
        ed.temp.setCoords()
      } else {
        var left = Math.min(ed.shapeStart.x, p.x)
        var top = Math.min(ed.shapeStart.y, p.y)
        var w = Math.abs(p.x - ed.shapeStart.x)
        var h = Math.abs(p.y - ed.shapeStart.y)
        if (tool === 'ellipse') ed.temp.set({ left: left, top: top, rx: w / 2, ry: h / 2, width: w, height: h })
        else ed.temp.set({ left: left, top: top, width: w, height: h })
      }
      c.requestRenderAll()
    })
    c.on('mouse:up', function () {
      if (!ed.temp) return
      var obj = ed.temp
      var start = ed.shapeStart
      var end = ed.shapeEnd
      ed.temp = null
      ed.shapeStart = null
      ed.shapeEnd = null
      var len = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0
      var tiny = len < 6
      if (tiny) { c.remove(obj); c.requestRenderAll(); return }
      markDirty(); pushUndo(); buildEditorProps()
      c.requestRenderAll()
      // 工具保持激活，连续画；按 V / 选择工具切回移动
      c.selection = false
      c.forEachObject(function (o) { if (o.cdaRole !== 'background') { o.selectable = false; o.evented = false } })
      buildEditorTools()
    })
  }

  function addText(vertical) {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var c = ed.canvas
    var fontSize = Math.round(48 / ed.scale)
    var text = vertical ? '竖\n排\n标\n题' : '双击编辑文字'
    var obj = new fabric.IText(text, {
      left: ed.displayW * 0.18, top: ed.displayH * 0.28,
      fontSize: Math.max(18, fontSize * ed.scale),
      fontFamily: 'Cover Serif', fontWeight: 900, fill: '#F7F3EA',
      textAlign: 'center', lineHeight: 1.05,
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,.5)', blur: 12, offsetY: 4 }),
      cdaRole: 'annotation', cdaType: 'text', cdaVertical: !!vertical,
    })
    if (vertical) {
      obj.set({ charSpacing: 0, lineHeight: 0.98, textAlign: 'center' })
      obj.cdaGroupId = 'vg-' + Date.now().toString(36)
      obj.cdaColumnIndex = 0
      obj.cdaLayerId = obj.cdaGroupId + '-0'
    } else {
      obj.cdaLayerId = 't-' + Date.now().toString(36)
    }
    c.add(obj)
    markDirty(); pushUndo()
    setEditorTool('select'); buildEditorTools()
    c.setActiveObject(obj)
    if (!vertical) obj.enterEditing()
    c.requestRenderAll(); buildEditorProps()
  }


  function applyImageFilter(obj, filter) {
    if (!obj || !window.fabric) return
    obj.cdaFilter = filter
    var f = filter || {}
    var filters = []
    try {
      var b = Number(f.brightness ?? 100)
      var c = Number(f.contrast ?? 100)
      var sa = Number(f.saturate ?? 100)
      var bl = Number(f.blur ?? 0)
      if (b !== 100 && fabric.Image.filters.Brightness) filters.push(new fabric.Image.filters.Brightness({ brightness: (b - 100) / 100 }))
      if (c !== 100 && fabric.Image.filters.Contrast) filters.push(new fabric.Image.filters.Contrast({ contrast: (c - 100) / 100 }))
      if (sa !== 100 && fabric.Image.filters.Saturation) filters.push(new fabric.Image.filters.Saturation({ saturation: (sa - 100) / 100 }))
      if (bl > 0 && fabric.Image.filters.Blur) filters.push(new fabric.Image.filters.Blur({ blur: Math.min(1, bl / 10) }))
      obj.filters = filters
      obj.applyFilters()
    } catch (e) {}
  }

  async function addAssetLayer(upload, opts) {
    var ed = state.editor
    if (!ed || !ed.canvas || !upload) return
    await new Promise(function (resolve) {
      fabric.Image.fromURL(upload.url, function (img) {
        if (!img || !img.width) return resolve()
        var w = ed.displayW * (opts && opts.small ? 0.24 : 0.34)
        var h = w * (img.height / Math.max(1, img.width))
        var s = w / img.width
        var left = opts && opts.point ? opts.point.x - w / 2 : ed.displayW * 0.34
        var top = opts && opts.point ? opts.point.y - h / 2 : ed.displayH * 0.3
        left = Math.max(0, Math.min(ed.displayW - w, left))
        top = Math.max(0, Math.min(ed.displayH - h, top))
        img.set({
          left: left,
          top: top,
          scaleX: s,
          scaleY: s,
          cdaRole: 'sticker',
          cdaType: 'image',
          cdaLayerId: 'img-' + Date.now().toString(36),
          cdaSrc: upload.url,
          cdaFilter: null,
          selectable: true,
          evented: true,
        })
        ed.canvas.add(img)
        ed.canvas.setActiveObject(img)
        ed.canvas.requestRenderAll()
        markDirty(); pushUndo(); buildEditorProps()
        resolve()
      }, { crossOrigin: 'anonymous' })
    })
  }

  function addImageLayer(L) {
    var ed = state.editor
    if (!ed || !ed.canvas || !L?.src) return Promise.resolve()
    return new Promise(function (resolve) {
      fabric.Image.fromURL(L.src, function (img) {
        if (!img || !img.width) { resolve(); return }
        var w = Math.max(8, Number(L.w) || img.width * 0.3)
        var h = Math.max(8, Number(L.h) || img.height * 0.3)
        img.set({
          left: (Number(L.x) || 0) * ed.scale,
          top: (Number(L.y) || 0) * ed.scale,
          scaleX: (w * ed.scale) / img.width,
          scaleY: (h * ed.scale) / img.height,
          angle: Number(L.angle) || 0,
          opacity: L.opacity ?? 1,
          visible: L.visible !== false,
          cdaRole: 'sticker',
          cdaRole: L.role || 'annotation',
          cdaType: 'image',
          cdaLayerId: L.id || ('img-' + Date.now().toString(36)),
          cdaSrc: L.src,
          cdaFilter: L.filter || null,
          cdaCutout: !!L.cutout,
          cdaCutoutBackground: !!L.cutoutBackground,
          selectable: !L.cutoutBackground,
          evented: !L.cutoutBackground,
        })
        if (L.filter) applyImageFilter(img, L.filter)
        applyLayerLock(img, L)
        ed.canvas.add(img)
        ed.canvas.requestRenderAll()
        resolve(img)
      }, { crossOrigin: 'anonymous' })
    })
  }

  async function addImageFile(file, opts) {
    if (!file || !/^image\//.test(file.type || '')) { toast('请选择图片'); return }
    var fd = new FormData()
    fd.append('file', file, file.name)
    toast('正在上传素材…')
    try {
      var data = await api('/upload', { method: 'POST', body: fd })
      if (!data.upload) throw new Error('上传失败')
      state.uploads.unshift(data.upload)
      await addAssetLayer(data.upload, { small: true, point: opts && opts.point })
      toast('已加入画布')
    } catch (err) { toast('素材上传失败：' + err.message) }
  }

  async function findEditorAssets() {
    var q = await promptDialog('AI 找素材', '想要什么图片/贴纸/氛围？会搜索高清原图，可以换一批、批量加入。', '例如：蓝色光斑 贴纸 PNG')
    if (!q) return
    var s = { query: q, page: 1, uploads: [], selected: [], busy: false, tempIds: [], provider: 'auto', site: '' }
    state.assetSearch = s
    var modal = el('div', { className: 'cds-modal' })
    var close = function (keepTemp) {
      if (!keepTemp && s.tempIds.length) {
        var ids = s.tempIds.slice()
        api('/uploads/discard', { method: 'POST', body: { ids: ids } }).then(function (data) {
          if (Array.isArray(data.uploads)) state.uploads = data.uploads
        }).catch(function () {})
      }
      if (modal.parentNode) modal.parentNode.removeChild(modal)
      if (state.assetSearch === s) state.assetSearch = null
    }
    async function keepAsset(u) {
      if (!u) return
      var i = s.tempIds.indexOf(u.id)
      if (i >= 0) s.tempIds.splice(i, 1)
      if (u.temporary) {
        try { await api('/uploads/library', { method: 'POST', body: { ids: [u.id], inLibrary: true } }) } catch {}
        u.inReferenceLibrary = true
        u.temporary = false
        var local = state.uploads.find(function (x) { return x.id === u.id })
        if (local) { local.inReferenceLibrary = true; local.temporary = false }
      }
    }
    var status = el('span', { className: 'cds-hint', text: '正在搜索高清素材…' })
    var grid = el('div', { className: 'cds-assettray' })
    var addBtn = el('button', { className: 'cds-btn primary sm', disabled: true, onclick: function () { addPickedAssets(false) } }, [icon('plus'), el('span', { text: '加入选中' })])
    var allBtn = el('button', { className: 'cds-btn sm', disabled: true, onclick: function () { addPickedAssets(true) } }, [el('span', { text: '全选加入' })])
    var nextBtn = el('button', { className: 'cds-btn sm', onclick: function () { load(s.page + 1) } }, [icon('refresh'), el('span', { text: '换一批' })])
    var providerSel = el('select', { className: 'cds-select', style: { width: '104px', height: '26px', fontSize: '10px' }, onchange: function (e) {
      s.provider = e.target.value
      if (s.provider === 'page' && !s.site) { status.textContent = '指定页面：请填完整页面 URL'; return }
      load(1)
    } }, [
      el('option', { value: 'auto', selected: s.provider === 'auto' }, [el('span', { text: '自动来源' })]),
      el('option', { value: 'bing', selected: s.provider === 'bing' }, [el('span', { text: 'Bing 图片' })]),
      el('option', { value: 'bilibili', selected: s.provider === 'bilibili' }, [el('span', { text: 'B 站封面' })]),
      el('option', { value: 'page', selected: s.provider === 'page' }, [el('span', { text: '指定页面' })]),
    ])
    var siteInput = el('input', { className: 'cds-input', style: { width: '176px', height: '26px', fontSize: '10px' }, placeholder: '站点域名 或 页面 URL（可选）', value: '', onkeydown: function (e) { if (e.key === 'Enter') { s.site = siteInput.value.trim(); load(1) } } })
    var siteBtn = el('button', { className: 'cds-btn sm', onclick: function () { s.site = siteInput.value.trim(); load(1) } }, [el('span', { text: '应用站点' })])
    var selAllBtn = el('button', { className: 'cds-btn sm', onclick: function () {
      s.selected = s.selected.length === s.uploads.length ? [] : s.uploads.map(function (u) { return u.id })
      renderGrid()
    } }, [el('span', { text: '全选' })])
    function renderGrid() {
      clear(grid)
      grid.appendChild(el('div', { className: 'cds-hint', style: { gridColumn: '1/-1', padding: '2px 0' }, text: s.uploads.length ? '共 ' + s.uploads.length + ' 张高清素材 · 点击勾选，可多选加入' : '没有找到高清素材，点“换一批”再试' }))
      s.uploads.forEach(function (u) {
        var picked = s.selected.indexOf(u.id) >= 0
        grid.appendChild(el('div', { className: 'cds-assetitem' + (picked ? ' is-picked' : ''), title: u.title || u.name, onclick: function () {
          var i = s.selected.indexOf(u.id)
          if (i >= 0) s.selected.splice(i, 1)
          else s.selected.push(u.id)
          renderGrid()
        }, ondblclick: async function () { await keepAsset(u); close(); addAssetLayer(u) } }, [
          el('img', { src: u.url || u.thumbUrl, alt: u.title || u.name, loading: 'lazy' }),
          el('span', { className: 'cds-pickcheck' + (picked ? ' on' : ''), text: picked ? '✓' : '' }),
        ]))
      })
      var count = s.selected.length
      addBtn.disabled = !count
      addBtn.querySelector('span:last-child').textContent = count ? '加入选中 ' + count : '加入选中'
      allBtn.disabled = !s.uploads.length
      selAllBtn.querySelector('span').textContent = s.selected.length === s.uploads.length && s.uploads.length ? '取消全选' : '全选'
      status.textContent = s.busy ? '正在搜索高清素材…' : (s.uploads.length ? '第 ' + s.page + ' 批 · ' + s.uploads.length + ' 张高清素材' : '这批没有新的高清素材，点“换一批”或换关键词')
    }
    async function load(page) {
      if (s.busy) return
      s.busy = true
      s.page = Math.max(1, page)
      renderGrid()
      try {
        var data = { uploads: [] }
        for (var attempt = 0; attempt < 2; attempt++) {
          data = await api('/search/images', { method: 'POST', body: { query: s.query, count: 12, page: s.page, temporary: true, provider: s.provider || 'auto', site: s.site || '' } })
          if ((data.uploads || []).length || !data.duplicateOnly) break
          // 这批图片已经在图库里：自动翻到下一批，避免“搜同一个词永远同一批”。
          s.page++
        }
        s.uploads = data.uploads || []
        s.selected = []
        ;(s.uploads || []).forEach(function (u) {
          if (u.temporary && s.tempIds.indexOf(u.id) < 0) s.tempIds.push(u.id)
          if (!state.uploads.some(function (x) { return x.id === u.id })) state.uploads.unshift(u)
        })
      } catch (err) {
        status.textContent = '搜索失败：' + err.message
      } finally {
        s.busy = false
        renderGrid()
      }
    }
    async function addPickedAssets(all) {
      var list = all ? s.uploads : s.uploads.filter(function (u) { return s.selected.indexOf(u.id) >= 0 })
      if (!list.length) return
      for (var k = 0; k < list.length; k++) await keepAsset(list[k])
      close()
      for (var i = 0; i < list.length; i++) {
        await addAssetLayer(list[i], { small: true, point: { x: state.editor.displayW * 0.3 + (i % 4) * 26, y: state.editor.displayH * 0.3 + Math.floor(i / 4) * 26 } })
      }
      toast('已加入 ' + list.length + ' 个素材到画布')
    }
    var dlg = el('div', { className: 'cds-dialog', style: { maxWidth: '860px' } }, [
      el('h3', { text: 'AI 找素材' }),
      el('div', { className: 'cds-assettoolbar', style: { flexWrap: 'wrap' } }, [status, el('span', { style: { flex: 1 } }), providerSel, siteInput, siteBtn, selAllBtn, nextBtn]),
      grid,
      el('div', { className: 'cds-dialogacts' }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '关闭' })]),
        allBtn,
        addBtn,
      ]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
    renderGrid()
    load(1)
  }

  function beginBrushCutout() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var target = resolveCutTarget()
    if (!target) { toast('这个画布没有可抠图的图片或底图'); return }
    if (ed.brushUI) { try { ed.brushUI.remove() } catch (e) {} ed.brushUI = null }
    if (ed.brushTools) { try { ed.brushTools.remove() } catch (e) {} ed.brushTools = null }
    var c = ed.canvas
    ed.cutTarget = target
    ed.tool = 'cutbrush'
    buildEditorTools()
    c.isDrawingMode = false
    c.selection = false
    c.defaultCursor = 'crosshair'
    c.forEachObject(function (o) { o.selectable = false; o.evented = false })
    c.discardActiveObject()
    c.requestRenderAll()

    var ui = el('div', { className: 'cds-brushui' })
    var maskCanvas = document.createElement('canvas')
    maskCanvas.width = ed.displayW
    maskCanvas.height = ed.displayH
    var maskCtx = maskCanvas.getContext('2d')
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    var overlay = document.createElement('canvas')
    overlay.className = 'cds-maskbrush'
    overlay.width = ed.displayW
    overlay.height = ed.displayH
    overlay.style.width = ed.displayW + 'px'
    overlay.style.height = ed.displayH + 'px'
    var ctx = overlay.getContext('2d')
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    var strokes = []
    var current = null
    var brushSize = 46
    var erasing = false

    function paintStrokeOn(context, s, color, eraseMode) {
      if (!s.points.length) return
      context.globalCompositeOperation = eraseMode ? 'destination-out' : 'source-over'
      context.strokeStyle = color
      context.fillStyle = color
      context.lineWidth = s.size
      if (s.points.length === 1) {
        context.beginPath()
        context.arc(s.points[0][0], s.points[0][1], s.size / 2, 0, Math.PI * 2)
        context.fill()
        return
      }
      context.beginPath()
      context.moveTo(s.points[0][0], s.points[0][1])
      for (var i = 1; i < s.points.length; i++) context.lineTo(s.points[i][0], s.points[i][1])
      context.stroke()
    }
    function paintMaskStroke(s) { paintStrokeOn(maskCtx, s, '#FFFFFF', s.erase) }
    function rebuildPreview() {
      ctx.clearRect(0, 0, overlay.width, overlay.height)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(206, 72, 66, .32)'
      ctx.fillRect(0, 0, overlay.width, overlay.height)
      strokes.forEach(function (s) {
        if (s.erase) paintStrokeOn(ctx, s, 'rgba(206, 72, 66, .32)', false)
        else paintStrokeOn(ctx, s, '#FFFFFF', true)
      })
      ctx.globalCompositeOperation = 'source-over'
    }
    function redraw() {
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      strokes.forEach(paintMaskStroke)
      rebuildPreview()
    }
    function paintStroke(s) { paintMaskStroke(s) }
    function pointOf(e) {
      var r = overlay.getBoundingClientRect()
      return [(e.clientX - r.left) * (overlay.width / Math.max(1, r.width)), (e.clientY - r.top) * (overlay.height / Math.max(1, r.height))]
    }
    function down(e) {
      if (e.button !== 0) return
      e.preventDefault()
      overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId)
      current = { points: [pointOf(e)], size: brushSize, erase: erasing }
      strokes.push(current)
      paintStroke(current)
      rebuildPreview()
    }
    function move(e) {
      if (!current) return
      e.preventDefault()
      var p = pointOf(e)
      var prev = current.points[current.points.length - 1]
      current.points.push(p)
      var seg = { points: [prev, p], size: current.size, erase: current.erase }
      paintMaskStroke(seg)
      if (current.erase) paintStrokeOn(ctx, seg, 'rgba(206, 72, 66, .32)', false)
      else paintStrokeOn(ctx, seg, '#FFFFFF', true)
    }
    function up(e) {
      if (!current) return
      current = null
      rebuildPreview()
      overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId)
    }
    overlay.addEventListener('pointerdown', down)
    overlay.addEventListener('pointermove', move)
    overlay.addEventListener('pointerup', up)
    overlay.addEventListener('pointercancel', up)

    var brushBtn = el('button', { className: 'cds-btn sm', 'data-on': '1', onclick: function () { erasing = false; updateMode() } }, [icon('pen'), el('span', { text: '画笔' })])
    var eraseBtn = el('button', { className: 'cds-btn sm', 'data-on': '0', onclick: function () { erasing = true; updateMode() } }, [el('span', { text: '橡皮' })])
    function updateMode() {
      brushBtn.setAttribute('data-on', erasing ? '0' : '1')
      eraseBtn.setAttribute('data-on', erasing ? '1' : '0')
      overlay.style.cursor = erasing ? 'cell' : 'crosshair'
    }
    var sizeLabel = el('span', { className: 'cds-hint', text: brushSize + 'px' })
    var sizeInput = el('input', { className: 'cds-input', type: 'range', min: '8', max: '140', value: String(brushSize), oninput: function (e) { brushSize = Math.max(8, Number(e.target.value) || 8); sizeLabel.textContent = brushSize + 'px' } })
    function cleanup() {
      if (ui.parentNode) ui.parentNode.removeChild(ui)
      if (ed.brushTools && ed.brushTools.parentNode) ed.brushTools.parentNode.removeChild(ed.brushTools)
      ed.brushTools = null
      ed.brushUI = null
      c.forEachObject(function (o) { var allow = !o.cdaLocked && o.cdaRole !== 'background'; o.selectable = allow; o.evented = allow })
      c.selection = true
      c.defaultCursor = 'default'
      c.requestRenderAll()
      ed.tool = 'select'
      buildEditorTools()
      buildEditorProps()
    }
    var brushMode = 'dock'
    var brushCollapsed = false
    try { brushMode = localStorage.getItem('cds-brush-mode') === 'float' ? 'float' : 'dock' } catch {}
    try { brushCollapsed = localStorage.getItem('cds-brush-collapsed') === '1' } catch {}
    var brushGrip = el('div', { className: 'cds-brushgrip', title: '按住拖动工具条' }, [el('span', { className: 'cds-brushgrip-line' }), el('span', { text: '拖动' })])
    var modeBtn = el('button', { className: 'cds-btn ghost sm', title: '在画布下方停靠，或变成可拖动浮窗', onclick: function () { setBrushMode(brushMode === 'dock' ? 'float' : 'dock') } }, [el('span', { text: '浮动' })])
    var collapseBtn = el('button', { className: 'cds-btn ghost sm', title: '收起/展开画笔工具条', onclick: function () { setBrushCollapsed(!brushCollapsed) } }, [el('span', { text: '收起' })])
    var body = el('div', { className: 'cds-brushbody' }, [
      el('div', { className: 'cds-brushhint', text: '涂抹要保留的主体，红色区域会被去掉；可用橡皮修正。工具条可停在画布下方，不挡画面。' }),
      el('div', { className: 'cds-brushrow' }, [
        brushBtn, eraseBtn, el('span', { className: 'cds-hint', text: '笔刷' }), sizeInput, sizeLabel,
        el('span', { style: { flex: 1 } }),
        el('button', { className: 'cds-btn sm', onclick: function () { strokes.pop(); redraw() } }, [icon('undo'), el('span', { text: '撤销' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { strokes = []; redraw() } }, [el('span', { text: '清空' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { cleanup(); toast('已取消画笔抠图') } }, [el('span', { text: '取消' })]),
        el('button', { className: 'cds-btn primary sm', onclick: async function () {
          if (!strokes.length) { toast('先用画笔涂抹要保留的主体'); return }
          var maskBlob = await new Promise(function (resolve) { maskCanvas.toBlob(resolve, 'image/png') })
          if (!maskBlob) { toast('生成蒙版失败'); return }
          cleanup()
          await applyCutout(target, { mode: 'brush', maskBlob: maskBlob })
        } }, [icon('wand'), el('span', { text: '抠出' })]),
      ]),
    ])
    var tools = el('div', { className: 'cds-brushtools is-docked' }, [
      el('div', { className: 'cds-brushtop' }, [
        brushGrip,
        el('span', { className: 'cds-brushtophint', text: brushMode === 'dock' ? '已停靠在画布下方' : '浮动工具条' }),
        el('span', { style: { flex: 1 } }),
        modeBtn,
        collapseBtn,
      ]),
      body,
    ])
    function setBrushCollapsed(v) {
      brushCollapsed = !!v
      tools.classList.toggle('is-collapsed', brushCollapsed)
      collapseBtn.querySelector('span').textContent = brushCollapsed ? '展开' : '收起'
      try { localStorage.setItem('cds-brush-collapsed', brushCollapsed ? '1' : '0') } catch {}
    }
    function applyFloatPosition() {
      var saved = null
      try { saved = JSON.parse(localStorage.getItem('cds-brush-pos') || 'null') } catch {}
      var width = tools.offsetWidth || Math.min(760, ed.displayW - 16)
      var height = tools.offsetHeight || 78
      var left = saved && Number.isFinite(Number(saved.left)) ? Number(saved.left) : Math.round((ed.displayW - width) / 2)
      var top = saved && Number.isFinite(Number(saved.top)) ? Number(saved.top) : Math.max(8, ed.displayH - height - 16)
      left = Math.max(4, Math.min(ed.displayW - width - 4, left))
      top = Math.max(4, Math.min(ed.displayH - height - 4, top))
      tools.style.left = left + 'px'
      tools.style.top = top + 'px'
    }
    function setBrushMode(next) {
      brushMode = next === 'float' ? 'float' : 'dock'
      if (tools.parentNode) tools.parentNode.removeChild(tools)
      tools.classList.toggle('is-docked', brushMode === 'dock')
      tools.classList.toggle('is-floating', brushMode === 'float')
      if (brushMode === 'dock') {
        tools.style.left = ''
        tools.style.top = ''
        ed.brushDock.appendChild(tools)
      } else {
        ed.canvasBox.appendChild(tools)
        applyFloatPosition()
      }
      brushGrip.style.cursor = brushMode === 'float' ? 'grab' : 'default'
      brushGrip.title = brushMode === 'float' ? '按住拖动工具条' : '停靠模式下不挡画面；点“浮动”后可拖动'
      modeBtn.querySelector('span').textContent = brushMode === 'dock' ? '浮动' : '停靠下方'
      tools.querySelector('.cds-brushtophint').textContent = brushMode === 'dock' ? '已停靠在画布下方' : '浮动工具条'
      try { localStorage.setItem('cds-brush-mode', brushMode) } catch {}
    }
    brushGrip.addEventListener('pointerdown', function (e) {
      if (brushMode !== 'float' || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      var box = ed.canvasBox
      var br = box.getBoundingClientRect()
      var tr = tools.getBoundingClientRect()
      var startLeft = tr.left - br.left
      var startTop = tr.top - br.top
      var startX = e.clientX
      var startY = e.clientY
      tools.style.left = startLeft + 'px'
      tools.style.top = startTop + 'px'
      brushGrip.style.cursor = 'grabbing'
      brushGrip.setPointerCapture && brushGrip.setPointerCapture(e.pointerId)
      function move(ev) {
        var left = startLeft + ev.clientX - startX
        var top = startTop + ev.clientY - startY
        left = Math.max(4, Math.min(box.clientWidth - tools.offsetWidth - 4, left))
        top = Math.max(4, Math.min(box.clientHeight - tools.offsetHeight - 4, top))
        tools.style.left = left + 'px'
        tools.style.top = top + 'px'
      }
      function up(ev) {
        brushGrip.removeEventListener('pointermove', move)
        brushGrip.removeEventListener('pointerup', up)
        brushGrip.removeEventListener('pointercancel', up)
        brushGrip.releasePointerCapture && brushGrip.releasePointerCapture(ev.pointerId)
        brushGrip.style.cursor = 'grab'
        try { localStorage.setItem('cds-brush-pos', JSON.stringify({ left: Math.round(tools.offsetLeft), top: Math.round(tools.offsetTop) })) } catch {}
      }
      brushGrip.addEventListener('pointermove', move)
      brushGrip.addEventListener('pointerup', up)
      brushGrip.addEventListener('pointercancel', up)
    })
    ui.appendChild(overlay)
    ed.canvasBox.appendChild(ui)
    ed.brushUI = ui
    ed.brushTools = tools
    setBrushCollapsed(brushCollapsed)
    setBrushMode(brushMode)
    updateMode()
    rebuildPreview()
    toast(brushMode === 'dock' ? '画笔抠图：工具条已停靠在画布下方；涂抹要保留的主体' : '画笔抠图：红色区域会被去掉；涂抹要保留的主体')
  }

  function cutTargetObject() {
    var ed = state.editor
    if (!ed || !ed.canvas) return null
    var o = ed.canvas.getActiveObject()
    if (!o) return null
    if (o.cdaRole !== 'background' && o.cdaType !== 'image') return null
    if (o.visible === false) return null
    return o
  }

  function setEditorBusy(busy, text) {
    var ed = state.editor
    if (!ed) return
    if (!busy) {
      if (ed.busyEl && ed.busyEl.parentNode) ed.busyEl.parentNode.removeChild(ed.busyEl)
      ed.busyEl = null
      return
    }
    if (ed.busyEl && ed.busyEl.parentNode) ed.busyEl.parentNode.removeChild(ed.busyEl)
    ed.busyEl = el('div', { className: 'cds-edbusy' }, [el('span', { className: 'cds-spinner' }), el('span', { text: text || '处理中…' })])
    ed.editorEl.appendChild(ed.busyEl)
  }

  async function rasterizeObject(target) {
    var ed = state.editor
    var c = ed.canvas
    var viewport = c.viewportTransform ? c.viewportTransform.slice() : [1, 0, 0, 1, 0, 0]
    var states = c.getObjects().map(function (o) { return { o: o, visible: o.visible, selectable: o.selectable, evented: o.evented } })
    var bgImage = c.backgroundImage
    var bgColor = c.backgroundColor
    try {
      c.setViewportTransform([1, 0, 0, 1, 0, 0])
      c.getObjects().forEach(function (o) { o.visible = o === target })
      if (target.cdaRole !== 'background') c.backgroundImage = null
      c.backgroundColor = null
      c.discardActiveObject()
      c.renderAll()
      var dataUrl = c.toDataURL({ format: 'png', multiplier: 1 / ed.scale, quality: 1 })
      return { dataUrl: dataUrl, width: ed.targetW, height: ed.targetH }
    } finally {
      states.forEach(function (s) { s.o.visible = s.visible; s.o.selectable = s.selectable; s.o.evented = s.evented })
      c.backgroundImage = bgImage
      c.backgroundColor = bgColor
      c.setViewportTransform(viewport)
      c.renderAll()
    }
  }

  async function applyCutout(target, opts) {
    var ed = state.editor
    if (!ed || !target) return
    setEditorBusy(true, opts.mode === 'smart' ? 'AI 正在识别主体并抠图…' : (opts.mode === 'brush' ? '正在按画笔涂抹区域抠图…' : '正在处理框选区域…'))
    try {
      var raster = await rasterizeObject(target)
      var blob = await (await fetch(raster.dataUrl)).blob()
      var fd = new FormData()
      fd.append('file', blob, 'cutout-source.png')
      fd.append('mode', opts.mode || 'smart')
      if (opts.prompt) fd.append('prompt', opts.prompt)
      if (opts.box) fd.append('box', JSON.stringify(opts.box))
      if (opts.maskBlob) fd.append('mask', opts.maskBlob, 'brush-mask.png')
      var data = await api('/cutout', { method: 'POST', body: fd })
      if (!data.upload) throw new Error('没有返回抠图结果')
      if (Number(data.coverage) < 0.002) throw new Error('没有识别出主体，试试手动框选或换一张图')
      if (target.cdaRole === 'background' && data.backgroundUpload) {
        await addCutoutBackgroundLayer(data.backgroundUpload)
      }
      await addCutoutLayer(data.upload, target, data.crop)
      target.visible = false
      ed.canvas.discardActiveObject()
      ed.canvas.requestRenderAll()
      markDirty(); pushUndo(); buildEditorProps()
      toast((data.note || '抠图完成') + '；原图层已隐藏，可在图层列表恢复')
    } catch (err) {
      toast('抠图失败：' + err.message)
    } finally {
      setEditorBusy(false)
    }
  }

  function addCutoutBackgroundLayer(upload) {
    var ed = state.editor
    return new Promise(function (resolve) {
      fabric.Image.fromURL(upload.url, function (img) {
        if (!img || !img.width) { resolve(); return }
        img.set({
          left: 0,
          top: 0,
          scaleX: ed.displayW / img.width,
          scaleY: ed.displayH / img.height,
          cdaRole: 'sticker',
          cdaType: 'image',
          cdaLayerId: 'cutbg-' + Date.now().toString(36),
          cdaSrc: upload.url,
          cdaCutoutBackground: true,
          selectable: false,
          evented: false,
        })
        ed.canvas.insertAt(img, 0, false)
        ed.canvas.requestRenderAll()
        resolve(img)
      }, { crossOrigin: 'anonymous' })
    })
  }

  function addCutoutLayer(upload, source, crop) {
    var ed = state.editor
    return new Promise(function (resolve) {
      fabric.Image.fromURL(upload.url, function (img) {
        if (!img || !img.width) { resolve(); return }
        var x = crop && Number.isFinite(Number(crop.x)) ? Number(crop.x) : 0
        var y = crop && Number.isFinite(Number(crop.y)) ? Number(crop.y) : 0
        var w = crop && Number(crop.w) > 0 ? Number(crop.w) : 1
        var h = crop && Number(crop.h) > 0 ? Number(crop.h) : 1
        var dw = w * ed.displayW
        var dh = h * ed.displayH
        img.set({
          left: x * ed.displayW,
          top: y * ed.displayH,
          scaleX: dw / img.width,
          scaleY: dh / img.height,
          cdaRole: 'sticker',
          cdaType: 'image',
          cdaLayerId: 'cut-' + Date.now().toString(36),
          cdaSrc: upload.url,
          cdaCutout: true,
          selectable: true,
          evented: true,
        })
        ed.canvas.add(img)
        ed.canvas.setActiveObject(img)
        ed.canvas.requestRenderAll()
        resolve(img)
      }, { crossOrigin: 'anonymous' })
    })
  }

  function resolveCutTarget() {
    var ed = state.editor
    var target = cutTargetObject()
    if (target) return target
    var bg = ed.canvas.getObjects().find(function (o) { return o.cdaRole === 'background' && o.visible !== false })
    if (bg) {
      ed.canvas.forEachObject(function (o) { o.selectable = o === bg; o.evented = o === bg })
      bg.selectable = true
      bg.evented = true
      ed.canvas.setActiveObject(bg)
      ed.canvas.requestRenderAll()
      return bg
    }
    return null
  }

  async function beginSmartCutout() {
    var ed = state.editor
    var target = resolveCutTarget()
    if (!target) { toast('这个画布没有可抠图的图片或底图'); return }
    var q = await promptDialog('智能抠图', '要抠出什么？留空自动识别主体（例如：人物 / 猫 / 产品 / 标题字）', '留空自动识别')
    if (q === null) return
    await applyCutout(target, { mode: 'smart', prompt: q })
  }

  function beginBoxCutout() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var target = resolveCutTarget()
    if (!target) { toast('这个画布没有可抠图的图片或底图'); return }
    var c = ed.canvas
    ed.cutTarget = target
    ed.tool = 'cutbox'
    buildEditorTools()
    c.isDrawingMode = false
    c.selection = false
    c.defaultCursor = 'crosshair'
    c.forEachObject(function (o) { o.selectable = false; o.evented = false })
    c.discardActiveObject()
    c.off('mouse:down'); c.off('mouse:move'); c.off('mouse:up')
    c.on('mouse:down', function (opt) {
      var p = c.getPointer(opt.e)
      ed.boxStart = p
      ed.boxTemp = new fabric.Rect({ left: p.x, top: p.y, width: 1, height: 1, fill: 'rgba(0,0,0,0)', stroke: '#FFD500', strokeWidth: 2, strokeDashArray: [6, 4], selectable: false, evented: false })
      c.add(ed.boxTemp)
      c.requestRenderAll()
    })
    c.on('mouse:move', function (opt) {
      if (!ed.boxStart || !ed.boxTemp) return
      var p = c.getPointer(opt.e)
      ed.boxTemp.set({ left: Math.min(ed.boxStart.x, p.x), top: Math.min(ed.boxStart.y, p.y), width: Math.abs(p.x - ed.boxStart.x), height: Math.abs(p.y - ed.boxStart.y) })
      c.requestRenderAll()
    })
    c.on('mouse:up', function () {
      if (!ed.boxStart || !ed.boxTemp) return
      var box = ed.boxTemp
      var start = ed.boxStart
      ed.boxStart = null; ed.boxTemp = null
      c.remove(box)
      c.off('mouse:down'); c.off('mouse:move'); c.off('mouse:up')
      c.forEachObject(function (o) { var allow = !o.cdaLocked && o.cdaRole !== 'background'; o.selectable = allow; o.evented = allow })
      c.selection = true
      c.defaultCursor = 'default'
      c.requestRenderAll()
      setEditorTool('select'); buildEditorTools()
      if (box.width < 8 || box.height < 8) { toast('框选区域太小，再画一次'); return }
      boxCutoutDialog({
        x0: start.x < box.left + box.width / 2 ? Math.min(start.x, box.left) : Math.min(start.x, box.left),
        y0: Math.min(start.y, box.top),
        x1: Math.max(start.x, box.left + box.width),
        y1: Math.max(start.y, box.top + box.height),
      })
    })
    toast('在画面上拖出要保留或擦除的矩形')
  }

  function boxCutoutDialog(box) {
    var ed = state.editor
    var target = ed && ed.cutTarget
    if (!target) { toast('抠图目标丢了，请重新选中图片'); return }
    var modal = el('div', { className: 'cds-modal' })
    var close = function () { if (modal.parentNode) modal.parentNode.removeChild(modal) }
    var scale = 1 / ed.scale
    var pixelBox = { x0: box.x0 * scale, y0: box.y0 * scale, x1: box.x1 * scale, y1: box.y1 * scale }
    var dlg = el('div', { className: 'cds-dialog' }, [
      el('h3', { text: '框选区域怎么处理？' }),
      el('p', { text: '默认“智能去边”会识别框内完整主体并按头发/衣服/产品边缘去背，不是矩形截图；“直接裁剪”只做矩形裁切，通常不推荐。' }),
      el('div', { className: 'cds-dialogacts', style: { flexWrap: 'wrap', justifyContent: 'flex-end' } }, [
        el('button', { className: 'cds-btn', onclick: close }, [el('span', { text: '取消' })]),
        el('button', { className: 'cds-btn', onclick: function () { close(); applyCutout(target, { mode: 'erase', box: pixelBox }) } }, [el('span', { text: '擦除框内' })]),
        el('button', { className: 'cds-btn ghost', onclick: function () { close(); applyCutout(target, { mode: 'box', box: pixelBox }) } }, [el('span', { text: '直接裁剪（不推荐）' })]),
        el('button', { className: 'cds-btn primary', onclick: function () { close(); applyCutout(target, { mode: 'box-smart', box: pixelBox }) } }, [el('span', { text: '智能去边（默认）' })]),
      ]),
    ])
    modal.appendChild(dlg)
    modal.addEventListener('click', function (e) { if (e.target === modal) close() })
    state.windowEl.appendChild(modal)
  }

  async function importEditorFont() {
    var ed = state.editor
    if (!ed) return
    var input = el('input', { type: 'file', accept: '.ttf,.otf,.woff2', style: { display: 'none' } })
    state.windowEl.appendChild(input)
    input.onchange = async function () {
      var file = input.files && input.files[0]
      if (!file) { input.remove(); return }
      var family = await promptDialog('导入字体', '给字体起个名字（用于画布和 AI 重新排版）', file.name.replace(/\.[^.]+$/, ''))
      if (!family) { input.remove(); return }
      var fd = new FormData()
      fd.append('file', file, file.name)
      fd.append('family', family)
      try {
        var data = await api('/fonts/import', { method: 'POST', body: fd })
        state.fonts = data.customFonts || state.fonts
        installCustomFonts(state.fonts)
        var one = activeObjects()[0]
        if (one && one.cdaType === 'text') { one.set('fontFamily', family); ed.canvas.requestRenderAll(); markDirty() }
        buildEditorProps()
        toast('字体已导入：' + family)
      } catch (err) { toast('导入失败：' + err.message) }
      finally { input.remove() }
    }
    input.click()
  }

  async function editorHandoff() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var ok = await editorSave(true)
    if (!ok) return
    setEditorBusy(true, '正在整理图层和底图…')
    var textStates = []
    try {
      var previewUrl = await editorOutputDataUrl()
      ed.canvas.getObjects().forEach(function (o) {
        if (o.cdaType === 'text') { textStates.push({ o: o, visible: o.visible }); o.visible = false }
      })
      ed.canvas.discardActiveObject()
      ed.canvas.renderAll()
      var cleanUrl = await editorOutputDataUrl()
      textStates.forEach(function (s) { s.o.visible = s.visible })
      ed.canvas.renderAll()
      var previewBlob = await (await fetch(previewUrl)).blob()
      var cleanBlob = await (await fetch(cleanUrl)).blob()
      var previewFd = new FormData()
      previewFd.append('file', previewBlob, (ed.project.title || '手动封面') + '_预览.png')
      var previewUp = await api('/upload', { method: 'POST', body: previewFd })
      var cleanFd = new FormData()
      cleanFd.append('file', cleanBlob, (ed.project.title || '手动封面') + '_无字底图.png')
      var cleanUp = await api('/upload', { method: 'POST', body: cleanFd })
      if (!previewUp.upload || !cleanUp.upload) throw new Error('上传失败')
      var handoffVt = ed.canvas.viewportTransform ? ed.canvas.viewportTransform.slice() : [1, 0, 0, 1, 0, 0]
      ed.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      var layers = serializeEditorLayers()
      ed.canvas.setViewportTransform(handoffVt)
      var textLayers = layers.filter(function (l) { return l.type === 'text' || l.type === 'vertical-text' })
      var sortedTexts = textLayers.slice().sort(function (a, b) { return (Number(b.fontSize) || 0) - (Number(a.fontSize) || 0) })
      var handoffTitle = String(sortedTexts[0]?.text || ed.project.title || '').slice(0, 80)
      var handoffSubtitle = String(sortedTexts[1]?.text || ed.project.subtitle || '').slice(0, 160)
      var manualContext = {
        projectId: ed.project.id,
        title: handoffTitle,
        subtitle: handoffSubtitle,
        ratio: ed.project.ratio || '',
        layerCount: layers.length,
        textSummary: textLayers.map(function (l) { return { text: String(l.text || '').slice(0, 120), x: Number(l.x) || 0, y: Number(l.y) || 0, w: Number(l.w) || 0, h: Number(l.h) || 0, fontSize: Number(l.fontSize) || 0, color: l.color || '', type: l.type } }),
        layers: layers.slice(0, 24),
        note: '这是用户在手动画布上的排版，已把文字隐藏后导出无字底图。请保留主体构图和视觉元素，在此基础上重排文字。',
      }
      state.form.title = handoffTitle || state.form.title
      state.form.subtitle = handoffSubtitle || state.form.subtitle
      state.form.ratio = ed.project.ratio || state.form.ratio
      if (!state.form.brief.trim()) state.form.brief = '基于刚才的手动画布继续完善：' + (handoffTitle || ed.project.title || '')
      state.form.referenceIds = [cleanUp.upload.id, previewUp.upload.id].concat((state.form.referenceIds || []).filter(function (id) { return id !== cleanUp.upload.id && id !== previewUp.upload.id }))
      state.form.handoffRefIds = [cleanUp.upload.id, previewUp.upload.id]
      state.form.baseReferenceId = cleanUp.upload.id
      state.form.manualContext = manualContext
      state.form.handoffPreviewId = previewUp.upload.id
      state.form.handoffSource = ed.project.id
      state.uploads = [cleanUp.upload, previewUp.upload].concat((state.uploads || []).filter(function (u) { return u.id !== cleanUp.upload.id && u.id !== previewUp.upload.id }))
      state.createMode = 'ai'
      closeEditor(true)
      switchTab('create')
      renderCreatePage()
      toast('已交给 AI：构图已同步，点“生成”让 AI 重排文字')
    } catch (err) {
      toast('交给 AI 失败：' + err.message)
    } finally {
      textStates.forEach(function (s) { if (s.o) s.o.visible = s.visible })
      setEditorBusy(false)
    }
  }

  async function initFabric(project, canvasBox, wrap) {
    var ed = state.editor
    var target = targetSize(project.ratio)
    var ratio = target.w / target.h
    ed.targetW = target.w; ed.targetH = target.h
    var displayW = Math.min(1400, Math.max(320, wrap.clientWidth - 40))
    var displayH = displayW / ratio
    if (displayH > wrap.clientHeight - 20) { displayH = Math.max(260, wrap.clientHeight - 20); displayW = displayH * ratio }
    ed.displayW = Math.round(displayW); ed.displayH = Math.round(displayH); ed.scale = ed.displayW / ed.targetW
    canvasBox.style.width = ed.displayW + 'px'
    canvasBox.style.height = ed.displayH + 'px'
    var canvas = new fabric.Canvas(ed.canvasEl, {
      width: ed.displayW, height: ed.displayH,
      backgroundColor: '#0B0F14', preserveObjectStacking: true, selection: true,
      enableRetinaScaling: true,
    })
    ed.canvas = canvas
    if (canvas.upperCanvasEl) {
      canvas.upperCanvasEl.addEventListener('wheel', function (e) {
        if (!e.deltaY) return
        e.preventDefault()
        e.stopPropagation()
        var zoom = Math.max(0.2, Math.min(4, canvas.getZoom() * Math.pow(0.999, e.deltaY)))
        canvas.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), zoom)
        ed.zoom = zoom
        clampCanvasView()
        canvas.requestRenderAll()
        updateZoomLabel()
      }, { passive: false })
    }
    var accent = (state.overlay && getComputedStyle(state.overlay).getPropertyValue('--cds-accent')) || '#0169CC'
    fabric.Object.prototype.set({ borderColor: accent.trim() || '#0169CC', cornerColor: accent.trim() || '#0169CC', cornerSize: 8, transparentCorners: false, borderScaleFactor: 1.2 })
    canvas.on('selection:created', function (opt) {
      var act = (opt && opt.selected) ? opt.selected : []
      var layers = act.filter(function (o) { return o.cdaRole !== 'background' })
      ed.layerSelection = layers
      buildEditorProps()
    })
    canvas.on('selection:updated', function (opt) {
      var act = (opt && opt.selected) ? opt.selected : []
      var layers = act.filter(function (o) { return o.cdaRole !== 'background' })
      ed.layerSelection = layers
      buildEditorProps()
    })
    canvas.on('selection:cleared', function () { ed.layerSelection = []; buildEditorProps() })
    canvas.on('object:modified', function (opt) { if (ed.manual && opt && opt.target && opt.target.cdaRole === 'background') ed.backgroundRect = rectOfObject(opt.target); markDirty(); pushUndo(); buildEditorProps() })
    canvas.on('object:added', function (opt) { if (opt.target && opt.target.cdaRole !== 'background') { markDirty() } })
    canvas.on('text:changed', function () { markDirty(); buildEditorProps() })
    canvas.on('path:created', function (opt) {
      var path = opt && opt.path
      if (path) {
        path.set({
          cdaRole: 'annotation',
          cdaType: state.editor && state.editor.tool === 'marker' ? 'marker' : 'pen',
          cdaLayerId: 'path-' + Date.now().toString(36),
          selectable: true,
          evented: true,
        })
      }
      markDirty(); pushUndo(); buildEditorProps(); buildEditorTools()
    })

    await new Promise(function (resolve) {
      var url = project.backgroundUrl || project.coverUrl
      if (!url) return resolve()
      fabric.Image.fromURL(url, function (img) {
        if (!img || !img.width) return resolve()
        var targetW = ed.targetW
        var targetH = ed.targetH
        var rect = project.backgroundRect && project.backgroundRect.w ? project.backgroundRect : null
        if (!rect) {
          var cover = Math.max(targetW / img.width, targetH / img.height)
          var tw = img.width * cover
          var th = img.height * cover
          rect = { x: (targetW - tw) / 2, y: (targetH - th) / 2, w: tw, h: th }
        }
        ed.backgroundRect = rect
        img.set({
          left: rect.x * ed.scale,
          top: rect.y * ed.scale,
          scaleX: (rect.w * ed.scale) / img.width,
          scaleY: (rect.h * ed.scale) / img.height,
          selectable: false,
          evented: false,
          hoverCursor: 'default',
          visible: project.backgroundVisible !== false,
          cdaRole: 'background',
          cdaType: 'background',
          cdaFilter: project.backgroundFilter || null,
        })
        canvas.add(img)
        canvas.sendToBack(img)
        ed.bgObject = img
        canvas.requestRenderAll()
        resolve()
      }, { crossOrigin: 'anonymous' })
    })

    var layers = Array.isArray(project.layers) ? project.layers : []
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li]
      try {
        if (L.type === 'text' || L.type === 'vertical-text') addTextLayer(L)
        else if (L.type === 'rect' || L.type === 'ellipse') addShapeLayer(L)
        else if (L.type === 'line') addLineLayer(L)
        else if (L.type === 'arrow') addArrowLayer(L)
        else if (L.type === 'image') await addImageLayer(L)
      } catch (e) { console.warn('layer load failed', e) }
    }
    canvas.requestRenderAll()
    pushUndo()
    ed.dirty = false
    updateZoomLabel()
    buildEditorProps()
  }

  function applyLayerLock(obj, L) {
    obj.cdaLocked = !!L.locked
    obj.lockMovementX = obj.lockMovementY = obj.cdaLocked
    if (obj.cdaLocked) { obj.selectable = false; obj.evented = false }
    return obj
  }

  function addTextLayer(L) {
    var ed = state.editor
    var c = ed.canvas
    var color = L.color || '#F7F3EA'
    var family = FONT_MAP[L.fontFamily] || 'Cover Serif'
    var fontSize = Math.max(8, (L.fontSize || 80) * ed.scale)
    if (L.type === 'vertical-text' || L.vertical) {
      var cols = Array.isArray(L.columns) && L.columns.length ? L.columns : [String(L.text || '')]
      var colW = (L.colW || L.fontSize * 1.02) * ed.scale
      var gap = (L.columnGap || L.fontSize * 0.18) * ed.scale
      var groupId = L.id || ('vg-' + Date.now().toString(36))
      var vTextH = (L.textH || 0) * ed.scale
      var vTop = (L.y || 0) * ed.scale + Math.max(0, ((L.h || 0) * ed.scale - vTextH) / 2)
      cols.forEach(function (col, idx) {
        var o = new fabric.IText(String(col || '').split('').join('\n'), {
          left: (L.x || 0) * ed.scale + idx * (colW + gap),
          top: vTop,
          fontSize: fontSize, fontFamily: family, fontWeight: L.fontWeight || 900,
          fill: color, textAlign: 'center', lineHeight: L.lineHeight || 1.0,
          charSpacing: 0,
          visible: L.visible !== false,
          shadow: new fabric.Shadow({ color: 'rgba(0,0,0,.5)', blur: 12, offsetY: 4 }),
          cdaRole: L.role || 'annotation', cdaType: 'text', cdaVertical: true,
          cdaGroupId: groupId, cdaColumnIndex: idx, cdaLayerId: groupId + '-' + idx,
        })
        applyLayerLock(o, L)
        c.add(o)
      })
      return
    }
    var lines = Array.isArray(L.lines) && L.lines.length ? L.lines : String(L.text || '').split('\n')
    var text = lines.join('\n')
    var hTextH = (L.textH || 0) * ed.scale
    var hTop = (L.y || 0) * ed.scale + Math.max(0, ((L.h || 0) * ed.scale - hTextH) / 2)
    var obj = new fabric.Textbox(text, {
      left: (L.x || 0) * ed.scale,
      top: hTop,
      width: Math.max(40, (L.w || 400) * ed.scale + 2),
      fontSize: fontSize, fontFamily: family, fontWeight: L.fontWeight || 900,
      fill: color, textAlign: L.align || 'left', lineHeight: L.lineHeight || 1.1,
      charSpacing: Math.round(((L.tracking || 0) / Math.max(1, L.fontSize || 1)) * 1000),
      splitByGrapheme: true,
      visible: L.visible !== false,
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,.5)', blur: 12, offsetY: 4 }),
      cdaRole: L.role || 'annotation', cdaType: 'text', cdaVertical: false,
      cdaLayerId: L.id || ('t-' + Date.now().toString(36)),
      cdaOriginal: { fontSize: L.fontSize, tracking: L.tracking, w: L.w, h: L.h, x: L.x, y: L.y },
    })
    applyLayerLock(obj, L)
    c.add(obj)
  }

  function addShapeLayer(L) {
    var ed = state.editor
    var c = ed.canvas
    var common = {
      left: (L.x || 0) * ed.scale, top: (L.y || 0) * ed.scale,
      fill: L.fill || 'transparent', stroke: L.stroke || 'rgba(255,255,255,.8)',
      strokeWidth: Math.max(1, (L.strokeWidth || 2) * ed.scale),
      opacity: L.opacity ?? 1, angle: L.angle || 0, visible: L.visible !== false,
      cdaRole: 'annotation', cdaType: L.type, cdaLayerId: L.id || ('s-' + Date.now().toString(36)),
    }
    var obj
    if (L.type === 'ellipse') {
      obj = new fabric.Ellipse(Object.assign({}, common, { rx: Math.abs((L.w || 100) * ed.scale / 2), ry: Math.abs((L.h || 100) * ed.scale / 2), originX: 'left', originY: 'top', width: Math.abs((L.w || 100) * ed.scale), height: Math.abs((L.h || 100) * ed.scale) }))
    } else {
      obj = new fabric.Rect(Object.assign({}, common, { width: Math.abs((L.w || 100) * ed.scale), height: Math.abs((L.h || 100) * ed.scale), rx: 2, ry: 2 }))
    }
    applyLayerLock(obj, L)
    c.add(obj)
  }

  function addLineLayer(L) {
    var ed = state.editor
    var c = ed.canvas
    var line = new fabric.Line([(L.x1 || 0) * ed.scale, (L.y1 || 0) * ed.scale, (L.x2 || 0) * ed.scale, (L.y2 || 0) * ed.scale], {
      stroke: L.stroke || '#F7F3EA', strokeWidth: Math.max(1, (L.strokeWidth || 3) * ed.scale),
      opacity: L.opacity ?? 1, visible: L.visible !== false, cdaRole: 'annotation', cdaType: 'line', cdaLayerId: L.id || ('l-' + Date.now().toString(36)),
    })
    applyLayerLock(line, L)
    c.add(line)
  }

  function addArrowLayer(L) {
    var ed = state.editor
    var c = ed.canvas
    var x1 = Number(L.x1)
    var y1 = Number(L.y1)
    var x2 = Number(L.x2)
    var y2 = Number(L.y2)
    if (![x1, y1, x2, y2].every(Number.isFinite)) return
    var color = L.fill || '#F7F3EA'
    var path = makeArrowObject(
      { x: x1 * ed.scale, y: y1 * ed.scale },
      { x: x2 * ed.scale, y: y2 * ed.scale },
      color,
    )
    if (!path) return
    path.set({
      fill: color,
      stroke: L.stroke || color,
      strokeWidth: Math.max(1, (Number(L.strokeWidth) || 1) * ed.scale),
      opacity: L.opacity ?? 1,
      visible: L.visible !== false,
      cdaLayerId: L.id || ('arrow-' + Date.now().toString(36)),
      cdaArrow: { x1, y1, x2, y2 },
    })
    applyLayerLock(path, L)
    c.add(path)
  }

  function updateZoomLabel() {
    var ed = state.editor
    if (!ed || !ed.canvas || !ed.zoomLabel) return
    ed.zoomLabel.textContent = Math.round(ed.canvas.getZoom() * 100) + '%'
  }

  function clampCanvasView() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var c = ed.canvas
    var z = c.getZoom()
    var vw = c.getWidth()
    var vh = c.getHeight()
    var aw = ed.displayW * z
    var ah = ed.displayH * z
    var vt = c.viewportTransform ? c.viewportTransform.slice() : [z, 0, 0, z, 0, 0]
    var tx = vt[4]
    var ty = vt[5]
    var cx = tx + aw / 2
    var cy = ty + ah / 2
    var ncx = Math.max(vw * 0.18, Math.min(vw * 0.82, cx))
    var ncy = Math.max(vh * 0.18, Math.min(vh * 0.82, cy))
    if (Math.abs(ncx - cx) > 0.5 || Math.abs(ncy - cy) > 0.5) {
      c.setViewportTransform([z, 0, 0, z, tx + (ncx - cx), ty + (ncy - cy)])
    }
  }

  function centerEditorCanvas() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var c = ed.canvas
    var z = c.getZoom()
    c.setViewportTransform([z, 0, 0, z, (c.getWidth() - ed.displayW * z) / 2, (c.getHeight() - ed.displayH * z) / 2])
    c.requestRenderAll()
    updateZoomLabel()
  }

  function setEditorZoom(factor) {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var c = ed.canvas
    var zoom = Math.max(0.2, Math.min(4, c.getZoom() * factor))
    c.zoomToPoint(new fabric.Point(c.getWidth() / 2, c.getHeight() / 2), zoom)
    ed.zoom = zoom
    clampCanvasView()
    c.requestRenderAll()
    updateZoomLabel()
  }

  function resetEditorZoom() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    ed.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    ed.zoom = 1
    centerEditorCanvas()
    ed.canvas.requestRenderAll()
    updateZoomLabel()
  }

  function fitEditorCanvas() {
    centerEditorCanvas()
  }

  function rectOfObject(o) {
    var ed = state.editor
    if (!ed || !o) return null
    var b = o.getBoundingRect(true, true)
    return { x: b.left / ed.scale, y: b.top / ed.scale, w: b.width / ed.scale, h: b.height / ed.scale }
  }

  function activeObjects() {
    var ed = state.editor
    if (!ed || !ed.canvas) return []
    var a = ed.canvas.getActiveObjects()
    return a && a.length ? a : (ed.canvas.getActiveObject() ? [ed.canvas.getActiveObject()] : [])
  }

  function deleteActive() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var objs = activeObjects()
    if (!objs.length) { toast('先在画布或右侧图层里选中要删除的对象'); return }
    var removed = 0
    objs.forEach(function (o) { if (o.cdaRole !== 'background') { ed.canvas.remove(o); removed++ } })
    if (!removed) { toast('底图不能删除；可以在图层面板里隐藏它'); return }
    ed.canvas.discardActiveObject()
    ed.canvas.requestRenderAll()
    markDirty(); pushUndo(); buildEditorProps()
    toast('已删除 ' + removed + ' 个图层')
  }

  function filterControls(obj) {
    var f = Object.assign({ brightness: 100, contrast: 100, saturate: 100, blur: 0 }, obj.cdaFilter || {})
    var wrap = el('div', {})
    ;['brightness', 'contrast', 'saturate', 'blur'].forEach(function (key) {
      var max = key === 'blur' ? 10 : 200
      var step = key === 'blur' ? '0.5' : '1'
      var input = el('input', { className: 'cds-input', type: 'range', min: '0', max: String(max), step: step, value: String(f[key]) })
      input.addEventListener('input', function () {
        f[key] = Number(input.value)
        applyImageFilter(obj, Object.assign({}, f))
        if (obj.canvas) obj.canvas.requestRenderAll()
        markDirty()
      })
      wrap.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label' }, [el('span', { text: { brightness: '亮度', contrast: '对比度', saturate: '饱和度', blur: '模糊' }[key] }), el('span', { className: 'cds-hint', text: String(f[key]) })]), input]))
    })
    return wrap
  }

  function alignObject(o, mode) {
    var ed = state.editor
    if (!ed || !o) return
    var b = o.getBoundingRect(true, true)
    var dx = 0
    var dy = 0
    if (mode === 'left') dx = 0 - b.left
    else if (mode === 'right') dx = ed.displayW - (b.left + b.width)
    else if (mode === 'hcenter') dx = (ed.displayW - b.width) / 2 - b.left
    else if (mode === 'top') dy = 0 - b.top
    else if (mode === 'bottom') dy = ed.displayH - (b.top + b.height)
    else if (mode === 'vcenter') dy = (ed.displayH - b.height) / 2 - b.top
    o.set({ left: o.left + dx, top: o.top + dy })
    ed.canvas.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps()
  }

  function layerLabel(o) {
    if (!o) return '图层'
    if (o.cdaRole === 'background') return '底图（裁切 / 滤镜）'
    if (o.cdaVertical) return '竖排 · ' + String(o.text || '').replace(/\n/g, '').slice(0, 14)
    if (o.cdaType === 'text') return '文字 · ' + String(o.text || '').slice(0, 14)
    if (o.cdaCutoutBackground) return '背景 · 已去主体'
    if (o.cdaType === 'image') return o.cdaCutout ? '抠图 · 可继续编辑' : '图片 / 贴纸'
    if (o.cdaType === 'rect') return '矩形'
    if (o.cdaType === 'ellipse') return '椭圆'
    if (o.cdaType === 'line') return '直线'
    if (o.cdaType === 'arrow') return '箭头'
    if (o.cdaType === 'marker') return '荧光笔'
    if (o.cdaType === 'pen' || o.type === 'path') return '手绘路径'
    return o.cdaType || o.type || '对象'
  }

  function layerRow(o, selectedObjs, isBg, selectedLayers) {
    var ed = state.editor
    var c = ed.canvas
    var isOn = selectedObjs.indexOf(o) >= 0
    var multiOn = (selectedLayers || []).indexOf(o) >= 0
    var locked = !!o.cdaLocked
    var row = el('div', {
      className: 'cds-layeritem' + (isBg ? ' is-bg' : '') + (o.visible === false ? ' is-hidden' : '') + (locked ? ' is-locked' : '') + (multiOn ? ' is-multi' : ''),
      'data-on': isOn ? '1' : '0',
      draggable: isBg ? 'false' : 'true',
    }, [
      !isBg ? el('span', { className: 'cds-lcheck' + (multiOn ? ' on' : ''), text: multiOn ? '✓' : '', title: '多选图层', onclick: function (e) { e.stopPropagation(); toggleLayerSelection(o) } }) : el('span', { className: 'cds-lcheck disabled' }),
      el('span', { className: 'cds-lgrip', title: isBg ? '底图固定在最底层' : '拖动调整图层顺序' }, [icon('grip')]),
      el('span', { className: 'cds-licon', text: o.cdaRole === 'background' ? 'BG' : (o.cdaType === 'text' ? 'T' : (o.cdaType === 'image' ? '▣' : '◇')) }),
      el('span', { className: 'cds-llabel', title: layerLabel(o), text: layerLabel(o) }),
      el('span', { className: 'cds-layeracts' }, [
        el('button', { className: 'cds-layerbtn', title: o.visible === false ? '显示图层' : '隐藏图层', onclick: function (e) {
          e.stopPropagation(); o.visible = o.visible === false; c.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps()
        } }, [icon(o.visible === false ? 'eyeoff' : 'eye')]),
        !isBg ? el('button', { className: 'cds-layerbtn', title: locked ? '解锁图层' : '锁定图层', onclick: function (e) {
          e.stopPropagation(); o.cdaLocked = !locked; o.lockMovementX = o.lockMovementY = o.cdaLocked
          if (o.cdaLocked) c.discardActiveObject()
          else { o.selectable = true; o.evented = true }
          c.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps()
        } }, [icon(locked ? 'lock' : 'unlock')]) : null,
        !isBg ? el('button', { className: 'cds-layerbtn danger', title: '删除图层', onclick: function (e) {
          e.stopPropagation(); c.remove(o); c.discardActiveObject(); c.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps(); toast('已删除图层')
        } }, [icon('trash')]) : null,
      ]),
    ])
    row.addEventListener('click', function (ev) {
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { toggleLayerSelection(o); return }
      if (locked) { toast('图层已锁定，先点锁图标解锁'); return }
      ed.layerSelection = [o]
      c.forEachObject(function (x) {
        var allow = !x.cdaLocked && (x.cdaRole !== 'background' || isBg)
        x.selectable = allow
        x.evented = allow
      })
      if (isBg) o.selectable = o.evented = true
      c.setActiveObject(o)
      if (isBg) { ed.tool = 'background'; c.defaultCursor = 'move' } else { ed.tool = 'select'; c.defaultCursor = 'default' }
      c.requestRenderAll(); buildEditorProps()
    })
    if (!isBg) {
      row.addEventListener('dragstart', function (ev) {
        ed.layerDrag = o
        row.classList.add('is-dragging')
        try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', o.cdaLayerId || 'layer') } catch {}
      })
      row.addEventListener('dragend', function () {
        ed.layerDrag = null
        row.classList.remove('is-dragging')
        Array.prototype.forEach.call(ed.propsEl.querySelectorAll('.cds-layeritem'), function (n) { n.classList.remove('drop-above', 'drop-below') })
      })
      row.addEventListener('dragover', function (ev) {
        if (!ed.layerDrag || ed.layerDrag === o) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'move'
        var rect = row.getBoundingClientRect()
        var below = ev.clientY > rect.top + rect.height / 2
        row.classList.toggle('drop-below', below)
        row.classList.toggle('drop-above', !below)
      })
      row.addEventListener('dragleave', function () { row.classList.remove('drop-above', 'drop-below') })
      row.addEventListener('drop', function (ev) {
        ev.preventDefault()
        var rect = row.getBoundingClientRect()
        var below = ev.clientY > rect.top + rect.height / 2
        row.classList.remove('drop-above', 'drop-below')
        reorderLayer(ed.layerDrag, o, below)
      })
    }
    return row
  }

  function reorderLayer(dragged, target, below) {
    var ed = state.editor
    if (!ed || !dragged || !target || dragged === target) return
    if (dragged.cdaRole === 'background' || target.cdaRole === 'background') return
    var c = ed.canvas
    c.remove(dragged)
    var objects = c.getObjects()
    var idx = objects.indexOf(target)
    if (idx < 0) c.add(dragged)
    else c.insertAt(dragged, below ? idx : idx + 1, false)
    c.setActiveObject(dragged)
    c.requestRenderAll()
    markDirty(); pushUndo(); buildEditorProps()
    toast('图层顺序已调整')
  }

  function toggleLayerSelection(o) {
    var ed = state.editor
    if (!ed || !o || o.cdaRole === 'background') return
    var arr = ed.layerSelection || []
    var i = arr.indexOf(o)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(o)
    ed.layerSelection = arr
    var selectable = arr.filter(function (x) { return x.visible !== false && !x.cdaLocked })
    if (selectable.length > 1) {
      try { ed.canvas.setActiveObject(new fabric.ActiveSelection(selectable, { canvas: ed.canvas })) } catch {}
    } else if (selectable.length === 1) {
      ed.canvas.setActiveObject(selectable[0])
    } else {
      ed.canvas.discardActiveObject()
    }
    ed.canvas.requestRenderAll()
    buildEditorProps()
  }

  function selectAllLayers() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var all = ed.canvas.getObjects().filter(function (o) { return o.cdaRole !== 'background' })
    ed.layerSelection = (ed.layerSelection || []).length === all.length ? [] : all
    var selectable = ed.layerSelection.filter(function (x) { return x.visible !== false && !x.cdaLocked })
    if (selectable.length > 1) {
      try { ed.canvas.setActiveObject(new fabric.ActiveSelection(selectable, { canvas: ed.canvas })) } catch {}
    } else if (selectable.length === 1) {
      ed.canvas.setActiveObject(selectable[0])
    } else {
      ed.canvas.discardActiveObject()
    }
    ed.canvas.requestRenderAll()
    buildEditorProps()
  }

  function deleteLayerSelection() {
    var ed = state.editor
    if (!ed || !ed.canvas) return
    var arr = (ed.layerSelection || []).filter(function (o) { return o.cdaRole !== 'background' })
    if (!arr.length) return
    arr.forEach(function (o) { ed.canvas.remove(o) })
    ed.layerSelection = []
    ed.canvas.discardActiveObject()
    ed.canvas.requestRenderAll()
    markDirty(); pushUndo(); buildEditorProps()
    toast('已删除 ' + arr.length + ' 个图层')
  }

  function buildEditorProps() {
    var ed = state.editor
    if (!ed || !ed.propsEl) return
    clear(ed.propsEl)
    var objs = activeObjects()
    var one = objs.length === 1 ? objs[0] : null

    // layers
    var group = el('div', { className: 'cds-propgroup' })
    group.appendChild(el('h4', { text: '图层 · 拖动排序' }))
    var all = ed.canvas ? ed.canvas.getObjects().filter(function (o) { return o.cdaRole !== 'background' }) : []
    var bgObj = ed.canvas ? ed.canvas.getObjects().find(function (o) { return o.cdaRole === 'background' }) : null
    ed.layerSelection = (ed.layerSelection || []).filter(function (o) { return all.indexOf(o) >= 0 })
    var selectedLayers = ed.layerSelection
    group.appendChild(el('div', { className: 'cds-layerbar' }, [
      el('button', { className: 'cds-btn ghost sm', onclick: selectAllLayers }, [el('span', { text: selectedLayers.length === all.length && all.length ? '取消全选' : '全选图层' })]),
      el('button', { className: 'cds-btn ghost sm danger', disabled: !selectedLayers.length, onclick: deleteLayerSelection }, [icon('trash'), el('span', { text: '删除选中' + (selectedLayers.length ? ' ' + selectedLayers.length : '') })]),
    ]))
    var list = el('div', { className: 'cds-layerlist' })
    all.slice().reverse().forEach(function (o) {
      list.appendChild(layerRow(o, objs, false, selectedLayers))
    })
    if (bgObj) list.appendChild(layerRow(bgObj, objs, true, selectedLayers))
    if (!all.length && !bgObj) list.appendChild(el('div', { className: 'cds-hint', text: '还没有图层，先用左侧工具加文字或图片' }))
    group.appendChild(list)
    group.appendChild(el('div', { className: 'cds-layerhint', text: '勾选或 Ctrl/Shift 点图层可多选；全选后一键删除。拖动行调整上下顺序，眼睛控制显示，锁控制能否选中。' }))
    ed.propsEl.appendChild(group)

    var drawTools = ['pen', 'marker', 'arrow', 'rect', 'ellipse', 'line']
    if (drawTools.indexOf(ed.tool) >= 0) {
      var brushGroup = el('div', { className: 'cds-propgroup' })
      brushGroup.appendChild(el('h4', { text: ed.tool === 'pen' ? '画笔设置' : (ed.tool === 'marker' ? '荧光笔设置' : '形状设置') }))
      var isPen = ed.tool === 'pen'
      var isMarker = ed.tool === 'marker'
      var curColor = isPen ? ed.penColor : (isMarker ? ed.markerColor : ed.shapeColor)
      var curWidth = isPen ? ed.penWidth : (isMarker ? ed.markerWidth : ed.shapeWidth)
      var colorPick = el('input', { className: 'cds-input', type: 'color', value: toHex(curColor), oninput: function (e) {
        var v = e.target.value
        if (isPen) ed.penColor = v
        else if (isMarker) ed.markerColor = v
        else ed.shapeColor = v
        var c = ed.canvas
        if (c && c.freeDrawingBrush) c.freeDrawingBrush.color = isPen ? ed.penColor : hexToRgba(ed.markerColor, ed.markerOpacity)
      } })
      var widthPick = el('input', { className: 'cds-input', type: 'range', min: '1', max: isMarker ? '80' : '40', value: Math.round(curWidth), oninput: function (e) {
        var v = Math.max(1, Number(e.target.value) || 1)
        if (isPen) ed.penWidth = v
        else if (isMarker) ed.markerWidth = v
        else ed.shapeWidth = v
        if (isPen || isMarker) {
          var c = ed.canvas
          if (c && c.freeDrawingBrush) {
            c.freeDrawingBrush.width = v
            c.freeDrawingBrush.color = isPen ? ed.penColor : hexToRgba(ed.markerColor, ed.markerOpacity)
          }
        }
        widthLabel.textContent = v + 'px'
      } })
      var widthLabel = el('span', { className: 'cds-hint', text: Math.round(curWidth) + 'px' })
      brushGroup.appendChild(el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: isMarker ? '荧光笔颜色' : '颜色' }), colorPick]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label' }, [el('span', { text: '粗细' }), widthLabel]), widthPick]),
      ]))
      if (isMarker) {
        var op = el('input', { className: 'cds-input', type: 'range', min: '10', max: '80', value: Math.round((ed.markerOpacity || 0.35) * 100), oninput: function (e) {
          ed.markerOpacity = Math.max(0.1, Number(e.target.value) / 100)
          if (ed.canvas && ed.canvas.freeDrawingBrush) ed.canvas.freeDrawingBrush.color = hexToRgba(ed.markerColor, ed.markerOpacity)
        } })
        brushGroup.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '透明度' }), op]))
      }
      brushGroup.appendChild(el('div', { className: 'cds-hint', text: '先在这里选好颜色和粗细，再画；连续绘制会保持当前设置。' }))
      ed.propsEl.appendChild(brushGroup)
    }

    if (!one) {
      ed.propsEl.appendChild(el('div', { className: 'cds-note', text: objs.length ? '已选择 ' + objs.length + ' 个对象。可以整体拖动或删除。' : '选择画布上的文字或形状，这里会出现属性。' }))
      return
    }

    var p = el('div', { className: 'cds-propgroup' })
    p.appendChild(el('h4', { text: one.cdaRole === 'background' ? '底图裁切' : (one.cdaType === 'text' ? '文字' : (one.cdaType === 'image' ? '图片 / 贴纸' : (one.cdaType || one.type))) }))
    if (one.cdaRole === 'background') {
      p.appendChild(el('div', { className: 'cds-hint', text: '拖动/缩放底图即可裁切，画布外的部分会被裁掉。' }))
      p.appendChild(filterControls(one))
      p.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' } }, [
        el('button', { className: 'cds-btn sm', onclick: function () { applyCutout(one, { mode: 'smart', prompt: '' }) } }, [icon('wand'), el('span', { text: '抠出主体' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { beginBoxCutout() } }, [icon('crop'), el('span', { text: '框选抠图' })]),
      ]))
      p.appendChild(el('label', { className: 'cds-switch' }, [el('input', { type: 'checkbox', checked: one.visible !== false, onchange: function (e) { one.visible = e.target.checked; ed.canvas.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps() } }), el('span', { text: '显示底图' })]))
      p.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' } }, [
        el('button', { className: 'cds-btn sm', onclick: function () {
          var img = one
          var targetW = ed.targetW
          var targetH = ed.targetH
          var cover = Math.max(targetW / img.width, targetH / img.height)
          var tw = img.width * cover
          var th = img.height * cover
          img.set({ left: ((targetW - tw) / 2) * ed.scale, top: ((targetH - th) / 2) * ed.scale, scaleX: (tw * ed.scale) / img.width, scaleY: (th * ed.scale) / img.height })
          ed.backgroundRect = { x: (targetW - tw) / 2, y: (targetH - th) / 2, w: tw, h: th }
          ed.canvas.requestRenderAll(); markDirty(); buildEditorProps()
        } }, [el('span', { text: '铺满画布' })]),
        el('button', { className: 'cds-btn sm primary', onclick: function () { setEditorTool('select'); buildEditorTools(); buildEditorProps() } }, [el('span', { text: '完成裁切' })]),
      ]))
      ed.propsEl.appendChild(p)
      return
    }
    if (one.cdaType === 'text') {
      var ta = el('textarea', { className: 'cds-textarea', style: { minHeight: '58px' }, oninput: function (e) {
        var v = e.target.value
        if (one.cdaVertical) one.set('text', v.split('').join('\n'))
        else one.set('text', v)
        ed.canvas.requestRenderAll(); markDirty()
      } }, one.cdaVertical ? String(one.text || '').replace(/\n/g, '') : String(one.text || ''))
      p.appendChild(ta)
      var fontOpts = [{ v: 'Cover Serif', l: '思源宋体 Heavy' }, { v: 'Cover Sans', l: '思源黑体' }, { v: 'Arial', l: 'Arial' }].concat((state.fonts || []).map(function (f) { return { v: f.family, l: f.family } }))
      var fontSel = el('select', { className: 'cds-select', onchange: function (e) { one.set('fontFamily', e.target.value); ed.canvas.requestRenderAll(); markDirty() } }, fontOpts.map(function (o) {
        return el('option', { value: o.v, selected: one.fontFamily === o.v }, [el('span', { text: o.l })])
      }))
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label' }, [el('span', { text: '字体' }), el('button', { className: 'cds-btn ghost sm', style: { height: '20px', padding: '0 6px' }, onclick: importEditorFont }, [el('span', { text: '导入字体' })])]), fontSel]))
    }
    if (one.cdaType === 'text') {
      var fs = el('input', { className: 'cds-input', type: 'number', min: '6', max: '600', value: Math.round(one.fontSize || 40), oninput: function (e) { one.set('fontSize', Math.max(6, Number(e.target.value) || 6)); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '字号' }), fs]))
      var color = el('input', { className: 'cds-input', type: 'color', value: toHex(one.fill || '#F7F3EA'), oninput: function (e) { one.set('fill', e.target.value); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '文字颜色' }), color]))
      var align = el('div', { className: 'cds-ratio', style: { marginTop: '4px' } }, ['left', 'center', 'right'].map(function (a) {
        return el('button', { 'data-on': one.textAlign === a ? '1' : '0', onclick: function () { one.set('textAlign', a); ed.canvas.requestRenderAll(); markDirty(); buildEditorProps() } }, [el('span', { text: a === 'left' ? '左' : (a === 'center' ? '中' : '右') })])
      }))
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '对齐' }), align]))
      var tracking = el('input', { className: 'cds-input', type: 'number', step: '1', value: Math.round(one.charSpacing || 0), oninput: function (e) { one.set('charSpacing', Number(e.target.value) || 0); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '字距' }), tracking]))
      var lh = el('input', { className: 'cds-input', type: 'number', step: '0.02', value: one.lineHeight || 1.05, oninput: function (e) { one.set('lineHeight', Number(e.target.value) || 1); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '行高' }), lh]))
      p.appendChild(el('label', { className: 'cds-switch' }, [el('input', { type: 'checkbox', checked: !!one.shadow, onchange: function (e) { one.set('shadow', e.target.checked ? new fabric.Shadow({ color: 'rgba(0,0,0,.5)', blur: 14, offsetY: 4 }) : null); ed.canvas.requestRenderAll(); markDirty() } }), el('span', { text: '文字阴影' })]))
      var strokeW = el('input', { className: 'cds-input', type: 'number', min: '0', max: '30', step: '0.5', value: one.strokeWidth || 0, oninput: function (e) { one.set('strokeWidth', Math.max(0, Number(e.target.value) || 0)); one.set('stroke', one.stroke || '#000000'); ed.canvas.requestRenderAll(); markDirty() } })
      var strokeC = el('input', { className: 'cds-input', type: 'color', value: toHex(one.stroke || '#000000'), oninput: function (e) { one.set('stroke', e.target.value); one.set('strokeWidth', Math.max(1, one.strokeWidth || 2)); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '描边' }), strokeW]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '描边色' }), strokeC]),
      ]))
    } else if (one.cdaType === 'image') {
      p.appendChild(el('div', { className: 'cds-hint', text: '图片/贴纸可以拖动、缩放、旋转；抠图后会生成独立图层。' }))
      p.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', margin: '8px 0' } }, [
        el('button', { className: 'cds-btn sm primary', onclick: function () { applyCutout(one, { mode: 'smart', prompt: '' }) } }, [icon('wand'), el('span', { text: '智能抠图' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { beginBoxCutout() } }, [icon('crop'), el('span', { text: '框选抠图' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { one.set('flipX', !one.flipX); ed.canvas.requestRenderAll(); markDirty() } }, [icon('flipH'), el('span', { text: '水平翻转' })]),
        el('button', { className: 'cds-btn sm', onclick: function () { one.set('flipY', !one.flipY); ed.canvas.requestRenderAll(); markDirty() } }, [icon('flipV'), el('span', { text: '垂直翻转' })]),
      ]))
      p.appendChild(filterControls(one))
    } else if (one.cdaType === 'rect' || one.cdaType === 'ellipse' || one.cdaType === 'arrow') {
      var fillC = el('input', { className: 'cds-input', type: 'color', value: toHex(one.fill || '#000000'), oninput: function (e) { one.set('fill', e.target.value); ed.canvas.requestRenderAll(); markDirty() } })
      var lineC = el('input', { className: 'cds-input', type: 'color', value: toHex(one.stroke || '#F7F3EA'), oninput: function (e) { one.set('stroke', e.target.value); ed.canvas.requestRenderAll(); markDirty() } })
      var lineW = el('input', { className: 'cds-input', type: 'number', min: '0', max: '40', step: '0.5', value: one.strokeWidth || 0, oninput: function (e) { one.set('strokeWidth', Math.max(0, Number(e.target.value) || 0)); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '填充' }), fillC]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '描边色' }), lineC]),
      ]))
      p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '描边粗细' }), lineW]))
    } else if (one.cdaType === 'line' || one.type === 'path' || one.cdaType === 'pen' || one.cdaType === 'marker') {
      var sC = el('input', { className: 'cds-input', type: 'color', value: toHex(one.stroke || '#F7F3EA'), oninput: function (e) { one.set('stroke', e.target.value); ed.canvas.requestRenderAll(); markDirty() } })
      var sW = el('input', { className: 'cds-input', type: 'number', min: '0', max: '80', step: '0.5', value: one.strokeWidth || 2, oninput: function (e) { one.set('strokeWidth', Math.max(0, Number(e.target.value) || 0)); ed.canvas.requestRenderAll(); markDirty() } })
      p.appendChild(el('div', { className: 'cds-row' }, [
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '线条颜色' }), sC]),
        el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '线条粗细' }), sW]),
      ]))
      if (one.type === 'path' && one.strokeDashArray && one.strokeDashArray.length) {
        p.appendChild(el('div', { className: 'cds-hint', text: '这是手绘/荧光笔路径，可以改颜色、粗细和透明度。' }))
      }
    }
    var op = el('input', { className: 'cds-input', type: 'range', min: '0', max: '100', value: Math.round((one.opacity ?? 1) * 100), oninput: function (e) { one.set('opacity', Number(e.target.value) / 100); ed.canvas.requestRenderAll(); markDirty() } })
    p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '透明度' }), op]))
    var ang = el('input', { className: 'cds-input', type: 'number', value: Math.round(one.angle || 0), oninput: function (e) { one.set('angle', Number(e.target.value) || 0); ed.canvas.requestRenderAll(); markDirty() } })
    p.appendChild(el('div', { className: 'cds-field' }, [el('div', { className: 'cds-label', text: '角度' }), ang]))
    ed.propsEl.appendChild(p)

    var act = el('div', { className: 'cds-propgroup' })
    act.appendChild(el('h4', { text: '排列' }))
    act.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '6px' } }, [
      ['左', 'left'], ['水平居中', 'hcenter'], ['右', 'right'], ['上', 'top'], ['垂直居中', 'vcenter'], ['下', 'bottom'],
    ].map(function (pair) {
      return el('button', { className: 'cds-btn sm', title: '对齐到画布' + pair[0], onclick: function () { alignObject(one, pair[1]) } }, [el('span', { text: pair[0] })])
    })))
    act.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } }, [
      el('button', { className: 'cds-btn sm', onclick: function () { one.bringForward(); ed.canvas.requestRenderAll(); markDirty(); buildEditorProps() } }, [icon('up'), el('span', { text: '上移一层' })]),
      el('button', { className: 'cds-btn sm', onclick: function () { one.sendBackwards(); ed.canvas.requestRenderAll(); markDirty(); buildEditorProps() } }, [icon('down'), el('span', { text: '下移一层' })]),
      el('button', { className: 'cds-btn sm', onclick: duplicateActive }, [el('span', { text: '复制' })]),
      el('button', { className: 'cds-btn sm', onclick: function () {
        one.cdaLocked = !one.cdaLocked
        one.lockMovementX = one.lockMovementY = one.cdaLocked
        one.selectable = !one.cdaLocked
        one.evented = !one.cdaLocked
        if (one.cdaLocked) ed.canvas.discardActiveObject()
        ed.canvas.requestRenderAll(); markDirty(); pushUndo(); buildEditorProps()
      } }, [icon(one.cdaLocked ? 'lock' : 'unlock'), el('span', { text: one.cdaLocked ? '已锁定' : '锁定' })]),
      el('button', { className: 'cds-btn sm danger', onclick: deleteActive }, [icon('trash'), el('span', { text: '删除' })]),
    ]))
    ed.propsEl.appendChild(act)
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex || '#000000').replace('#', '')
    if (h.length === 3) h = h.split('').map(function (c) { return c + c }).join('')
    var n = parseInt(h, 16)
    var r = (n >> 16) & 255
    var g = (n >> 8) & 255
    var b = n & 255
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, Number(alpha) || 0.35)) + ')'
  }

  function toHex(color) {
    if (!color || typeof color !== 'string') return '#F7F3EA'
    if (color[0] === '#' && (color.length === 7 || color.length === 4)) {
      if (color.length === 4) return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      return color
    }
    var m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color)
    if (m) return '#' + [m[1], m[2], m[3]].map(function (x) { return Number(x).toString(16).padStart(2, '0') }).join('')
    return '#F7F3EA'
  }

  function editorOutputDataUrl() {
    var ed = state.editor
    return new Promise(function (resolve, reject) {
      var raw
      var vt = ed.canvas.viewportTransform ? ed.canvas.viewportTransform.slice() : [1, 0, 0, 1, 0, 0]
      try {
        ed.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
        raw = ed.canvas.toDataURL({ format: 'png', multiplier: 1 / ed.scale, quality: 1 })
      } catch (err) {
        ed.canvas.setViewportTransform(vt)
        reject(err)
        return
      }
      ed.canvas.setViewportTransform(vt)
      ed.canvas.requestRenderAll()
      var img = new Image()
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas')
          canvas.width = ed.targetW
          canvas.height = ed.targetH
          var ctx = canvas.getContext('2d')
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/png'))
        } catch (err) { reject(err) }
      }
      img.onerror = function () { reject(new Error('画布导出失败')) }
      img.src = raw
    })
  }

  function markDirty() { if (state.editor) state.editor.dirty = true }

  function snapshot() {
    var ed = state.editor
    if (!ed || !ed.canvas) return null
    try { return JSON.stringify(ed.canvas.toDatalessJSON(['cdaRole', 'cdaType', 'cdaVertical', 'cdaGroupId', 'cdaColumnIndex', 'cdaLayerId', 'cdaOriginal'])) } catch { return null }
  }

  function pushUndo() {
    var ed = state.editor
    if (!ed) return
    var s = snapshot()
    if (!s) return
    ed.undo.push(s)
    if (ed.undo.length > 40) ed.undo.shift()
    ed.redo.length = 0
  }

  function editorUndo() {
    var ed = state.editor
    if (!ed || !ed.canvas || !ed.undo.length) return
    var current = snapshot()
    var prev = ed.undo.pop()
    if (current) ed.redo.push(current)
    var parsed
    try { parsed = JSON.parse(prev) } catch { parsed = null }
    ed.canvas.loadFromJSON({ objects: (parsed && parsed.objects) || [] }, function () {
      ed.canvas.requestRenderAll(); markDirty(); buildEditorProps()
    })
  }

  function editorRedo() {
    var ed = state.editor
    if (!ed || !ed.canvas || !ed.redo.length) return
    var current = snapshot()
    var next = ed.redo.pop()
    if (current) ed.undo.push(current)
    var parsed
    try { parsed = JSON.parse(next) } catch { parsed = null }
    ed.canvas.loadFromJSON({ objects: (parsed && parsed.objects) || [] }, function () {
      ed.canvas.requestRenderAll(); markDirty(); buildEditorProps()
    })
  }

  function serializeEditorLayers() {
    var ed = state.editor
    var c = ed.canvas
    var scale = ed.scale
    var out = []
    var verticalGroups = {}
    c.getObjects().forEach(function (o) {
      if (o.cdaRole === 'background') return
      var t = o.cdaType || (o.type === 'textbox' || o.type === 'i-text' ? 'text' : o.type)
      if (t === 'text') {
        if (o.cdaVertical) {
          var gid = o.cdaGroupId || o.cdaLayerId || 'vg'
          if (!verticalGroups[gid]) {
            verticalGroups[gid] = { arr: [], slot: out.length }
            out.push(null)
          }
          verticalGroups[gid].arr.push(o)
          return
        }
        var bounds = o.getBoundingRect(true, true)
        out.push({
          id: o.cdaLayerId || ('t-' + out.length),
          type: 'text',
          role: o.cdaRole || 'annotation',
          text: String(o.text || ''),
          lines: String(o.text || '').split('\n'),
          x: bounds.left / scale, y: bounds.top / scale,
          w: bounds.width / scale, h: bounds.height / scale,
          fontSize: (o.fontSize * (o.scaleY || 1)) / scale,
          fontFamily: FONT_MAP_REV[o.fontFamily] || o.fontFamily || 'CoverSans',
          fontWeight: o.fontWeight || 500,
          color: typeof o.fill === 'string' ? o.fill : '#F7F3EA',
          align: o.textAlign || 'left',
          tracking: ((o.charSpacing || 0) / 1000) * (o.fontSize / scale),
          lineHeight: o.lineHeight || 1.1,
          opacity: o.opacity ?? 1,
          angle: o.angle || 0,
          visible: o.visible !== false,
          locked: !!o.cdaLocked,
          vertical: false,
          shadow: !!o.shadow,
          stroke: typeof o.stroke === 'string' ? o.stroke : '',
          strokeWidth: (o.strokeWidth || 0) / scale,
        })
      } else if (t === 'rect' || t === 'ellipse') {
        var b = o.getBoundingRect(true, true)
        out.push({
          id: o.cdaLayerId || ('s-' + out.length),
          type: t,
          x: b.left / scale, y: b.top / scale, w: b.width / scale, h: b.height / scale,
          fill: typeof o.fill === 'string' ? o.fill : 'transparent',
          stroke: typeof o.stroke === 'string' ? o.stroke : 'rgba(255,255,255,.8)',
          strokeWidth: (o.strokeWidth || 0) / scale,
          opacity: o.opacity ?? 1,
          angle: o.angle || 0,
          visible: o.visible !== false,
          locked: !!o.cdaLocked,
        })
      } else if (t === 'image') {
        var ib = o.getBoundingRect(true, true)
        out.push({
          id: o.cdaLayerId || ('img-' + out.length),
          type: 'image',
          role: o.cdaRole || 'annotation',
          x: ib.left / scale, y: ib.top / scale, w: ib.width / scale, h: ib.height / scale,
          src: o.cdaSrc || (o._element && o._element.src) || '',
          angle: o.angle || 0,
          opacity: o.opacity ?? 1,
          filter: o.cdaFilter || null,
          visible: o.visible !== false,
          locked: !!o.cdaLocked,
          cutout: !!o.cdaCutout,
          cutoutBackground: !!o.cdaCutoutBackground,
        })
      } else if (t === 'line') {
        var x1 = o.x1, y1 = o.y1, x2 = o.x2, y2 = o.y2
        var m = o.calcTransformMatrix()
        var p1 = fabric.util.transformPoint(new fabric.Point(x1, y1), m)
        var p2 = fabric.util.transformPoint(new fabric.Point(x2, y2), m)
        out.push({ id: o.cdaLayerId || ('l-' + out.length), type: 'line', x1: p1.x / scale, y1: p1.y / scale, x2: p2.x / scale, y2: p2.y / scale, stroke: o.stroke || '#F7F3EA', strokeWidth: (o.strokeWidth || 2) / scale, opacity: o.opacity ?? 1, visible: o.visible !== false, locked: !!o.cdaLocked })
      } else if (t === 'arrow') {
        var a = o.cdaArrow || {}
        out.push({
          id: o.cdaLayerId || ('a-' + out.length),
          type: 'arrow',
          x1: (Number(a.x1) || 0) / scale,
          y1: (Number(a.y1) || 0) / scale,
          x2: (Number(a.x2) || 0) / scale,
          y2: (Number(a.y2) || 0) / scale,
          angle: o.angle || 0,
          fill: typeof o.fill === 'string' ? o.fill : '#F7F3EA',
          stroke: typeof o.stroke === 'string' ? o.stroke : '#F7F3EA',
          strokeWidth: (o.strokeWidth || 1) / scale,
          opacity: o.opacity ?? 1,
          visible: o.visible !== false,
          locked: !!o.cdaLocked,
        })
      }
      // 铅笔、荧光笔不写入图层：它们已经烘焙在导出的 PNG 里
    })
    Object.keys(verticalGroups).forEach(function (gid, gi) {
      var group = verticalGroups[gid]
      var arr = group.arr.sort(function (a, b) { return (a.cdaColumnIndex || 0) - (b.cdaColumnIndex || 0) })
      var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      arr.forEach(function (o) {
        var b = o.getBoundingRect(true, true)
        left = Math.min(left, b.left); top = Math.min(top, b.top); right = Math.max(right, b.left + b.width); bottom = Math.max(bottom, b.top + b.height)
      })
      var first = arr[0]
      var colW = (first.width * (first.scaleX || 1)) / scale
      var gap = arr.length > 1 ? (arr[1].left - first.left - first.width * (first.scaleX || 1)) / scale : 0
      out[group.slot] = {
        id: gid,
        type: 'vertical-text',
        role: first.cdaRole || 'annotation',
        text: arr.map(function (o) { return String(o.text || '').replace(/\n/g, '') }).join(''),
        columns: arr.map(function (o) { return String(o.text || '').replace(/\n/g, '') }),
        x: left / scale, y: top / scale, w: (right - left) / scale, h: (bottom - top) / scale,
        fontSize: (first.fontSize * (first.scaleY || 1)) / scale,
        fontFamily: FONT_MAP_REV[first.fontFamily] || first.fontFamily || 'CoverSerif',
        fontWeight: first.fontWeight || 900,
        color: typeof first.fill === 'string' ? first.fill : '#F7F3EA',
        align: 'left',
        tracking: 0,
        lineHeight: first.lineHeight || 1,
        opacity: first.opacity ?? 1,
        visible: first.visible !== false,
        locked: !!first.cdaLocked,
        angle: 0,
        vertical: true,
        colW: colW,
        columnGap: gap,
        lines: null,
        shadow: !!first.shadow,
      }
    })
    return out.filter(Boolean)
  }

  async function editorSave(silent) {
    var ed = state.editor
    if (!ed || !ed.canvas || ed.saving) return false
    ed.saving = true
    try {
      var vt = ed.canvas.viewportTransform ? ed.canvas.viewportTransform.slice() : [1, 0, 0, 1, 0, 0]
      ed.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      var layers = serializeEditorLayers()
      var bgObj = ed.canvas.getObjects().find(function (o) { return o.cdaRole === 'background' })
      var bgRect = bgObj ? rectOfObject(bgObj) : null
      ed.canvas.setViewportTransform(vt)
      var dataUrl = await editorOutputDataUrl()
      var data = await api('/projects/' + encodeURIComponent(ed.project.id) + '/layers', { method: 'POST', body: { layers: layers, dataUrl: dataUrl, backgroundRect: bgRect, backgroundFilter: bgObj ? (bgObj.cdaFilter || null) : null, backgroundVisible: bgObj ? bgObj.visible !== false : true } })
      ed.project = data.project
      ed.dirty = false
      if (!silent) toast('已保存到项目')
      return true
    } catch (err) {
      toast('保存失败：' + err.message)
      return false
    } finally {
      ed.saving = false
    }
  }

  async function editorExport() {
    var ed = state.editor
    if (!ed) return
    var ok = await editorSave(true)
    if (!ok) return
    try {
      var data = await api('/projects/' + encodeURIComponent(ed.project.id) + '/export', { method: 'POST', body: {} })
      toast('已导出：' + (data.png || data.dir || ''))
    } catch (err) { toast('导出失败：' + err.message) }
  }

  async function editorAiEdit(instruction) {
    var ed = state.editor
    if (!ed) return
    if (!String(instruction || '').trim()) {
      toast('先写一下修改要求，或点“示例”填入')
      if (ed.aiStatus) ed.aiStatus.textContent = '先写修改要求，例如“标题放大、副标题两行”'
      if (ed.aiInput) ed.aiInput.focus()
      return
    }
    try {
      if (ed.aiStatus) ed.aiStatus.textContent = '正在保存当前画布…'
      setEditorBusy(true, 'AI 正在修改这张封面…')
      var saved = await editorSave(true)
      if (!saved) return
      if (ed.aiStatus) ed.aiStatus.textContent = '模型正在重新排版…'
      var data = await api('/projects/' + encodeURIComponent(ed.project.id) + '/edit', { method: 'POST', body: { instruction: String(instruction).trim() } })
      closeEditor(true)
      await loadState(true)
      toast('已按你的要求修改')
      if (data.project) openEditor(data.project.id)
    } catch (err) {
      if (ed.aiStatus) ed.aiStatus.textContent = '修改失败：' + err.message
      toast('修改失败：' + err.message)
    } finally {
      setEditorBusy(false)
    }
  }

  // ───────────────────────────── mount / standalone ─────────────────────────────

  window.__COVER_STUDIO_MOUNT__ = function (options) {
    try {
      if (options && typeof options.onClose === 'function') state.onClose = options.onClose
      if (state.overlay) {
        state.overlay.style.display = 'flex'
        loadState(true)
        return
      }
      renderShell()
    } catch (err) {
      console.error('[cover-studio] mount failed', err)
    }
  }
  window.__COVER_STUDIO_CLOSE__ = closeStudio

  if (window.__COVER_STUDIO_STANDALONE__) {
    setTimeout(function () { window.__COVER_STUDIO_MOUNT__({}) }, 30)
  }
})();
