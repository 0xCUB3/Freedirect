import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const serviceSamples = JSON.parse(readFileSync('scripts/service-test-cases.json', 'utf8'))

const listeners = {}
const storage = {}
let dynamicRules = []
let sessionRules = []
let enabledRulesets = ['freedirect_static_defaults']
let activeTabUrl = 'https://www.youtube.com/watch?v=test'
let activeHealthFetches = 0
let maxHealthFetches = 0

function event(name) {
  return { addListener(callback) { listeners[name] = callback } }
}

const browser = {
  storage: {
    local: {
      async get(keys) {
        if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, storage[key]]))
        return storage
      },
      async set(value) { Object.assign(storage, value) }
    },
    onChanged: event('storage.onChanged')
  },
  declarativeNetRequest: {
    async getDynamicRules() { return dynamicRules },
    async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
      dynamicRules = dynamicRules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules)
    },
    async getEnabledRulesets() { return enabledRulesets },
    async updateEnabledRulesets({ enableRulesetIds = [], disableRulesetIds = [] }) {
      enabledRulesets = enabledRulesets.filter(id => !disableRulesetIds.includes(id))
      enabledRulesets = Array.from(new Set([...enabledRulesets, ...enableRulesetIds]))
    },
    async getSessionRules() { return sessionRules },
    async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
      sessionRules = sessionRules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules)
    }
  },
  runtime: {
    onInstalled: event('runtime.onInstalled'),
    onStartup: event('runtime.onStartup'),
    onMessage: event('runtime.onMessage'),
    onMessageExternal: event('runtime.onMessageExternal'),
    async sendNativeMessage(applicationId, message) { return { ok: true, platform: 'test', capabilities: ['nativeMessaging'], applicationId, message } },
    getURL(path) { return path },
    openOptionsPage() {}
  },
  contextMenus: {
    async removeAll() {},
    create(item) {
      if (item.contexts?.includes('action')) throw new Error('unsupported context in this Safari build')
    },
    onClicked: event('contextMenus.onClicked')
  },
  commands: { onCommand: event('commands.onCommand'), async getAll() { return [{ name: 'redirect-current', description: 'Redirect the current page', shortcut: 'Alt+Shift+R' }] } },
  webNavigation: { onBeforeNavigate: event('webNavigation.onBeforeNavigate'), onCompleted: event('webNavigation.onCompleted'), onErrorOccurred: event('webNavigation.onErrorOccurred') },
  tabs: {
    async query() { return [{ id: 1, url: activeTabUrl }] },
    async get(tabId) { return { id: tabId, url: activeTabUrl } },
    async update(tabId, details = {}) {
      if (details.url) activeTabUrl = details.url
      return { id: tabId, url: activeTabUrl }
    },
    async create(details = {}) {
      if (details.active !== false && details.url) activeTabUrl = details.url
      return { id: 2, url: details.url }
    },
    async remove() {},
    async reload() {}
  },
  permissions: { async request() { return true }, async contains() { return true } }
}

async function send(message) {
  return await new Promise((resolve, reject) => {
    try { listeners['runtime.onMessage'](message, {}, resolve) }
    catch (error) { reject(error) }
  })
}

const context = vm.createContext({
  browser,
  chrome: browser,
  console,
  URL,
  URLSearchParams,
  Date,
  RegExp,
  performance,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async url => {
    const value = String(url)
    if (value.includes('libredirect/instances') || value.includes('instances.json')) return { ok: true, status: 200, type: 'basic', async json() { return { invidious: { clearnet: ['https://fast.example', 'https://inv.nadeko.net'] }, redlib: { clearnet: ['https://redlib.example'] } } } }
    activeHealthFetches += 1
    maxHealthFetches = Math.max(maxHealthFetches, activeHealthFetches)
    await new Promise(resolve => setTimeout(resolve, 1))
    activeHealthFetches -= 1
    return { ok: true, status: 200, type: 'basic', async json() { return {} } }
  }
})
vm.runInContext(readFileSync('Shared (Extension)/Resources/background.js', 'utf8'), context, { filename: 'background.js' })

