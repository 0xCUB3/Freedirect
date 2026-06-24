'use strict'

const api = globalThis.chrome ?? globalThis.browser
const $ = id => document.getElementById(id)
const t = (key, substitutions) => api?.i18n?.getMessage(key, substitutions) || key
let primaryAction = null
let farsideUrl = null

document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n) })

function runtimeError() { return api?.runtime?.lastError?.message }

function msg(type, body = {}) {
  const payload = { type, ...body }
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(null, new Error('Extension background did not respond.')), 5000)
    function finish(value, error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else if (value?.error) reject(new Error(value.error))
      else resolve(value)
    }
    try {
      const result = api.runtime.sendMessage(payload, response => {
        const error = runtimeError()
        finish(response, error ? new Error(error) : null)
      })
      if (result?.then) result.then(value => finish(value), error => finish(null, error))
    } catch (callbackError) {
      try {
        const result = api.runtime.sendMessage(payload)
        if (result?.then) result.then(value => finish(value), error => finish(null, error))
        else finish(result)
      } catch (error) {
        finish(null, error)
      }
    }
  })
}

function shortUrl(value) {
  if (!value) return '—'
  try {
    const url = new URL(value)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.hostname}${path}`
  } catch {
    return String(value)
  }
}

function setPrimary(kind, label) {
  primaryAction = kind
  $('primaryAction').textContent = label
  $('primaryAction').classList.toggle('hidden', !kind)
}

function render(payload, diagnosis, farside) {
  const state = payload.state
  $('enabled').checked = !!state.globalEnabled
  farsideUrl = farside?.url || null
  $('farsideAction').classList.toggle('hidden', !farsideUrl)
  $('farsideAction').classList.toggle('secondary', !!farsideUrl)

  if (diagnosis?.redirectUrl) {
    $('pageMatch').textContent = diagnosis.serviceName
    $('pageTarget').textContent = shortUrl(diagnosis.redirectUrl)
    setPrimary('redirect', t('popupRedirectPage'))
  } else if (diagnosis?.reverseUrl) {
    $('pageMatch').textContent = t('popupCanOpenOriginal')
    $('pageTarget').textContent = shortUrl(diagnosis.reverseUrl)
    setPrimary('reverse', t('popupOpenOriginal'))
  } else {
    $('pageMatch').textContent = t('popupNoMatch')
    $('pageTarget').textContent = shortUrl(diagnosis?.url)
    setPrimary(null, '')
  }

  $('status').className = state.globalEnabled ? 'status ok' : 'status'
}

async function refresh() {
  try {
    const [state, current, farside] = await Promise.all([msg('getState'), msg('diagnoseCurrent'), msg('farsideCurrent')])
    render(state, current.diagnosis, farside)
  } catch (error) {
    $('status').textContent = t('popupError', [error?.message || String(error)])
    $('pageMatch').textContent = t('popupNoMatch')
    $('pageTarget').textContent = '—'
    setPrimary(null, '')
  }
}

$('enabled').addEventListener('change', event => msg('setGlobalEnabled', { enabled: event.target.checked }).then(refresh))
$('primaryAction').addEventListener('click', () => {
  if (primaryAction === 'redirect') return msg('redirectCurrent').then(refresh)
  if (primaryAction === 'reverse') return msg('reverseCurrent').then(refresh)
})
$('farsideAction').addEventListener('click', () => msg('openFarsideCurrent').then(refresh))
async function openSettings() {
  const url = api.runtime.getURL?.('options.html')
  if (url && api.tabs?.create) {
    try {
      await api.tabs.create({ url })
      return
    } catch {}
  }
  api.runtime.openOptionsPage()
}

$('options').addEventListener('click', openSettings)

refresh()
