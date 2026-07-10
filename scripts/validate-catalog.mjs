import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const listeners = {}
function event(name) { return { addListener(callback) { listeners[name] = callback } } }

const localStorage = {}
let dynamicRules = []
let nativeMessageHandler = async () => ({ ok: true })
const dynamicRuleFailures = new Map()
const browser = {
  storage: {
    local: {
      async get(keys) {
        const requested = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(requested.filter(key => key in localStorage).map(key => [key, localStorage[key]]))
      },
      async set(value) { Object.assign(localStorage, value) }
    },
    onChanged: event('storage.onChanged')
  },
  declarativeNetRequest: {
    async getDynamicRules() { return dynamicRules },
    async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
      for (const rule of addRules) {
        const remainingFailures = dynamicRuleFailures.get(rule.id) ?? 0
        if (remainingFailures > 0) {
          dynamicRuleFailures.set(rule.id, remainingFailures - 1)
          throw new Error(`transient replacement failure for ${rule.id}`)
        }
      }
      const removed = new Set(removeRuleIds)
      const retained = dynamicRules.filter(rule => !removed.has(rule.id))
      const retainedIds = new Set(retained.map(rule => rule.id))
      for (const rule of addRules) {
        if (retainedIds.has(rule.id)) throw new Error(`duplicate rule id ${rule.id}`)
        retainedIds.add(rule.id)
      }
      dynamicRules = [...retained, ...addRules]
    },
    async getSessionRules() { return [] },
    async updateSessionRules() {}
  },
  runtime: {
    onInstalled: event('runtime.onInstalled'),
    onStartup: event('runtime.onStartup'),
    onMessage: event('runtime.onMessage'),
    onMessageExternal: event('runtime.onMessageExternal'),
    openOptionsPage() {},
    async sendNativeMessage(...args) {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : null
      const message = typeof args[0] === 'string' ? args[1] : args[0]
      const response = await nativeMessageHandler(message)
      callback?.(response)
      return response
    }
  },
  contextMenus: { async removeAll() {}, create() {}, onClicked: event('contextMenus.onClicked') },
  commands: { onCommand: event('commands.onCommand'), async getAll() { return [] } },
  webNavigation: { onBeforeNavigate: event('webNavigation.onBeforeNavigate') },
  tabs: { async query() { return [] }, async update() {}, async create() {}, async remove() {}, async reload() {} },
  permissions: { async request() { return true }, async contains() { return true } },
  i18n: { getMessage(key) { return key } }
}

const context = vm.createContext({ browser, chrome: browser, console, URL, Date, RegExp, performance, setTimeout, clearTimeout, AbortController, fetch: async () => ({ ok: true, status: 200, type: 'basic' }) })
vm.runInContext(readFileSync('Shared (Extension)/Resources/background.js', 'utf8'), context, { filename: 'background.js' })
const catalog = vm.runInContext('SERVICE_CATALOG', context)
const samples = JSON.parse(readFileSync('scripts/service-test-cases.json', 'utf8'))

const errors = []
const ids = Object.keys(catalog)
if (ids.length !== 51) errors.push(`expected 51 service groups, got ${ids.length}`)
const highCount = Object.values(catalog).filter(service => service.confidence === 'high').length
if (highCount !== 11) errors.push(`expected 11 high-confidence groups, got ${highCount}`)

function validateRule(serviceId, label, rule, { requireSlash = false } = {}) {
  try { new RegExp(rule.source) } catch (error) { errors.push(`${serviceId} ${label}: invalid regex ${error.message}`) }
  if (typeof rule.path !== 'string' || !rule.path) errors.push(`${serviceId} ${label}: invalid path ${rule.path}`)
  else if (requireSlash && !rule.path.startsWith('/')) errors.push(`${serviceId} ${label}: path must start with /: ${rule.path}`)
  for (const [index, nested] of (rule.dnrRules ?? []).entries()) validateRule(serviceId, `${label} dnrRule ${index}`, { ...rule, ...nested, dnrRules: [] }, { requireSlash })
}