await listeners['runtime.onInstalled']()
if (dynamicRules.length < 1) throw new Error('Expected dynamic rules after install')
if (enabledRulesets.includes('freedirect_static_defaults')) throw new Error('Expected static bootstrap ruleset to be disabled after install')
if (!storage.freedirectState) throw new Error('Expected stored Freedirect state')

let response = await send({ type: 'getState' })
if (!response.catalog.youtube) throw new Error('Expected YouTube catalog')
if (Object.keys(response.catalog).length !== 51) throw new Error(`Expected 51 service groups, got ${Object.keys(response.catalog).length}`)
if (Object.values(response.catalog).filter(service => service.confidence === 'high').length !== 11) throw new Error('Expected 11 high-confidence service groups')
if (Object.values(response.catalog).some(service => !['high', 'starter'].includes(service.confidence))) throw new Error('Expected confidence metadata for every service')
if (!response.profiles.strict) throw new Error('Expected strict profile')
if (!response.permissions.allUrls) throw new Error('Expected all-URLs permission state')
if (!response.activeTabPermissions.granted) throw new Error('Expected active tab permission state')
for (const serviceId of response.profiles.balanced.enabledServices) {
  if (!response.state.services[serviceId].enabled) throw new Error(`Expected balanced service enabled: ${serviceId}`)
}
if (!response.state.diagnostics.lastRuleCount) throw new Error('Expected diagnostics rule count')
if (!response.catalog.youtube.frontends.invidious.instances.includes('https://fast.example')) throw new Error('Expected public instance list merge')

await send({ type: 'applyProfile', profile: 'strict' })
response = await send({ type: 'getState' })
if (response.state.profile !== 'strict') throw new Error('Expected strict profile state')
if (dynamicRules.length <= 6) throw new Error('Expected more dynamic rules after strict profile')

await send({ type: 'setAllServices', enabled: false })
response = await send({ type: 'getState' })
if (response.state.profile !== 'manual' || Object.values(response.state.services).some(service => service.enabled)) throw new Error('Expected disable-all manual state')
if (dynamicRules.some(rule => rule.action?.type === 'redirect')) throw new Error('Expected no dynamic redirect rules after disable all')
await send({ type: 'setAllServices', enabled: true })
response = await send({ type: 'getState' })
if (Object.values(response.state.services).some(service => !service.enabled)) throw new Error('Expected enable all state')
await send({ type: 'resetState' })
response = await send({ type: 'getState' })
if (response.state.profile !== 'balanced' || !response.state.services.youtube.enabled || response.state.services.maps.enabled) throw new Error('Expected reset default state')
await send({ type: 'applyProfile', profile: 'strict' })
response = await send({ type: 'getState' })

