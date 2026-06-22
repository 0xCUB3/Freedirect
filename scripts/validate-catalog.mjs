import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const listeners = {}
function event(name) { return { addListener(callback) { listeners[name] = callback } } }

const browser = {
  storage: { local: { async get() { return {} }, async set() {} }, onChanged: event('storage.onChanged') },
  declarativeNetRequest: { async getDynamicRules() { return [] }, async updateDynamicRules() {}, async getSessionRules() { return [] }, async updateSessionRules() {} },
  runtime: { onInstalled: event('runtime.onInstalled'), onStartup: event('runtime.onStartup'), onMessage: event('runtime.onMessage'), onMessageExternal: event('runtime.onMessageExternal'), openOptionsPage() {}, async sendNativeMessage() { return { ok: true } } },
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
  }

  for (const [index, rule] of (service.rules ?? []).entries()) {
    try { new RegExp(rule.source) } catch (error) { errors.push(`${serviceId} rule ${index}: invalid regex ${error.message}`) }
    if (typeof rule.path !== 'string' || !rule.path.startsWith('/')) errors.push(`${serviceId} rule ${index}: invalid path ${rule.path}`)
  }
}

const extraSamples = Object.keys(samples).filter(serviceId => !catalog[serviceId])
for (const serviceId of extraSamples) errors.push(`${serviceId}: sample has no catalog service`)

const strictRules = vm.runInContext(`(() => { const state = defaultState(); applyProfile(state, 'strict'); return makeRules(state); })()`, context)
if (!strictRules.length) errors.push('strict profile generated no rules')
if (strictRules.length > 5000) errors.push(`strict profile generated too many rules: ${strictRules.length}`)
const ruleIds = new Set()
for (const rule of strictRules) {
  if (ruleIds.has(rule.id)) errors.push(`duplicate DNR rule id ${rule.id}`)
  ruleIds.add(rule.id)
  if (rule.action?.type !== 'redirect') errors.push(`rule ${rule.id}: expected redirect action`)
  if (!rule.condition?.regexFilter) errors.push(`rule ${rule.id}: missing regexFilter`)
}

if (errors.length) {
  console.error(errors.map(error => `catalog validation: ${error}`).join('\n'))
  process.exit(1)
}

console.log(`catalog validation ok (${ids.length} services, ${strictRules.length} strict rules)`)