for (const [serviceId, service] of Object.entries(catalog)) {
  if (!service.name) errors.push(`${serviceId}: missing display name`)
  if (!['high', 'starter'].includes(service.confidence)) errors.push(`${serviceId}: invalid confidence ${service.confidence}`)
  if (!Array.isArray(service.originalHosts) || !service.originalHosts.length) errors.push(`${serviceId}: missing original hosts`)
  if (!service.frontends?.[service.defaultFrontend]) errors.push(`${serviceId}: default frontend not present`)
  if (!Array.isArray(service.rules) || !service.rules.length) errors.push(`${serviceId}: missing redirect rules`)
  if (!samples[serviceId]) errors.push(`${serviceId}: missing service test sample`)

  for (const [frontendId, frontend] of Object.entries(service.frontends ?? {})) {
    if (!frontend.name) errors.push(`${serviceId}/${frontendId}: missing frontend name`)
    if (!Array.isArray(frontend.instances) || !frontend.instances.length) errors.push(`${serviceId}/${frontendId}: missing instances`)
    for (const instance of frontend.instances ?? []) {
      try {
        const url = new URL(instance)
        if (frontend.appProtocol) {
          if (!instance.endsWith('://')) errors.push(`${serviceId}/${frontendId}: app protocol instance should end in :// ${instance}`)
        } else {
          if (url.protocol !== 'https:') errors.push(`${serviceId}/${frontendId}: non-HTTPS instance ${instance}`)
          if (url.pathname !== '/' || url.search || url.hash) errors.push(`${serviceId}/${frontendId}: instance should be origin-only ${instance}`)
        }
      } catch {
        errors.push(`${serviceId}/${frontendId}: invalid instance URL ${instance}`)
      }
    }
    for (const [index, rule] of (frontend.rules ?? []).entries()) validateRule(serviceId, `${frontendId} rule ${index}`, rule)
  }

  for (const [index, rule] of (service.rules ?? []).entries()) validateRule(serviceId, `rule ${index}`, rule, { requireSlash: true })
}

const extraSamples = Object.keys(samples).filter(serviceId => !catalog[serviceId])
for (const serviceId of extraSamples) errors.push(`${serviceId}: sample has no catalog service`)

function checkRuleSet(name, rules) {
  if (!rules.length) errors.push(`${name} generated no rules`)
  if (rules.length > 5000) errors.push(`${name} generated too many rules: ${rules.length}`)
  const ruleIds = new Set()
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) errors.push(`${name}: duplicate DNR rule id ${rule.id}`)
    ruleIds.add(rule.id)
    if (!['redirect', 'allow'].includes(rule.action?.type)) errors.push(`${name} rule ${rule.id}: unexpected action`)
    if (!rule.condition?.regexFilter) errors.push(`${name} rule ${rule.id}: missing regexFilter`)
  }
}

const strictRules = vm.runInContext(`(() => { const state = defaultState(); applyProfile(state, 'strict'); return makeRules(state); })()`, context)
checkRuleSet('strict profile', strictRules)
const staticOverrideRules = vm.runInContext(`(() => { const state = defaultState(); state.services.youtube.frontend = 'freetube'; state.services.youtube.instance = 'freetube://'; state.services.reddit.enabled = false; state.services.twitter.enabled = false; return makeRules(state); })()`, context)
checkRuleSet('static override profile', staticOverrideRules)

const instances = JSON.parse(readFileSync('Shared (Extension)/Resources/instances.json', 'utf8'))
for (const [frontendId, entry] of Object.entries(instances)) {
  if (!Array.isArray(entry?.clearnet)) {
    errors.push(`instances/${frontendId}: clearnet must be an array`)
    continue
  }
  for (const instance of entry.clearnet) {
    try {
      const url = new URL(instance)
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) errors.push(`instances/${frontendId}: invalid origin ${instance}`)
    } catch {
      errors.push(`instances/${frontendId}: invalid URL ${instance}`)
    }
  }
}