const redirectSamples = [
  ['https://www.youtube.com/watch?v=test', 'https://inv.thepixora.com/watch?v=test&local=false'],
  ['https://youtu.be/abc123', 'https://inv.thepixora.com/watch?v=abc123&local=false'],
  ['https://www.reddit.com/r/privacy/', 'https://redlib.net/r/privacy/'],
  ['https://x.com/example/status/1', 'https://nitter.net/example/status/1'],
  ['https://www.instagram.com/p/example/', 'https://kittygr.am/p/example/'],
  ['https://www.tiktok.com/@u/video/1', 'https://proxitok.pabloferreiro.es/@u/video/1'],
  ['https://www.google.com/search?q=privacy', 'https://search.sapti.me/search?q=privacy'],
  ['https://medium.com/@user/post', 'https://scribe.rip/@user/post'],
  ['https://en.wikipedia.org/wiki/Privacy', 'https://wikiless.org/wiki/Privacy'],
  ['https://www.imdb.com/title/tt0000001/', 'https://libremdb.iket.me/title/tt0000001/'],
  ['https://starwars.fandom.com/wiki/Jedi', 'https://breezewiki.com/starwars/wiki/Jedi'],
  ['https://chat.openai.com/c/abc', 'https://duck.ai/c/abc'],
  ['https://i.imgur.com/example.png', 'https://rimgo.catsarch.com/example.png']
]
for (const [input, expected] of redirectSamples) {
  const result = await send({ type: 'previewRedirect', url: input })
  if (result.url !== expected) throw new Error(`Redirect mismatch for ${input}: ${result.url} !== ${expected}`)
}
let farsideReverse = await send({ type: 'previewReverse', url: 'https://farside.link/invidious/watch?v=test' })
if (farsideReverse.url !== 'https://www.youtube.com/watch?v=test') throw new Error(`Expected Farside reverse, got ${farsideReverse.url}`)
await send({ type: 'setFarsideBaseUrl', url: 'https://cf.farside.link/path' })
let farside = await send({ type: 'farsideForUrl', url: 'https://www.youtube.com/watch?v=test' })
if (farside.url !== 'https://cf.farside.link/invidious/watch?v=test&local=false') throw new Error(`Expected custom Farside URL, got ${farside.url}`)
const directWithFallback = await send({ type: 'previewRedirect', url: 'https://www.youtube.com/watch?v=test' })
if (directWithFallback.url !== 'https://inv.thepixora.com/watch?v=test&local=false') throw new Error('Expected Farside fallback to keep selected instance first')
const fallbackUrl = await send({ type: 'farsideFallbackForUrl', url: 'https://inv.thepixora.com/watch?v=test&local=false' })
if (fallbackUrl.url !== 'https://cf.farside.link/invidious/watch?v=test&local=false') throw new Error(`Expected Farside fallback URL, got ${fallbackUrl.url}`)
activeTabUrl = 'https://inv.thepixora.com/watch?v=test&local=false'
await listeners['webNavigation.onErrorOccurred']({ frameId: 0, tabId: 1, url: activeTabUrl, error: 'Frame load interrupted' })
if (activeTabUrl !== 'https://inv.thepixora.com/watch?v=test&local=false') throw new Error('Expected benign interrupted navigation to stay on selected instance')
await listeners['webNavigation.onErrorOccurred']({ frameId: 0, tabId: 1, url: activeTabUrl, error: 'NSURLErrorDomain -1003' })
if (activeTabUrl !== 'https://inv.thepixora.com/watch?v=test&local=false') throw new Error('Expected navigation error fallback to wait before changing the tab')
listeners['webNavigation.onCompleted']({ frameId: 0, tabId: 1 })
await send({ type: 'setFarsideFallbackEnabled', enabled: false })
const disabledFallback = await send({ type: 'farsideFallbackForUrl', url: 'https://inv.thepixora.com/watch?v=test&local=false' })
if (disabledFallback.url) throw new Error('Expected disabled global Farside fallback')
await send({ type: 'setFarsideFallbackEnabled', enabled: true })
await send({ type: 'setFarsideBaseUrl', url: 'https://farside.link' })
activeTabUrl = 'https://www.youtube.com/watch?v=test'
const diagnosis = await send({ type: 'diagnoseUrl', url: 'https://www.youtube.com/watch?v=test' })
if (diagnosis.diagnosis.serviceId !== 'youtube' || diagnosis.diagnosis.redirectUrl !== 'https://inv.thepixora.com/watch?v=test&local=false') throw new Error('Expected YouTube URL diagnosis')
const batchDiagnosis = await send({ type: 'diagnoseUrls', urls: ['https://www.youtube.com/watch?v=test', 'https://www.reddit.com/r/privacy/', 'https://example.com/'] })
if (batchDiagnosis.diagnoses?.[0]?.redirectUrl !== 'https://inv.thepixora.com/watch?v=test&local=false' || batchDiagnosis.diagnoses?.[1]?.redirectUrl !== 'https://redlib.net/r/privacy/' || batchDiagnosis.diagnoses?.[2]?.reason !== 'no-match') throw new Error('Expected batched URL diagnosis')
const currentDiagnosis = await send({ type: 'diagnoseCurrent' })
if (currentDiagnosis.diagnosis.serviceId !== 'youtube') throw new Error('Expected current tab diagnosis')

