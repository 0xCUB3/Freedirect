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
    location.href = targetUrl.href
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

runFallbackRedirect()