for (const [serviceId, sample] of Object.entries(samples)) {
  const redirect = vm.runInContext(`(() => {
    const state = defaultState()
    state.globalEnabled = true
    state.services[${JSON.stringify(serviceId)}].enabled = true
    return applyTemplateRedirect(${JSON.stringify(sample)}, state)
  })()`, context)
  if (!redirect) errors.push(`${serviceId}: sample URL does not redirect`)
}

localStorage.freedirectSyncMeta = { syncEnabled: false, deviceId: 'catalog-validator' }
dynamicRules = []
await vm.runInContext('rebuildRulesNow()', context)
const firstSafariRules = dynamicRules.map(rule => rule.id)
await vm.runInContext('rebuildRulesNow()', context)
const secondSafariRules = dynamicRules.map(rule => rule.id)
if (!firstSafariRules.length || firstSafariRules.join(',') !== secondSafariRules.join(',')) {
  errors.push('Safari rebuild did not preserve the generated dynamic rule set')
}

localStorage.freedirectState = vm.runInContext('defaultState()', context)
localStorage.freedirectState.services.reddit.instance = 'https://redlib.net'
await vm.runInContext('rebuildRulesNow()', context)
const staleRedditRule = dynamicRules.find(rule => rule.action?.redirect?.regexSubstitution?.startsWith('https://redlib.net'))
if (!staleRedditRule) {
  errors.push('could not seed a redlib.net rule for Safari retry validation')
} else {
  localStorage.freedirectState.services.reddit.instance = 'https://safereddit.com'
  dynamicRuleFailures.set(staleRedditRule.id, 1)
  await vm.runInContext('rebuildRulesNow()', context)
  const replacedRedditRule = dynamicRules.find(rule => rule.id === staleRedditRule.id)
  if (!replacedRedditRule?.action?.redirect?.regexSubstitution?.startsWith('https://safereddit.com')) {
    errors.push('Safari retry preserved a stale Reddit instance after a transient replacement failure')
  }
}

localStorage.freedirectState = vm.runInContext('defaultState()', context)
localStorage.freedirectState.services.reddit.enabled = false
localStorage.freedirectState.services.reddit.instance = 'https://safereddit.com'
await new Promise((resolve, reject) => {
  listeners['runtime.onMessage'](
    { type: 'updateService', serviceId: 'reddit', patch: { enabled: true } },
    {},
    response => response?.error ? reject(new Error(response.error)) : resolve(response)
  )
})
if (localStorage.freedirectState.services.reddit.instance !== 'https://safereddit.com') {
  errors.push('enabling Reddit replaced the configured instance')
}

let contentStorageListener = null
const rewrittenAnchor = {
  href: 'https://redlib.net/r/privacy',
  dataset: { freedirectChecked: 'https://www.reddit.com/r/privacy' },
  rel: '',
  removeAttribute() {}
}
const contentWindow = {}
contentWindow.top = contentWindow
const contentContext = vm.createContext({
  browser: {
    runtime: {},
    storage: { onChanged: { addListener(listener) { contentStorageListener = listener } } }
  },
  window: contentWindow,
  document: {
    documentElement: {},
    readyState: 'complete',
    title: '',
    body: { innerText: '' },
    querySelectorAll() { return [rewrittenAnchor] },
    addEventListener() {}
  },
  location: { href: 'https://example.com/', protocol: 'https:', replace() {} },
  history: { length: 1, back() {} },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  URL,
  setTimeout() { return 1 },
  clearTimeout() {}
})
vm.runInContext(readFileSync('Shared (Extension)/Resources/content-script.js', 'utf8'), contentContext, { filename: 'content-script.js' })
contentStorageListener?.({ freedirectState: { newValue: {} } }, 'local')
if (rewrittenAnchor.href !== 'https://www.reddit.com/r/privacy' || 'freedirectChecked' in rewrittenAnchor.dataset) {
  errors.push('state change did not invalidate a rewritten Reddit link')
}