const reverseSamples = [
  ['https://inv.thepixora.com/watch?v=test', 'https://www.youtube.com/watch?v=test'],
  ['https://redlib.net/r/privacy/', 'https://reddit.com/r/privacy/'],
  ['https://nitter.net/example/status/1', 'https://x.com/example/status/1'],
  ['https://kittygr.am/p/example/', 'https://instagram.com/p/example/'],
  ['https://proxitok.pabloferreiro.es/@u/video/1', 'https://tiktok.com/@u/video/1'],
  ['https://search.sapti.me/search?q=privacy', 'https://www.google.com/search?q=privacy'],
  ['https://wikiless.org/wiki/Privacy', 'https://en.wikipedia.org/wiki/Privacy'],
  ['https://libremdb.iket.me/title/tt0000001/', 'https://imdb.com/title/tt0000001/'],
  ['https://breezewiki.com/starwars/wiki/Jedi', 'https://starwars.fandom.com/wiki/Jedi']
]
for (const [input, expected] of reverseSamples) {
  const result = await send({ type: 'previewReverse', url: input })
  if (result.url !== expected) throw new Error(`Reverse mismatch for ${input}: ${result.url} !== ${expected}`)
}

activeTabUrl = 'https://nitter.net/BetaProfiles'
const openedOriginal = await send({ type: 'reverseCurrent' })
if (openedOriginal.url !== 'https://x.com/BetaProfiles') throw new Error(`Expected Open original to target X profile, got ${openedOriginal.url}`)
const originalRule = sessionRules.find(rule => rule.id === 900001)
if (!originalRule) throw new Error('Expected Open original session allow rule')
const originalAllow = new RegExp(originalRule.condition.regexFilter)
if (!originalAllow.test('https://x.com/BetaProfiles/') || !originalAllow.test('https://www.x.com/BetaProfiles?mx=1')) throw new Error(`Expected resilient Open original allow rule, got ${originalRule.condition.regexFilter}`)
const bypassedVariant = await send({ type: 'diagnoseUrl', url: 'https://x.com/BetaProfiles/' })
if (bypassedVariant.diagnosis.reason !== 'bypassed' || bypassedVariant.diagnosis.redirectUrl) throw new Error('Expected Open original bypass to handle URL variants')
await send({ type: 'clearBypasses' })
activeTabUrl = 'https://www.youtube.com/watch?v=test'

for (const [serviceId, input] of Object.entries(serviceSamples)) {
  const result = await send({ type: 'previewRedirect', url: input })
  if (!result.url) throw new Error(`Expected service sample redirect for ${serviceId}: ${input}`)
  const instance = response.state.services[serviceId].instance
  if (!result.url.startsWith(instance)) throw new Error(`Expected ${serviceId} to redirect to ${instance}, got ${result.url}`)
}
if (Object.keys(serviceSamples).length !== Object.keys(response.catalog).length) throw new Error('Service sample coverage mismatch')
activeHealthFetches = 0
maxHealthFetches = 0
await send({ type: 'checkAllSelectedHealth' })
if (maxHealthFetches > 8) throw new Error(`Expected selected health checks to be concurrency-limited, saw ${maxHealthFetches}`)

await send({ type: 'updateService', serviceId: 'youtube', patch: { frontend: 'materialious', instance: 'materialious://' } })
let materialiousRedirect = await send({ type: 'previewRedirect', url: 'https://www.youtube.com/watch?v=test' })
if (materialiousRedirect.url !== 'materialious://watch/test') throw new Error(`Expected Materialious app redirect, got ${materialiousRedirect.url}`)
materialiousRedirect = await send({ type: 'previewRedirect', url: 'https://youtu.be/abc123' })
if (materialiousRedirect.url !== 'materialious://watch/abc123') throw new Error(`Expected Materialious short-link redirect, got ${materialiousRedirect.url}`)
materialiousRedirect = await send({ type: 'previewRedirect', url: 'https://www.youtube.com/shorts/shortid' })
if (materialiousRedirect.url !== 'materialious://watch/shortid') throw new Error(`Expected Materialious Shorts redirect, got ${materialiousRedirect.url}`)
await send({ type: 'updateService', serviceId: 'youtube', patch: { frontend: 'invidious', instance: 'https://inv.thepixora.com' } })

