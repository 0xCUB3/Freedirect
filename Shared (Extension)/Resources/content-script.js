'use strict'

const api = globalThis.chrome ?? globalThis.browser
const CURRENT_URL = location.href
const REDDIT_DEFAULTS = {
  redlib: ['https://redlib.net', 'https://safereddit.com', 'https://libreddit.bus-hit.me'],
  libreddit: ['https://libreddit.projectsegfau.lt']
}

function runtimeError() {
  return api?.runtime?.lastError?.message
}

function send(message) {
  return new Promise((resolve, reject) => {
    if (!api?.runtime?.sendMessage) return reject(new Error('runtime messaging unavailable'))
    let settled = false
    const timer = setTimeout(() => finish(null, new Error('background timeout')), 1500)
    function finish(value, error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else if (value?.error) reject(new Error(value.error))
      else resolve(value)
    }
    try {
      const result = api.runtime.sendMessage(message, response => {
        const error = runtimeError()
        finish(response, error ? new Error(error) : null)
      })
      if (result?.then) result.then(value => finish(value), error => finish(null, error))
    } catch (callbackError) {
      try {
        const result = api.runtime.sendMessage(message)
        if (result?.then) result.then(value => finish(value), error => finish(null, error))
        else finish(result)
      } catch (error) {
        finish(null, error)
      }
    }
  })
}

function storageGet(keys) {
  return new Promise(resolve => {
    if (!api?.storage?.local?.get) return resolve({})
    try {
      const result = api.storage.local.get(keys, value => resolve(value || {}))
      if (result?.then) result.then(value => resolve(value || {}), () => resolve({}))
    } catch {
      try {
        const result = api.storage.local.get(keys)
        if (result?.then) result.then(value => resolve(value || {}), () => resolve({}))
        else resolve(result || {})
      } catch {
        resolve({})
      }
    }
  })
}

function selectedRedditInstance(config) {
  const frontend = config?.frontend in REDDIT_DEFAULTS ? config.frontend : 'redlib'
  const candidates = [...(config?.favoriteInstances || []), ...(config?.customInstances || []), ...REDDIT_DEFAULTS[frontend]]
  if (config?.mode === 'rotating' && candidates.length) {
    const day = Math.floor(Date.now() / 86400000)
    return candidates[day % candidates.length]
  }
  return config?.instance || candidates[0]
}

function redditRedirect(url, state) {
  if (isBypassedUrl(url.href, state)) return null
  if (state?.globalEnabled === false) return null
  const config = state?.services?.reddit
  if (config?.enabled === false) return null
  const instance = selectedRedditInstance(config).replace(/\/$/, '')
  const href = url.href
  let target = href.replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/(.*)/, `${instance}/$2`)
  if (target !== href) return target
  target = href.replace(/^https?:\/\/redd\.it\/(.*)/, `${instance}/$1`)
  return target !== href ? target : null
}

function bypassRegexForUrl(value) {
  const url = new URL(value)
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '')
  const pathPattern = path === '/' ? '/?' : `${escapeRegex(path)}/?`
  return `^https?://${escapeRegex(url.hostname)}${pathPattern}([?#].*)?$`
}

function isBypassedUrl(value, state) {
  return (state?.diagnostics?.bypassedUrls ?? []).some(bypassed => {
    try { return new RegExp(bypassRegexForUrl(bypassed)).test(new URL(value).href) }
    catch { return value === bypassed }
  })
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unwrappedOutboundUrl(href) {
  let url
  try { url = new URL(href, location.href) } catch { return null }
  if (!/^https?:$/.test(url.protocol)) return null
  if (/^(www\.)?google\./.test(url.hostname) && /^\/(url|search)$/.test(url.pathname)) {
    const nested = url.searchParams.get('url') || url.searchParams.get('q')
    if (nested) {
      try {
        const nestedUrl = new URL(nested)
        if (/^https?:$/.test(nestedUrl.protocol)) return nestedUrl.href
      } catch {}
    }
  }
  return url.href
}

function rewriteAnchorHref(anchor, target) {
  anchor.href = target
  anchor.removeAttribute('ping')
  anchor.rel = [anchor.rel, 'noreferrer'].filter(Boolean).join(' ')
}

let linkRewriteTimer = null
let linkRewriteRunning = false
const linkRewriteCache = new Map()

async function rewriteRedirectableLinks() {
  if (linkRewriteRunning || window.top !== window || !document?.querySelectorAll) return
  linkRewriteRunning = true
  try {
    const stored = await storageGet(['freedirectState'])
    const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 600)
    const pendingUrls = []
    const anchorsByUrl = new Map()
    for (const anchor of anchors) {
      const original = unwrappedOutboundUrl(anchor.href)
      if (!original || original === anchor.href && anchor.dataset.freedirectChecked === original) continue
      anchor.dataset.freedirectChecked = original
      let target = linkRewriteCache.get(original)
      if (target === undefined) {
        try { target = redditRedirect(new URL(original), stored.freedirectState) } catch { target = null }
      }
      if (target) {
        linkRewriteCache.set(original, target)
        rewriteAnchorHref(anchor, target)
        continue
      }
      if (linkRewriteCache.has(original)) continue
      if (!anchorsByUrl.has(original)) {
        anchorsByUrl.set(original, [])
        pendingUrls.push(original)
      }
      anchorsByUrl.get(original).push(anchor)
      if (pendingUrls.length >= 120) break
    }
    if (pendingUrls.length) {
      const response = await send({ type: 'diagnoseUrls', urls: pendingUrls, source: 'link-rewrite' })
      const diagnoses = response?.diagnoses ?? []
      pendingUrls.forEach((url, index) => {
        const target = diagnoses[index]?.redirectUrl || null
        linkRewriteCache.set(url, target)
        if (target) for (const anchor of anchorsByUrl.get(url) ?? []) rewriteAnchorHref(anchor, target)
      })
    }
    if (linkRewriteCache.size > 1000) linkRewriteCache.clear()
  } catch {
    // Link rewriting is an optimization for Safari history correctness; DNR and
    // navigation fallbacks still handle redirects if messaging is unavailable.
  } finally {
    linkRewriteRunning = false
  }
}