const selectedInstancePreserved = vm.runInContext(`(() => {
  const state = defaultState()
  const entry = Object.entries(SERVICE_CATALOG).find(([, service]) => Object.values(service.frontends).some(frontend => frontend.instances.length > 1))
  const [serviceId, service] = entry
  const [frontendId, frontend] = Object.entries(service.frontends).find(([, value]) => value.instances.length > 1)
  const originalInstances = [...frontend.instances]
  const selected = originalInstances[originalInstances.length - 1]
  state.services[serviceId].frontend = frontendId
  state.services[serviceId].instance = selected
  frontend.instances = [originalInstances[0]]
  const preserved = migrateState(state).services[serviceId].instance === selected
  frontend.instances = originalInstances
  return preserved
})()`, context)
if (!selectedInstancePreserved) errors.push('state migration discarded a valid selected instance missing from a refreshed catalog')

async function waitFor(predicate, label, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

console.log('catalog validation: testing sync push race')
localStorage.freedirectState = vm.runInContext('defaultState()', context)
localStorage.freedirectSyncMeta = {
  syncEnabled: true,
  deviceId: 'catalog-validator',
  localDirtyAt: '2026-01-01T00:00:00.000Z',
  pendingConflict: null
}
vm.runInContext('syncMetaCache = null', context)
let resolvePush
nativeMessageHandler = async message => {
  if (message.type !== 'syncPut') return { ok: true, available: true }
  return await new Promise(resolve => { resolvePush = resolve })
}
const pushPromise = vm.runInContext('syncPush()', context)
await waitFor(() => Boolean(resolvePush), 'native syncPut')
await vm.runInContext('withStateWrite(state => { state.globalEnabled = !state.globalEnabled })', context)
resolvePush({ ok: true, available: true, written: true, cloudUpdatedAt: '2026-01-01T00:00:00.000Z' })
const pushResult = await pushPromise
if (!pushResult.pending || !localStorage.freedirectSyncMeta.localDirtyAt) errors.push('sync push discarded a local edit made during the native write')
vm.runInContext('if (syncPushTimer) { clearTimeout(syncPushTimer); syncPushTimer = null }', context)

console.log('catalog validation: testing sync pull race')
const cloudState = vm.runInContext('(() => { const state = defaultState(); state.globalEnabled = false; return state })()', context)
localStorage.freedirectState = vm.runInContext('defaultState()', context)
localStorage.freedirectSyncMeta = {
  syncEnabled: true,
  deviceId: 'catalog-validator',
  localDirtyAt: null,
  cloudUpdatedAt: null,
  cloudHash: null,
  pendingConflict: null
}
vm.runInContext('syncMetaCache = null', context)
let resolvePull
nativeMessageHandler = async message => {
  if (message.type !== 'syncGet') return { ok: true, available: true }
  return await new Promise(resolve => { resolvePull = resolve })
}
const pullPromise = vm.runInContext('syncPull()', context)
await waitFor(() => Boolean(resolvePull), 'native syncGet')
await vm.runInContext('withStateWrite(state => { state.farsideFallbackEnabled = false })', context)
resolvePull({
  ok: true,
  available: true,
  payload: { format: 'freedirect-state', updatedAt: '2026-01-02T00:00:00.000Z', originDevice: 'other-device', state: cloudState },
  cloudUpdatedAt: '2026-01-02T00:00:00.000Z',
  cloudOrigin: 'other-device'
})
const pullResult = await pullPromise
if (!pullResult.pending || localStorage.freedirectState.farsideFallbackEnabled !== false || localStorage.freedirectState.globalEnabled !== true) {
  errors.push('sync pull overwrote a local edit made during the native read')
}
vm.runInContext('if (syncPushTimer) { clearTimeout(syncPushTimer); syncPushTimer = null }', context)
const bypassIsExact = vm.runInContext(`(() => {
  const regex = new RegExp(bypassRegexForUrl('https://www.youtube.com/watch?v=one'))
  return regex.test('https://www.youtube.com/watch?v=one') && !regex.test('https://www.youtube.com/watch?v=two')
})()`, context)
if (!bypassIsExact) errors.push('URL bypass matched a different query on the same path')
if (errors.length) {
  console.error(errors.map(error => `catalog validation: ${error}`).join('\n'))
  process.exit(1)
}

console.log(`catalog validation ok (${ids.length} services, ${strictRules.length} strict rules)`)
