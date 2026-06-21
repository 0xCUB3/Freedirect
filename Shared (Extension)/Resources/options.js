'use strict'

const api = globalThis.chrome ?? globalThis.browser
  const $ = id => document.getElementById(id)
  const t = (key, substitutions) => api?.i18n?.getMessage(key, substitutions) || key
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n) })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder) })
  document.querySelectorAll('[data-i18n-aria-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)) })
  let current
  const HEALTH_STALE_MS = 7 * 24 * 60 * 60 * 1000
  function runtimeError() { return api?.runtime?.lastError?.message }
  function msg(type, body = {}) {
    const payload = { type, ...body }
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (value, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => finish(null, new Error('Extension background did not respond.')), 5000)
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
  function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) }
  function optionList(entries, selected, label = value => value.name) {
    return entries.map(([id, item]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label(item, id))}</option>`).join('')
  }
  function instanceList(service, config) {
    const frontend = service.frontends[config.frontend] || service.frontends[service.defaultFrontend]
    const values = [...(config.favoriteInstances || []), ...(config.customInstances || []), ...frontend.instances]
    return Array.from(new Set(values)).map(value => `<option value="${esc(value)}" ${value === config.instance ? 'selected' : ''}>${esc(value)}</option>`).join('')
  }
  function healthLabel(config) {
    const health = config.health?.[config.instance]
    if (!health) return `<span class="badge">${esc(t('notChecked'))}</span>`
    const checkedAt = Date.parse(health.checkedAt || '')
    const stale = Number.isFinite(checkedAt) && Date.now() - checkedAt > HEALTH_STALE_MS
    if (health.ok && stale) return `<span class="badge warn">${esc(t('stale'))} · ${health.latencyMs ?? 'ok'} ms</span>`
    if (health.ok) return `<span class="badge ok">${health.latencyMs ?? 'ok'} ms</span>`
    return `<span class="badge bad">${esc(t('failed'))}</span>`
  }
  function render(data) {
    current = data
    $('profile').innerHTML = optionList(Object.entries(data.profiles), data.state.profile, profile => profile.name)
    const query = $('serviceSearch').value.trim().toLowerCase()
    const filter = $('serviceFilter').value
    const rows = Object.entries(data.catalog).filter(([id, service]) => {
      const config = data.state.services[id]
      const haystack = [id, service.name, service.originalHosts.join(' '), Object.values(service.frontends).map(frontend => frontend.name).join(' ')].join(' ').toLowerCase()
      if (filter === 'enabled' && !config.enabled) return false
      if (filter === 'disabled' && config.enabled) return false
      return !query || haystack.includes(query)
    })
    const enabledCount = Object.values(data.state.services).filter(config => config.enabled).length
    $('serviceSummary').textContent = t('shownEnabledSummary', [String(rows.length), String(Object.keys(data.catalog).length), String(enabledCount)])
    $('services').innerHTML = rows.map(([id, service]) => {
      const config = data.state.services[id]
      const favorite = (config.favoriteInstances || []).includes(config.instance)
      const isCustom = (config.customInstances || []).includes(config.instance)
      return `<div class="service ${config.enabled ? '' : 'disabled'}" data-service="${esc(id)}">
        <label class="toggle"><input type="checkbox" data-field="enabled" ${config.enabled ? 'checked' : ''} aria-label="${esc(service.name)} ${esc(t('enabled'))}"></label>
        <div class="name"><strong>${esc(service.name)}</strong><div class="hosts">${esc(service.originalHosts.slice(0, 3).join(', '))} · ${esc(service.confidence)}</div></div>
        <select data-field="frontend" aria-label="${esc(service.name)} ${esc(t('frontend'))}">${optionList(Object.entries(service.frontends), config.frontend)}</select>
        <select data-field="instance" aria-label="${esc(service.name)} ${esc(t('instance'))}">${instanceList(service, config)}</select>
        <select data-field="mode" aria-label="${esc(service.name)} ${esc(t('instanceMode'))}"><option value="selected" ${config.mode === 'selected' ? 'selected' : ''}>${esc(t('selectedMode'))}</option><option value="rotating" ${config.mode === 'rotating' ? 'selected' : ''}>${esc(t('rotatingMode'))}</option></select>
        <div class="row-actions">${healthLabel(config)}<button class="small" data-action="favorite" title="${favorite ? esc(t('unpin')) : esc(t('pin'))}">${favorite ? '★' : '☆'}</button><button class="small" data-action="best">${esc(t('selectBest'))}</button><button class="small" data-action="health">${esc(t('check'))}</button><button class="small" data-action="custom">Custom…</button>${isCustom ? '<button class="small" data-action="removeCustom">Remove</button>' : ''}</div>
      </div>`
    }).join('')
    $('diag').innerHTML = `${data.state.diagnostics.lastRuleCount || 0} dynamic rules. Last generated: ${esc(data.state.diagnostics.lastGeneratedAt || 'never')}. Instance lists: ${esc(data.state.diagnostics.lastInstanceRefreshAt || 'built-in')}. ${data.state.diagnostics.lastInstanceRefreshError ? `<span class="bad">${esc(data.state.diagnostics.lastInstanceRefreshError)}</span>` : ''} ${data.state.diagnostics.lastError ? `<span class="bad">${esc(data.state.diagnostics.lastError)}</span>` : '<span class="ok">No generator errors.</span>'}`
    $('bypasses').innerHTML = (data.state.diagnostics.bypassedUrls || []).map(item => `<li>${esc(item)}</li>`).join('') || '<li>No temporary bypasses.</li>'
  }
  async function refresh() {
    try { render(await msg('getState')) }
    catch (error) { $('diag').innerHTML = `<span class="bad">${esc(error?.message || String(error))}</span>` }
  }
  $('profile').addEventListener('change', event => msg('applyProfile', { profile: event.target.value }).then(refresh))
  $('enableAll').addEventListener('click', () => msg('setAllServices', { enabled: true }).then(refresh))
  $('disableAll').addEventListener('click', () => msg('setAllServices', { enabled: false }).then(refresh))
  $('resetDefaults').addEventListener('click', () => { if (confirm('Reset Freedirect settings to defaults?')) msg('resetState').then(refresh) })
  $('serviceSearch').addEventListener('input', () => { if (current) render(current) })
  $('serviceFilter').addEventListener('change', () => { if (current) render(current) })
  $('services').addEventListener('change', async event => {
    const row = event.target.closest('.service')
    if (!row || !event.target.dataset.field || event.target.dataset.field === 'custom') return
    const serviceId = row.dataset.service
    const field = event.target.dataset.field
    const patch = { [field]: field === 'enabled' ? event.target.checked : event.target.value }
    if (field === 'frontend') patch.instance = current.catalog[serviceId].frontends[event.target.value].instances[0]
    await msg('updateService', { serviceId, patch })
    await refresh()
  })
  $('services').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    const row = button.closest('.service')
    const serviceId = row.dataset.service
    const instance = row.querySelector('[data-field="instance"]').value
    try {
      if (button.dataset.action === 'favorite') await msg('toggleFavoriteInstance', { serviceId, instance })
      if (button.dataset.action === 'best') await msg('selectBestInstance', { serviceId })
      if (button.dataset.action === 'health') await msg('checkInstanceHealth', { serviceId, instance })
      if (button.dataset.action === 'custom') {
        const custom = prompt('Custom instance URL', 'https://')?.trim()
        if (custom && custom !== 'https://') await msg('addCustomInstance', { serviceId, instance: custom })
      }
      if (button.dataset.action === 'removeCustom') await msg('removeCustomInstance', { serviceId, instance })
      await refresh()
    } catch (error) { alert(error?.message || String(error)) }
  })
  $('rebuild').addEventListener('click', () => msg('rebuildRules').then(refresh))
  $('refreshInstances').addEventListener('click', () => msg('refreshPublicInstances').then(refresh))
  $('checkAll').addEventListener('click', () => msg('checkAllSelectedHealth').then(refresh))
  $('showCommands').addEventListener('click', async () => {
    const result = await msg('getCommands')
    $('commands').innerHTML = result.available ? result.commands.map(command => `<li>${esc(command.description || command.name)} — ${esc(command.shortcut || 'unassigned')}</li>`).join('') : `<li>${esc(result.reason || t('commandsUnavailable'))}</li>`
  })
  $('clearBypasses').addEventListener('click', () => msg('clearBypasses').then(refresh))
  $('debugRedirect').addEventListener('click', async () => { $('debugResult').textContent = (await msg('previewRedirect', { url: $('debugUrl').value.trim() })).url || 'No enabled redirect template matched this URL.' })
  $('debugReverse').addEventListener('click', async () => { $('debugResult').textContent = (await msg('previewReverse', { url: $('debugUrl').value.trim() })).url || 'No known frontend instance matched this URL.' })
  $('previewRules').addEventListener('click', async () => {
    const result = await msg('getRules')
    $('rulesPreview').textContent = result.rulePreview.map(rule => `${rule.id} ${rule.serviceName} → ${rule.frontendName} (${rule.instance})\n  ${rule.source}\n  ${rule.substitution}`).join('\n\n') || 'No generated redirect rules.'
  })
  $('export').addEventListener('click', async () => { $('backup').value = JSON.stringify((await msg('exportState')).exported, null, 2) })
  $('import').addEventListener('click', async () => {
    try { await msg('importState', { state: JSON.parse($('backup').value) }); await refresh() }
    catch (error) { alert(`Import failed: ${error.message || error}`) }
  })
  refresh()