function scheduleLinkRewrite() {
  if (linkRewriteTimer) return
  linkRewriteTimer = setTimeout(() => {
    linkRewriteTimer = null
    rewriteRedirectableLinks()
  }, 50)
}

function startLinkRewriteObserver() {
  if (window.top !== window || !document?.documentElement) return
  scheduleLinkRewrite()
  try {
    const observer = new MutationObserver(scheduleLinkRewrite)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
    setTimeout(() => observer.disconnect(), 15000)
  } catch {}
}

async function runStorageRedirect() {
  if (window.top !== window) return false
  if (!/^https?:$/.test(location.protocol)) return false
  let url
  try { url = new URL(CURRENT_URL) } catch { return false }
  if (!/(^|\.)reddit\.com$/.test(url.hostname) && url.hostname !== 'redd.it') return false
  const stored = await storageGet(['freedirectState'])
  const target = redditRedirect(url, stored.freedirectState)
  if (!target || target === CURRENT_URL) return false
  location.replace(target)
  return true
}

async function runFallbackRedirect() {
  if (window.top !== window) return
  if (!/^https?:$/.test(location.protocol)) return
  try {
    if (await runStorageRedirect()) return
    const response = await send({ type: 'diagnoseUrl', url: CURRENT_URL, source: 'content-script' })
    const target = response?.diagnosis?.redirectUrl
    if (!target || target === CURRENT_URL) return
    const targetUrl = new URL(target)
    if (!/^(https?|freetube):$/.test(targetUrl.protocol)) return
    location.replace(targetUrl.href)
    if (targetUrl.protocol === 'freetube:') {
      setTimeout(() => {
        if (history.length > 1) history.back()
      }, 900)
    }
  } catch {
    // DNR remains the primary redirect path. This fallback stays silent if
    // Safari has not granted content-script host access or the background has
    // not started yet.
  }
}

function looksLikeServerErrorPage() {
  const title = String(document?.title || '').trim().toLowerCase()
  const text = String(document?.body?.innerText || '').trim().slice(0, 2500).toLowerCase()
  const shortPage = text.length < 1200
  if (/^(502|503|504)\b/.test(title) || /\b(bad gateway|service unavailable|gateway timeout)\b/.test(title)) return true
  if (!shortPage) return false
  return /\b(502|503|504)\b/.test(text) && /\b(bad gateway|service unavailable|gateway timeout|origin error|connection timed out)\b/.test(text)
}

async function runFarsideErrorFallback() {
  if (window.top !== window) return
  if (!/^https?:$/.test(location.protocol)) return
  if (!looksLikeServerErrorPage()) return
  try {
    const response = await send({ type: 'farsideFallbackForUrl', url: CURRENT_URL, source: 'server-error-page' })
    const target = response?.url
    if (!target || target === CURRENT_URL) return
    location.replace(target)
  } catch {}
}

function scheduleErrorFallbackCheck() {
  const run = () => setTimeout(runFarsideErrorFallback, 120)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true })
  else run()
  setTimeout(runFarsideErrorFallback, 1200)
}

startLinkRewriteObserver()
runFallbackRedirect()
scheduleErrorFallbackCheck()