await send({ type: 'addCustomInstance', serviceId: 'youtube', instance: 'https://example.invalid/path' })
await send({ type: 'toggleFavoriteInstance', serviceId: 'youtube', instance: 'https://example.invalid' })
await send({ type: 'updateService', serviceId: 'youtube', patch: { mode: 'rotating' } })
response = await send({ type: 'getState' })
if (!response.state.services.youtube.customInstances.includes('https://example.invalid')) throw new Error('Expected custom instance')
if (!response.state.services.youtube.favoriteInstances.includes('https://example.invalid')) throw new Error('Expected favorite instance')
if (response.state.services.youtube.mode !== 'selected') throw new Error('Expected selected instance mode')
await send({ type: 'updateService', serviceId: 'youtube', patch: { frontend: 'not-real', instance: 'javascript:alert(1)', customInstances: ['http://unsafe.example'] } })
response = await send({ type: 'getState' })
if (response.state.services.youtube.frontend !== 'invidious' || response.state.services.youtube.instance !== 'https://example.invalid') throw new Error('Expected unsafe service update to be sanitized')
const unsafeCustom = await send({ type: 'addCustomInstance', serviceId: 'youtube', instance: 'http://unsafe.example' })
if (!unsafeCustom.error?.includes('HTTPS')) throw new Error('Expected unsafe custom instance rejection')
const unsafeFavorite = await send({ type: 'toggleFavoriteInstance', serviceId: 'youtube', instance: 'javascript:alert(1)' })
if (!unsafeFavorite.error?.includes('HTTPS')) throw new Error('Expected unsafe favorite rejection')
await send({ type: 'removeCustomInstance', serviceId: 'youtube', instance: 'https://example.invalid' })
response = await send({ type: 'getState' })
if (response.state.services.youtube.customInstances.includes('https://example.invalid')) throw new Error('Expected removed custom instance')
if (response.state.services.youtube.favoriteInstances.includes('https://example.invalid')) throw new Error('Expected removed custom favorite')
if (response.state.services.youtube.instance === 'https://example.invalid') throw new Error('Expected selected instance reset after custom removal')
await send({ type: 'addCustomFrontend', serviceId: 'reddit', name: 'Custom Redlib', instance: 'https://custom-redlib.example/path' })
response = await send({ type: 'getState' })
if (response.state.services.reddit.frontend !== 'custom:custom-redlib' || response.state.services.reddit.instance !== 'https://custom-redlib.example') throw new Error('Expected custom frontend selection')
const customFrontendRedirect = await send({ type: 'previewRedirect', url: 'https://www.reddit.com/r/privacy/' })
if (customFrontendRedirect.url !== 'https://custom-redlib.example/r/privacy/') throw new Error('Expected custom frontend redirect')
await send({ type: 'removeCustomFrontend', serviceId: 'reddit', frontendId: 'custom:custom-redlib' })
response = await send({ type: 'getState' })
if (response.state.services.reddit.frontend !== 'redlib' || response.state.services.reddit.customFrontends['custom:custom-redlib']) throw new Error('Expected custom frontend removal')
await send({ type: 'addCustomInstance', serviceId: 'youtube', instance: 'https://example.invalid/path' })

const health = await send({ type: 'checkInstanceHealth', serviceId: 'youtube', instance: 'https://example.invalid' })
if (!health.health.ok) throw new Error('Expected healthy mocked instance')
const best = await send({ type: 'selectBestInstance', serviceId: 'youtube' })
response = await send({ type: 'getState' })
if (!best.best.instance || response.state.services.youtube.instance !== best.best.instance || response.state.services.youtube.mode !== 'selected') throw new Error('Expected best instance selection')
if (maxHealthFetches > 8) throw new Error(`Expected best-instance checks to be concurrency-limited, saw ${maxHealthFetches}`)

