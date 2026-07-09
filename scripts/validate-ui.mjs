import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function makeElement(id, handlers) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    disabled: false,
    hidden: false,
    dataset: {},
    className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, callback) { handlers.set(`${id}:${type}`, callback) },
    setAttribute() {},
    removeAttribute() {},
    querySelectorAll() { return [] },
    querySelector() { return null },
    closest() { return null },
    showModal() {},
    close() {}
  }
}

function makeDocument(ids) {
  const handlers = new Map()
  const elements = Object.fromEntries(ids.map(id => [id, makeElement(id, handlers)]))
  return {
    handlers,
    elements,
    document: {
      getElementById(id) { return elements[id] ?? (elements[id] = makeElement(id, handlers)) },
      querySelectorAll() { return [] },
      querySelector() { return null }
    }
  }
}

function runtimeContext(document, messages, responses = {}) {
  const chrome = {
    i18n: { getMessage(key) { return key } },
    runtime: {
      lastError: null,
      getURL(path) { return path },
      openOptionsPage() {},
      sendMessage(payload, callback) {
        messages.push(payload)
        queueMicrotask(() => callback?.(responses[payload.type] ?? {}))
      }
    },
    tabs: { async create() {} }
  }
  return vm.createContext({
    chrome,
    console,
    document,
    URL,
    CSS: { escape(value) { return String(value) } },
    confirm() { return true },
    alert(message) { messages.push({ type: 'alert', message: String(message) }) },
    requestAnimationFrame(callback) { queueMicrotask(callback) },
    setTimeout,
    clearTimeout,
    queueMicrotask
  })
}

const optionIds = [...readFileSync('Shared (Extension)/Resources/options.html', 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
const optionsDom = makeDocument(optionIds)
const optionsMessages = []
const optionsContext = runtimeContext(optionsDom.document, optionsMessages, {
  getState: { error: 'state unavailable in UI smoke test' },
  syncStatus: { available: true, syncEnabled: false }
})
vm.runInContext(readFileSync('Shared (Extension)/Resources/options.js', 'utf8'), optionsContext, { filename: 'options.js' })

optionsDom.handlers.get('enableAll:click')({ currentTarget: optionsDom.elements.enableAll })
optionsDom.handlers.get('disableAll:click')({ currentTarget: optionsDom.elements.disableAll })
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(optionsMessages.filter(message => message.type === 'setAllServices').length, 2, 'bulk service buttons must send both mutations')

optionsDom.elements.backup.value = 'null'
await optionsDom.handlers.get('import:click')()
assert.equal(optionsMessages.some(message => message.type === 'importState'), false, 'invalid backup must not reach the background')
assert.equal(optionsMessages.some(message => message.type === 'alert' && message.message.includes('Backup must contain')), true, 'invalid backup must explain the failure')

const popupIds = [...readFileSync('Shared (Extension)/Resources/popup.html', 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
const popupDom = makeDocument(popupIds)
const popupMessages = []
const popupContext = runtimeContext(popupDom.document, popupMessages, {
  getState: { error: 'state unavailable in UI smoke test' },
  diagnoseCurrent: {},
  farsideCurrent: {}
})
vm.runInContext(readFileSync('Shared (Extension)/Resources/popup.js', 'utf8'), popupContext, { filename: 'popup.js' })
popupDom.elements.enabled.checked = true
await popupDom.handlers.get('enabled:change')({ target: popupDom.elements.enabled })
assert.equal(popupMessages.some(message => message.type === 'setGlobalEnabled' && message.enabled === true), true, 'popup toggle must send the requested state')

console.log('ui behavior ok')
