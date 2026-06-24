'use strict'

const api = globalThis.chrome ?? globalThis.browser
  const $ = id => document.getElementById(id)
  const t = (key, substitutions) => api?.i18n?.getMessage(key, substitutions) || key
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n) })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder) })
  document.querySelectorAll('[data-i18n-aria-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)) })
  let current
  let customServiceId = null
  let serviceFilter = 'all'
  const HEALTH_STALE_MS = 7 * 24 * 60 * 60 * 1000
  function runtimeError() { return api?.runtime?.lastError?.message }
  function messageTimeout(type) {
    if (['selectBestInstance', 'updateService'].includes(type)) return 75000
    if (['checkAllSelectedHealth', 'refreshPublicInstances', 'setAllServices'].includes(type)) return 45000
    if (['checkInstanceHealth', 'rebuildRules', 'applyProfile', 'resetState', 'importState', 'runSanityCheck'].includes(type)) return 20000
    return 10000
  }
  function msg(type, body = {}) {
    const payload = { type, ...body }
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (value, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else if (value?.error) reject(new Error(value.error))
        else resolve(value)
      }
      const timer = setTimeout(() => finish(null, new Error('Extension background did not respond.')), messageTimeout(type))
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
  function setBusy(button, busy, label) {
    if (!button) return
    if (busy) {
      button.dataset.originalText = button.textContent
      button.textContent = label || t('working')
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
    } else {
      button.textContent = button.dataset.originalText || button.textContent
      button.disabled = false
      button.removeAttribute('aria-busy')
    }
  }
  function nextPaint() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }
  async function runButtonAction(button, label, action, { refreshAfter = true } = {}) {
    setBusy(button, true, label)
    $('diag').innerHTML = `<span class="muted">${esc(label || t('working'))}</span>`
    await nextPaint()
    try {
      await action()
      if (refreshAfter) await refresh()
    } catch (error) {
      $('diag').innerHTML = `<span class="bad">${esc(error?.message || String(error))}</span>`
    } finally {
      setBusy(button, false)
    }
  }
  function optionList(entries, selected, label = value => value.name) {
    return entries.map(([id, item]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label(item, id))}</option>`).join('')
  }
  function effectiveFrontends(service, config) { return { ...service.frontends, ...(config.customFrontends || {}) } }
  function instanceList(service, config) {
    const frontends = effectiveFrontends(service, config)
    const frontend = frontends[config.frontend] || frontends[service.defaultFrontend]
    const values = [...(config.favoriteInstances || []), ...(config.customInstances || []), ...frontend.instances]
    return Array.from(new Set(values)).map(value => `<option value="${esc(value)}" ${value === config.instance ? 'selected' : ''}>${esc(value)}</option>`).join('')
  }
  function farsideHealth(config) {
    const base = current?.state?.farsideBaseUrl || current?.farside?.baseUrl || 'https://farside.link'
    return config.health?.[base]
  }
  function healthBadgeFor(config) {
    const health = config.health?.[config.instance]
    if (!health) return { text: t('notChecked'), className: '', title: '' }
    const checkedAt = Date.parse(health.checkedAt || '')
    const stale = Number.isFinite(checkedAt) && Date.now() - checkedAt > HEALTH_STALE_MS
    if (health.ok && stale) return { text: `${t('stale')} · ${health.latencyMs ?? 'ok'} ms`, className: 'warn', title: '' }
    if (health.ok) return { text: `${health.latencyMs ?? 'ok'} ms`, className: 'ok', title: '' }
    if (current?.state?.farsideFallbackEnabled) {
      const fallback = farsideHealth(config)
      if (fallback?.ok) return { text: 'Fallback', className: 'warn', title: 'Selected instance failed; Farside is reachable' }
      if (fallback && !fallback.ok) return { text: t('failed'), className: 'bad', title: fallback.error || health.error || 'failed' }
      return { text: 'Fallback', className: 'warn', title: 'Selected instance failed; will retry through Farside' }
    }
    return { text: t('failed'), className: 'bad', title: health.error || 'failed' }
  }
  function healthLabel(config, service) {
    const frontends = effectiveFrontends(service, config)
    if (frontends[config.frontend]?.appProtocol) return `<span class="badge na">${esc(t('notApplicable'))}</span>`
    const badge = healthBadgeFor(config)
    return `<span class="badge ${esc(badge.className)}" title="${esc(badge.title)}">${esc(badge.text)}</span>`
  }
  function openCustomDialog(serviceId) {
    customServiceId = serviceId
    const service = current.catalog[serviceId]
    const config = current.state.services[serviceId]
    const frontends = effectiveFrontends(service, config)
    $('customTitle').textContent = `${service.name} custom instances`
    $('customHint').textContent = 'Add an instance URL to an existing frontend type, or choose New type.'
    $('customFrontendType').innerHTML = `${optionList(Object.entries(frontends), config.frontend)}<option value="__new__">New type…</option>`
    $('customInstanceUrl').value = ''
    $('customFrontendName').value = ''
    $('customFrontendNameRow').classList.add('hidden')
    $('removeCustomFrontend').hidden = !config.frontend.startsWith('custom:')
    $('customDialog').showModal()
  }
  function formatSanityReport(report) {
    const lines = [report.summary, `Checked: ${report.checkedAt}`, '']
    lines.push('Core checks:')
    for (const check of report.checks || []) lines.push(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`)
    if (report.issues?.length) {
      lines.push('', 'Issues:')
      for (const issue of report.issues) lines.push(`- ${issue}`)
    }
    if (report.notes?.length) {
      lines.push('', 'Notes:')
      for (const note of report.notes) lines.push(`- ${note}`)
    }
    lines.push('', 'Enabled services:')
    for (const service of report.services || []) {
      const health = service.health ? (service.health.ok ? `${service.health.latencyMs ?? 'ok'} ms` : `failed${service.health.error ? ` (${service.health.error})` : ''}`) : 'not checked'
      lines.push(`${service.ok ? '✓' : '✗'} ${service.name} → ${service.frontend} · ${service.ruleCount} rules · health ${health}`)
      if (service.sampleRedirect) lines.push(`  ${service.sample} → ${service.sampleRedirect}`)
    }
    return lines.join('\n')
  }
  function render(data) {
    current = data
    $('profile').innerHTML = optionList(Object.entries(data.profiles), data.state.profile, profile => profile.name)
    if ($('farsideBaseUrl')) $('farsideBaseUrl').value = data.state.farsideBaseUrl || data.farside?.baseUrl || 'https://farside.link'
    if ($('farsideFallbackEnabled')) $('farsideFallbackEnabled').checked = data.state.farsideFallbackEnabled !== false
    const query = $('serviceSearch').value.trim().toLowerCase()
    const filter = serviceFilter
    const rows = Object.entries(data.catalog).filter(([id, service]) => {
      const config = data.state.services[id]
      const haystack = [id, service.name, service.originalHosts.join(' '), Object.values(service.frontends).map(frontend => frontend.name).join(' ')].join(' ').toLowerCase()
      if (filter === 'enabled' && !config.enabled) return false
      if (filter === 'disabled' && config.enabled) return false
      return !query || haystack.includes(query)
    }).sort(([aId, aService], [bId, bService]) => {
      const aConfig = data.state.services[aId]
      const bConfig = data.state.services[bId]
      const aPinned = (aConfig.favoriteInstances || []).includes(aConfig.instance)
      const bPinned = (bConfig.favoriteInstances || []).includes(bConfig.instance)
      const sort = $('sortOrder').value
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      if (sort === 'name') return aService.name.localeCompare(bService.name)
      if (sort === 'enabled' && aConfig.enabled !== bConfig.enabled) return aConfig.enabled ? -1 : 1
      if (sort === 'health') {
        const rank = config => config.health?.[config.instance]?.ok ? 0 : (config.health?.[config.instance] ? 2 : 1)
        const diff = rank(aConfig) - rank(bConfig)
        if (diff) return diff
      }
      if (aConfig.enabled !== bConfig.enabled) return aConfig.enabled ? -1 : 1
      return 0
    })
    const enabledCount = Object.values(data.state.services).filter(config => config.enabled).length
    $('serviceSummary').textContent = t('shownEnabledSummary', [String(rows.length), String(Object.keys(data.catalog).length), String(enabledCount)])
    $('services').innerHTML = rows.map(([id, service]) => {
      const config = data.state.services[id]
      const favorite = (config.favoriteInstances || []).includes(config.instance)
      const isCustom = (config.customInstances || []).includes(config.instance)
      const frontends = effectiveFrontends(service, config)
      return `<div class="service ${config.enabled ? '' : 'disabled'}" data-service="${esc(id)}">
        <label class="toggle"><input type="checkbox" data-field="enabled" ${config.enabled ? 'checked' : ''} aria-label="${esc(service.name)} ${esc(t('enabled'))}"></label>
        <div class="name"><strong>${esc(service.name)}</strong><div class="hosts">${esc(service.originalHosts.slice(0, 3).join(', '))} · ${esc(service.confidence)}</div></div>
        <select data-field="frontend" aria-label="${esc(service.name)} ${esc(t('frontend'))}">${optionList(Object.entries(frontends), config.frontend, (frontend, frontendId) => `${frontend.name}${frontendId.startsWith('custom:') ? ' (custom)' : ''}`)}</select>
        <select data-field="instance" aria-label="${esc(service.name)} ${esc(t('instance'))}">${instanceList(service, config)}</select>
        <div class="row-actions">${healthLabel(config, service)}<div class="action-buttons"><button class="icon ${favorite ? 'active' : ''}" data-action="favorite" title="${favorite ? esc(t('unpin')) : esc(t('pin'))}" aria-label="${favorite ? esc(t('unpin')) : esc(t('pin'))}">${favorite ? '★' : '☆'}</button><button class="small" data-action="best">${esc(t('selectBest'))}</button><button class="small" data-action="health">${esc(t('check'))}</button><button class="small" data-action="custom">Custom…</button>${isCustom ? '<button class="small" data-action="removeCustom">Remove</button>' : ''}</div></div>
      </div>`
    }).join('')
    $('diag').innerHTML = `${data.state.diagnostics.lastRuleCount || 0} dynamic rules. Last generated: ${esc(data.state.diagnostics.lastGeneratedAt || 'never')}. Instance lists: ${esc(data.state.diagnostics.lastInstanceRefreshAt || 'built-in')}. ${data.state.diagnostics.lastInstanceRefreshError ? `<span class="bad">${esc(data.state.diagnostics.lastInstanceRefreshError)}</span>` : ''} ${data.state.diagnostics.lastError ? `<span class="bad">${esc(data.state.diagnostics.lastError)}</span>` : '<span class="ok">No generator errors.</span>'}`
    $('bypasses').innerHTML = (data.state.diagnostics.bypassedUrls || []).map(item => `<li>${esc(item)}</li>`).join('') || `<li class="empty-state">${esc(t('noBypasses')) || 'Bypasses let you temporarily visit an original site without redirecting. None are active.'}</li>`
  }
  async function refresh() {
    try { render(await msg('getState')) }
    catch (error) { $('diag').innerHTML = `<span class="bad">${esc(error?.message || String(error))}</span>` }
  }
  function setRowHealthText(serviceId, text, className = '', title = '') {
    const badge = document.querySelector(`.service[data-service="${CSS.escape(serviceId)}"] .badge`)
    if (!badge) return
    badge.className = `badge ${className}`.trim()
    badge.textContent = text
    badge.title = title || ''
  }
  function setRowInstance(serviceId, instance) {
    const select = document.querySelector(`.service[data-service="${CSS.escape(serviceId)}"] [data-field="instance"]`)
    if (select && instance) select.value = instance
  }
  function updateCurrentService(serviceId, serviceState) {
    if (current?.state?.services?.[serviceId] && serviceState) current.state.services[serviceId] = serviceState
  }
  async function refreshServiceState(serviceId) {
    const data = await msg('getState')
    updateCurrentService(serviceId, data.state.services[serviceId])
    return data.state.services[serviceId]
  }
  async function checkServiceOrBest(serviceId, { selectBestWhenUnchecked = false } = {}) {
    const config = current?.state?.services?.[serviceId]
    if (!config?.enabled) return
    const service = current.catalog[serviceId]
    const frontend = effectiveFrontends(service, config)[config.frontend]
    if (frontend?.appProtocol) {
      setRowHealthText(serviceId, t('notApplicable'), 'na')
      return
    }
    const existingHealth = config.health?.[config.instance]
    if (selectBestWhenUnchecked && !existingHealth) {
      setRowHealthText(serviceId, 'finding best…', 'warn')
      await nextPaint()
      await msg('selectBestInstance', { serviceId }).catch(() => null)
    } else {
      setRowHealthText(serviceId, 'checking…')
      await nextPaint()
      const health = await msg('checkInstanceHealth', { serviceId, instance: config.instance }).then(result => result.health, () => ({ ok: false }))
      if (!health?.ok && current?.state?.farsideFallbackEnabled) {
        setRowHealthText(serviceId, 'checking fallback…', 'warn')
        await nextPaint()
        await msg('checkInstanceHealth', { serviceId, instance: current.state.farsideBaseUrl || current.farside?.baseUrl || 'https://farside.link' }).catch(() => null)
      }
      if (!health?.ok && selectBestWhenUnchecked) {
        setRowHealthText(serviceId, 'finding best…', 'warn')
        await nextPaint()
        await msg('selectBestInstance', { serviceId }).catch(() => null)
      }
    }
    const nextConfig = await refreshServiceState(serviceId).catch(() => null)
    const activeConfig = nextConfig || current?.state?.services?.[serviceId]
    const badge = healthBadgeFor(activeConfig)
    setRowInstance(serviceId, activeConfig?.instance)
    setRowHealthText(serviceId, badge.text, badge.className, badge.title)
  }
  async function checkEnabledProgressively() {
    const ids = Object.keys(current?.state?.services || {}).filter(id => current.state.services[id].enabled)
    let index = 0
    const nextId = () => ids[index++]
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      for (let serviceId = nextId(); serviceId; serviceId = nextId()) await checkServiceOrBest(serviceId)
    }))
    await refresh()
  }
  async function selectBestEnabledProgressively() {
    const ids = Object.keys(current?.state?.services || {}).filter(id => current.state.services[id].enabled)
    let index = 0
    const nextId = () => ids[index++]
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
      for (let serviceId = nextId(); serviceId; serviceId = nextId()) {
        setRowHealthText(serviceId, 'finding best…', 'warn')
        await nextPaint()
        try {
          const result = await msg('selectBestInstance', { serviceId })
          const best = result?.best
          setRowInstance(serviceId, best?.instance)
          if (best?.health?.ok) setRowHealthText(serviceId, `${best.health.latencyMs ?? 'ok'} ms`, 'ok')
          else setRowHealthText(serviceId, t('notApplicable'), 'na')
        } catch (error) {
          setRowHealthText(serviceId, t('failed'), 'bad')
        }
      }
    }))
    await refresh()
  }
  $('profile').addEventListener('change', event => msg('applyProfile', { profile: event.target.value }).then(refresh))
  $('saveProfile').addEventListener('click', () => {
    $('profileName').value = ''
    $('profileDialog').showModal()
  })
  $('confirmSaveProfile').addEventListener('click', async () => {
    const name = $('profileName').value.trim()
    if (!name) return
    $('profileDialog').close()
    await msg('saveProfile', { name }).then(refresh)
  })
  $('enableAll').addEventListener('click', () => {
    if (!confirm('Enable all services? This will enable every redirect.')) return
    runButtonAction(event.currentTarget, 'Enabling…', async () => { await msg('setAllServices', { enabled: true }); await refresh(); await checkEnabledProgressively() }, { refreshAfter: false })
  })
  $('disableAll').addEventListener('click', () => {
    if (!confirm('Disable all services? No redirects will be active.')) return
    runButtonAction(event.currentTarget, 'Disabling…', () => msg('setAllServices', { enabled: false }))
  })
  $('resetDefaults').addEventListener('click', () => { if (confirm('Reset Freedirect settings to defaults?')) msg('resetState').then(refresh) })
  $('serviceSearch').addEventListener('input', () => { if (current) render(current) })
  function updateServiceFilterButtons() {
    const buttons = $('serviceFilter').querySelectorAll('button')
    buttons.forEach(btn => {
      const isActive = btn.dataset.filter === serviceFilter
      btn.classList.toggle('active', isActive)
      btn.setAttribute('aria-checked', String(isActive))
    })
  }
  $('serviceFilter').addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]')
    if (!button) return
    serviceFilter = button.dataset.filter
    updateServiceFilterButtons()
    if (current) render(current)
  })
  updateServiceFilterButtons()
  $('sortOrder').addEventListener('change', () => { if (current) render(current) })
  $('services').addEventListener('change', async event => {
    const row = event.target.closest('.service')
    if (!row || !event.target.dataset.field || event.target.dataset.field === 'custom') return
    const serviceId = row.dataset.service
    const field = event.target.dataset.field
    const patch = { [field]: field === 'enabled' ? event.target.checked : event.target.value }
    if (field === 'frontend') patch.instance = effectiveFrontends(current.catalog[serviceId], current.state.services[serviceId])[event.target.value].instances[0]
    const status = row.querySelector('.badge')
    if ((field === 'instance' || field === 'frontend' || field === 'enabled') && status) status.textContent = field === 'enabled' && !event.target.checked ? t('notChecked') : 'checking…'
    await nextPaint()
    await msg('updateService', { serviceId, patch })
    await refresh()
    if ((field === 'instance' || field === 'frontend' || field === 'enabled') && current.state.services[serviceId]?.enabled) await checkServiceOrBest(serviceId, { selectBestWhenUnchecked: field === 'enabled' && event.target.checked })
  })
  $('services').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    const row = button.closest('.service')
    const serviceId = row.dataset.service
    const instance = row.querySelector('[data-field="instance"]').value
    if (button.dataset.action === 'best') {
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
      setRowHealthText(serviceId, 'finding best…', 'warn')
      await nextPaint()
      try {
        const result = await msg('selectBestInstance', { serviceId })
        setRowInstance(serviceId, result?.best?.instance)
        await refresh()
      } catch (error) {
        alert(error?.message || String(error))
      } finally {
        button.disabled = false
        button.removeAttribute('aria-busy')
      }
      return
    }
    try {
      if (button.dataset.action === 'favorite') await msg('toggleFavoriteInstance', { serviceId, instance })
      if (button.dataset.action === 'health') {
        await checkServiceOrBest(serviceId)
        return
      }
      if (button.dataset.action === 'custom') {
        openCustomDialog(serviceId)
        return
      }
      if (button.dataset.action === 'removeCustom') await msg('removeCustomInstance', { serviceId, instance })
      await refresh()
    } catch (error) { alert(error?.message || String(error)) }
  })
  $('rebuild').addEventListener('click', event => runButtonAction(event.currentTarget, t('rebuildingRules'), () => msg('rebuildRules')))
  $('refreshInstances').addEventListener('click', event => runButtonAction(event.currentTarget, t('updatingInstanceLists'), () => msg('refreshPublicInstances')))
  $('customFrontendType').addEventListener('change', event => {
    $('customFrontendNameRow').classList.toggle('hidden', event.target.value !== '__new__')
  })
  $('saveCustom').addEventListener('click', async () => {
    if (!customServiceId) return
    const instance = $('customInstanceUrl').value.trim()
    const frontendType = $('customFrontendType').value
    const name = $('customFrontendName').value.trim()
    try {
      if (frontendType === '__new__') await msg('addCustomFrontend', { serviceId: customServiceId, name, instance })
      else {
        await msg('updateService', { serviceId: customServiceId, patch: { frontend: frontendType } })
        await msg('addCustomInstance', { serviceId: customServiceId, instance })
      }
      $('customDialog').close()
      await refresh()
    } catch (error) { alert(error?.message || String(error)) }
  })
  $('removeCustomFrontend').addEventListener('click', async () => {
    if (!customServiceId) return
    const frontendId = current.state.services[customServiceId].frontend
    try {
      await msg('removeCustomFrontend', { serviceId: customServiceId, frontendId })
      $('customDialog').close()
      await refresh()
    } catch (error) { alert(error?.message || String(error)) }
  })
  $('runSanity').addEventListener('click', async () => {
    $('sanityReport').textContent = 'Running sanity check…'
    try { $('sanityReport').textContent = formatSanityReport((await msg('runSanityCheck')).report) }
    catch (error) { $('sanityReport').textContent = `Sanity check failed: ${error?.message || error}` }
  })
  $('checkAll').addEventListener('click', event => runButtonAction(event.currentTarget, 'Checking selected instances…', checkEnabledProgressively, { refreshAfter: false }))
  $('bestAll').addEventListener('click', event => runButtonAction(event.currentTarget, 'Finding best instances…', selectBestEnabledProgressively, { refreshAfter: false }))
  $('farsideFallbackEnabled').addEventListener('change', event => msg('setFarsideFallbackEnabled', { enabled: event.target.checked }).then(refresh))
  $('saveFarsideBase').addEventListener('click', event => runButtonAction(event.currentTarget, 'Saving Farside URL…', () => msg('setFarsideBaseUrl', { url: $('farsideBaseUrl').value.trim() })))
  $('showCommands').addEventListener('click', async () => {
    const result = await msg('getCommands')
    $('commands').innerHTML = result.available ? result.commands.map(command => `<li>${esc(command.description || command.name)} — ${esc(command.shortcut || t('unassigned'))}</li>`).join('') : `<li class="empty-state">${esc(result.reason || t('commandsUnavailable')) || 'Keyboard shortcuts let you redirect or reverse the current page. Add one in Safari Settings → Extensions → Freedirect.'}</li>`
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
