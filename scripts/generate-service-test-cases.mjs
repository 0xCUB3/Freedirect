import { readFileSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'

const listeners = {}
function event(name) { return { addListener(callback) { listeners[name] = callback } } }

const browser = {
  storage: { local: { async get() { return {} }, async set() {} }, onChanged: event('storage.onChanged') },
  declarativeNetRequest: { async getDynamicRules() { return [] }, async updateDynamicRules() {}, async getSessionRules() { return [] }, async updateSessionRules() {} },
  runtime: { onInstalled: event('runtime.onInstalled'), onStartup: event('runtime.onStartup'), onMessage: event('runtime.onMessage'), onMessageExternal: event('runtime.onMessageExternal'), openOptionsPage() {}, async sendNativeMessage() { return { ok: true } } },
  contextMenus: { async removeAll() {}, create() {}, onClicked: event('contextMenus.onClicked') },
  commands: { onCommand: event('commands.onCommand') },
  tabs: { async query() { return [] }, async update() {}, async create() {}, async reload() {} },
  permissions: { async request() { return true }, async contains() { return true } }
}

const context = vm.createContext({ browser, chrome: browser, console, URL, Date, RegExp, performance, setTimeout, clearTimeout, AbortController, fetch: async () => ({ ok: true }) })
vm.runInContext(readFileSync('Shared (Extension)/Resources/background.js', 'utf8'), context)
const catalog = vm.runInContext('SERVICE_CATALOG', context)
const samples = JSON.parse(readFileSync('scripts/service-test-cases.json', 'utf8'))

const missing = Object.keys(catalog).filter(id => !samples[id])
const extra = Object.keys(samples).filter(id => !catalog[id])
if (missing.length || extra.length) throw new Error(`service test case mismatch; missing=${missing.join(',')} extra=${extra.join(',')}`)

context.samples = samples
const expectedRedirects = vm.runInContext(`(() => {
  const state = defaultState()
  applyProfile(state, 'strict')
  return Object.fromEntries(Object.entries(samples).map(([id, url]) => [id, applyTemplateRedirect(url, state)]))
})()`, context)

const rows = Object.entries(catalog).map(([id, service]) => {
  const expected = expectedRedirects[id]
  if (!expected) throw new Error(`missing expected redirect for ${id}`)
  return `| ${id} | ${service.name} | \`${samples[id]}\` | \`${expected}\` | | |`
})
const content = `# Manual Service Test Cases

Generated from \`scripts/service-test-cases.json\` and \`Shared (Extension)/Resources/background.js\`. Use this for Safari runtime verification after granting site access. The expected URL is generated from the current strict-profile rule templates; fill the last columns manually during macOS/iOS Safari testing.

| ID | Service | Sample URL | Expected redirected URL | macOS Safari result | iOS/iPadOS Safari result |
|---|---|---|---|---|---|
${rows.join('\n')}

Total service groups: ${rows.length}
`
writeFileSync('docs/service-test-cases.md', content)
console.log(`wrote docs/service-test-cases.md (${rows.length} services)`)
