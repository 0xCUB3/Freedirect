import { readFileSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'

const listeners = {}
function event(name) { return { addListener(callback) { listeners[name] = callback } } }

const browser = {
  storage: { local: { async get() { return {} }, async set() {} }, onChanged: event('storage.onChanged') },
  declarativeNetRequest: { async getDynamicRules() { return [] }, async updateDynamicRules() {}, async getSessionRules() { return [] } },
  runtime: { onInstalled: event('runtime.onInstalled'), onStartup: event('runtime.onStartup'), onMessage: event('runtime.onMessage'), onMessageExternal: event('runtime.onMessageExternal'), openOptionsPage() {} },
  contextMenus: { async removeAll() {}, create() {}, onClicked: event('contextMenus.onClicked') },
  commands: { onCommand: event('commands.onCommand') },
  tabs: { async query() { return [] }, async update() {}, async create() {}, async reload() {} },
  permissions: { async request() { return true } }
}

const context = vm.createContext({ browser, chrome: browser, console, URL, Date, RegExp, performance, setTimeout, clearTimeout, AbortController, fetch })
vm.runInContext(readFileSync('Shared (Extension)/Resources/background.js', 'utf8'), context)
const catalog = vm.runInContext('SERVICE_CATALOG', context)

const rows = Object.entries(catalog).map(([id, service]) => {
  const frontendNames = Object.values(service.frontends).map(frontend => frontend.name).join(', ')
  const hosts = service.originalHosts.join(', ')
  const confidence = service.confidence === 'high' ? 'High-confidence bespoke' : 'Starter template; needs verification'
  return `| ${id} | ${service.name} | ${frontendNames} | ${hosts} | ${confidence} |`
})

const content = `# Service Matrix\n\nGenerated from \`Shared (Extension)/Resources/background.js\`. Use this as the granular parity checklist; do not edit rows manually without updating the catalog.\n\n| ID | Service | Frontends | Original hosts | Parity status |\n|---|---|---|---|---|\n${rows.join('\n')}\n\nTotal service groups: ${rows.length}\n`
writeFileSync('docs/service-matrix.md', content)
console.log(`wrote docs/service-matrix.md (${rows.length} services)`)