const original = await send({ type: 'originalForCurrent' })
if (!original.url.includes('youtube.com')) throw new Error('Expected original URL response')
await send({ type: 'bypassCurrent' })
response = await send({ type: 'getState' })
if (!sessionRules.length || !response.state.diagnostics.bypassedUrls.length) throw new Error('Expected bypass session rule and diagnostics')
const bypassedDiagnosis = await send({ type: 'diagnoseUrl', url: response.state.diagnostics.bypassedUrls[0] })
if (bypassedDiagnosis.diagnosis.redirectUrl || bypassedDiagnosis.diagnosis.reason !== 'bypassed') throw new Error('Expected diagnoseUrl to respect bypassed URLs')
const cleared = await send({ type: 'clearBypasses' })
response = await send({ type: 'getState' })
if (cleared.cleared < 1 || sessionRules.length || response.state.diagnostics.bypassedUrls.length) throw new Error('Expected cleared bypasses')

const permissions = await send({ type: 'getPermissions' })
if (!permissions.permissions.allUrls) throw new Error('Expected getPermissions allUrls')
const native = await send({ type: 'nativeCapabilities' })
if (!native.ok || !native.capabilities.includes('nativeMessaging') || native.applicationId !== 'app.freedirect.Freedirect') throw new Error('Expected native capabilities')
const commands = await send({ type: 'getCommands' })
if (!commands.available || !commands.commands.some(command => command.name === 'redirect-current')) throw new Error('Expected command diagnostics')

const rules = await send({ type: 'getRules' })
if (rules.enabledRulesets.includes('freedirect_static_defaults')) throw new Error('Expected disabled static ruleset in rule diagnostics')
if (!rules.dynamicRules.length) throw new Error('Expected rule preview data')
if (!rules.rulePreview?.some(rule => rule.serviceId === 'youtube' && rule.frontendName)) throw new Error('Expected attributed rule preview data')

const exported = await send({ type: 'exportState' })
if (exported.exported.format !== 'freedirect-state' || !exported.exported.exportedAt || !exported.exported.state) throw new Error('Expected backup envelope')
await send({ type: 'importState', state: exported.exported })
response = await send({ type: 'getState' })
if (response.state.schemaVersion !== exported.exported.schemaVersion) throw new Error('Expected backup envelope import')

await send({
  type: 'importState',
  state: {
    schemaVersion: 0,
    profile: 'not-real',
    services: {
      youtube: {
        enabled: true,
        frontend: 'not-real',
        instance: 'javascript:alert(1)',
        customInstances: ['https://safe.example/path', 'http://unsafe.example', 'not a url'],
        favoriteInstances: ['https://safe.example/again'],
        mode: 'invalid'
      },
      notAService: { enabled: true }
    },
    diagnostics: { bypassedUrls: ['https://example.com/a', 'not a url'], lastError: 'x'.repeat(600) }
  }
})
response = await send({ type: 'getState' })
if (response.state.schemaVersion !== 1) throw new Error('Expected migrated schema version')
if (response.state.profile !== 'balanced') throw new Error('Expected invalid profile to sanitize to balanced')
if (response.state.services.notAService) throw new Error('Expected unknown service to be dropped')
if (response.state.services.youtube.frontend !== 'invidious') throw new Error('Expected invalid frontend to sanitize to default')
if (response.state.services.youtube.instance !== 'https://inv.thepixora.com') throw new Error('Expected unsafe instance to sanitize to default')
if (response.state.services.youtube.mode !== 'selected') throw new Error('Expected invalid mode to sanitize')
if (response.state.services.youtube.customInstances.join(',') !== 'https://safe.example') throw new Error('Expected HTTPS custom instances only')
if (response.state.diagnostics.bypassedUrls.length !== 1) throw new Error('Expected diagnostics sanitation')
if (!response.state.diagnostics.migrations?.length) throw new Error('Expected migration record')

console.log(`extension smoke ok (${dynamicRules.length} rules)`)
