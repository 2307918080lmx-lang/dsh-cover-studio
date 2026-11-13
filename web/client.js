/**
 * dsh-cover-studio — 页面半边加载器（经典脚本，无构建步骤）
 *
 * 只做三件事：
 *   1. 在输入框上方放一个「封面设计助手」按钮；
 *   2. 用户点击 / agent 请求时，按需加载 studio.css、字体、Fabric 和 studio.js；
 *   3. 轮询 /open-request，让 DSH 的 agent 也能把工作室叫出来。
 *
 * 所有异常都在本脚本内部吞掉，绝不干扰 DSH 的 React 渲染。
 */
;(function () {
  'use strict'
  if (window.__DSH_COVER_STUDIO_CLIENT__) return
  window.__DSH_COVER_STUDIO_CLIENT__ = true

  var ROUTE = '/dsh-cover-studio'
  var BAR_ID = 'dsh-cover-studio-bar'
  var TOAST_ID = 'dsh-cover-studio-toast'
  var CSS_ID = 'dsh-cover-studio-launcher-css'
  var FONT_STYLE_ID = 'dsh-cover-studio-fonts'
  var state = { loading: false, loaded: false, studio: null, open: false, lastOpenAt: 0, firstPoll: true }
  var barEl = null
  var floatEl = null

  var LAUNCHER_CSS =
    '#' + BAR_ID + '{display:flex;align-items:center;gap:8px;padding:2px 2px 8px;}' +
    '#' + BAR_ID + ' *{box-sizing:border-box;}' +
    '.cds-launch{display:inline-flex;align-items:center;gap:6px;height:27px;padding:0 10px;' +
    'border:1px solid var(--dsw-alias-border-l1);border-radius:14px;cursor:pointer;' +
    'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);' +
    'font-size:12px;line-height:1;font-family:inherit;transition:background .12s,color .12s,border-color .12s;}' +
    '.cds-launch:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}' +
    '.cds-launch svg{width:14px;height:14px;display:block;}' +
    '#' + TOAST_ID + '{position:fixed;z-index:80;left:50%;bottom:28px;transform:translateX(-50%);' +
    'max-width:min(560px,90vw);padding:9px 14px;border-radius:10px;font-size:12px;line-height:1.5;' +
    'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);' +
    'border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.22);display:none;}' +
    '.cds-cover-float{position:fixed;right:16px;bottom:88px;z-index:70;}' +
    '.cds-cover-float .cds-launch{height:30px;padding:0 12px;border-radius:15px;' +
    'background:var(--dsw-alias-bg-overlay);box-shadow:0 6px 20px rgba(0,0,0,.16);' +
    'border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}'

  function el(tag, props, children) {
    var node = document.createElement(tag)
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue
        var v = props[k]
        if (v === undefined || v === null || v === false) continue
        if (k === 'text') node.textContent = v
        else if (k === 'html') node.innerHTML = v
        else node.setAttribute(k, v === true ? '' : String(v))
      }
    }
    if (children) for (var i = 0; i < children.length; i++) if (children[i]) node.appendChild(children[i])
    return node
  }

  function toast(message, ms) {
    try {
      var node = document.getElementById(TOAST_ID)
      if (!node) {
        node = el('div', { id: TOAST_ID, role: 'status' })
        document.body.appendChild(node)
      }
      node.textContent = message
      node.style.display = 'block'
      clearTimeout(toast._t)
      toast._t = setTimeout(function () { node.style.display = 'none' }, ms || 4200)
    } catch (e) {}
  }

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return
    ;(document.head || document.documentElement).appendChild(el('style', { id: CSS_ID, text: LAUNCHER_CSS }))
  }

  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M6.5 16.5 10 12l2.2 2.6L14.8 11l2.7 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="15.6" cy="8.2" r="1.3" fill="currentColor"/>' +
    '</svg>'

  function renderLauncher() {
    if (!barEl || !barEl.isConnected) return
    barEl.textContent = ''
    var btn = el('button', {
      'class': 'cds-launch',
      type: 'button',
      title: '打开封面设计助手（Ctrl+Alt+C）',
      'data-cover-studio-toggle': '1',
    })
    btn.innerHTML = ICON + '<span>封面设计助手</span>'
    barEl.appendChild(btn)
  }

  function findCard() {
    return (
      document.querySelector('[data-composer-card]') ||
      document.querySelector('[data-composer-seat]') ||
      document.querySelector('[data-composer-input]') ||
      document.querySelector('[data-testid="composer"]') ||
      document.querySelector('[data-slot="composer"]') ||
      document.querySelector('.composer') ||
      document.querySelector('form:has(textarea)') ||
      document.querySelector('form:has([contenteditable="true"])')
    )
  }

  function mount() {
    var card = findCard()
    if (card && card.parentNode) {
      if (floatEl) floatEl.style.display = 'none'
      if (barEl && barEl.isConnected) return true
      barEl = el('div', { id: BAR_ID })
      card.parentNode.insertBefore(barEl, card)
      renderLauncher()
      return true
    }
    if (!floatEl) {
      floatEl = el('div', { className: 'cds-cover-float' })
      floatEl.innerHTML =
        '<button class="cds-launch" type="button" title="打开封面设计助手（Ctrl+Alt+C）" data-cover-studio-toggle="1">' +
        ICON + '<span>封面</span></button>'
      ;(document.body || document.documentElement).appendChild(floatEl)
    }
    floatEl.style.display = 'block'
    return true
  }

  function injectFonts() {
    if (document.getElementById(FONT_STYLE_ID)) return
    var css =
      '@font-face{font-family:"Cover Serif";src:url("' + ROUTE + '/fonts/serif") format("truetype");font-weight:900;font-style:normal;font-display:swap;}' +
      '@font-face{font-family:"Cover Serif";src:url("' + ROUTE + '/fonts/serif") format("truetype");font-weight:400;font-style:normal;font-display:swap;}' +
      '@font-face{font-family:"Cover Sans";src:url("' + ROUTE + '/fonts/sans") format("truetype");font-weight:400 700;font-style:normal;font-display:swap;}'
    ;(document.head || document.documentElement).appendChild(el('style', { id: FONT_STYLE_ID, text: css }))
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-cover-studio-src="' + src + '"]')
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve()
        existing.addEventListener('load', function () { resolve() })
        existing.addEventListener('error', function () { reject(new Error('加载失败: ' + src)) })
        return
      }
      var s = document.createElement('script')
      s.src = src
      s.async = true
      s.dataset.coverStudioSrc = src
      s.onload = function () { s.dataset.loaded = '1'; resolve() }
      s.onerror = function () { reject(new Error('加载失败: ' + src)) }
      ;(document.head || document.documentElement).appendChild(s)
    })
  }

  function loadCss() {
    return new Promise(function (resolve) {
      var id = 'dsh-cover-studio-studio-css'
      if (document.getElementById(id)) return resolve()
      var link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = ROUTE + '/studio.css'
      link.onload = function () { resolve() }
      link.onerror = function () { resolve() }
      ;(document.head || document.documentElement).appendChild(link)
    })
  }

  async function ensureStudio() {
    if (state.loaded && window.__COVER_STUDIO_MOUNT__) return true
    if (state.loading) {
      while (state.loading) await new Promise(function (r) { setTimeout(r, 120) })
      return !!(state.loaded && window.__COVER_STUDIO_MOUNT__)
    }
    state.loading = true
    try {
      injectFonts()
      await loadCss()
      if (!window.fabric) await loadScript(ROUTE + '/vendor/fabric.min.js')
      await loadScript(ROUTE + '/studio.js')
      try {
        if (document.fonts && document.fonts.load) {
          await Promise.race([
            document.fonts.load('900 100px "Cover Serif"'),
            new Promise(function (r) { setTimeout(r, 6000) }),
          ])
        }
      } catch (e) {}
      state.loaded = !!(window.__COVER_STUDIO_MOUNT__)
      return state.loaded
    } catch (err) {
      toast('封面设计助手加载失败：' + String(err && err.message || err))
      return false
    } finally {
      state.loading = false
    }
  }

  async function openStudio() {
    var ok = await ensureStudio()
    if (!ok) return
    try {
      window.__COVER_STUDIO_MOUNT__({ route: ROUTE, onClose: function () { state.open = false } })
      state.open = true
    } catch (err) {
      toast('打开工作室失败：' + String(err && err.message || err))
    }
  }

  function startObserver() {
    try {
      var observer = new MutationObserver(function () {
        try { ensureCss(); mount() } catch (e) {}
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
    } catch (e) {}
    ensureCss()
    mount()
  }

  async function pollOpenRequest() {
    try {
      var res = await fetch(ROUTE + '/open-request', { headers: { accept: 'application/json' } })
      if (!res.ok) return
      var data = await res.json()
      var at = Number(data && data.at) || 0
      if (state.firstPoll) {
        state.firstPoll = false
        state.lastOpenAt = at
        return
      }
      if (at > state.lastOpenAt && at > 0) {
        state.lastOpenAt = at
        openStudio()
      }
    } catch (e) {}
  }

  // 文档级点击：只处理我们自己的按钮
  document.addEventListener('click', function (event) {
    var node = event.target
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('data-cover-studio-toggle')) {
        event.preventDefault()
        openStudio()
        return
      }
      node = node.parentNode
    }
  }, true)

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && event.altKey && String(event.key).toLowerCase() === 'c') {
      event.preventDefault()
      openStudio()
    }
  })

  startObserver()
  setTimeout(pollOpenRequest, 1200)
  setInterval(pollOpenRequest, 2500)
  window.__DSH_COVER_STUDIO_OPEN__ = openStudio
})();
