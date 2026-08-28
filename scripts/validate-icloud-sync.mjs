import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const background = readFileSync('Shared (Extension)/Resources/background.js', 'utf8')
const start = background.indexOf('function stableStringify')
const end = background.indexOf('\nfunction mergePublicInstanceData', start)
assert.notEqual(start, -1, 'sync implementation start must exist')
assert.notEqual(end, -1, 'sync implementation end must exist')
const syncSource = background.slice(start, end)

function makeHarness({ state = { schemaVersion: 1, value: 'local' }, meta = {}, native } = {}) {
  const storage = {
    freedirectState: structuredClone(state),
    freedirectSyncMeta: {
      syncEnabled: true,
      localDirtyAt: null,
      localHash: null,
      cloudUpdatedAt: null,
      cloudOrigin: null,
      cloudHash: null,
      lastSyncAt: null,
      lastSyncError: null,
      deviceId: 'device-local',
      pendingConflict: null,
      ...structuredClone(meta)
    }
  }
  const nativeCalls = []
  const timers = []
  const context = vm.createContext({
    console,
    structuredClone,
    crypto: { randomUUID: () => 'device-generated' },
    setTimeout(callback) { timers.push(callback); return timers.length },
    clearTimeout() {},
    async storageGet(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])])) },
    async storageSet(values) { Object.assign(storage, structuredClone(values)) },
    migrateState(value) { return structuredClone(value) },
    sanitizeSyncError(value) { return String(value).slice(0, 500) },
    async rebuildRules() {},
    async sendNativeMessage(message) {
      nativeCalls.push(structuredClone(message))
      return native ? await native(message, nativeCalls.length) : { ok: true, available: true }
    }
  })

  vm.runInContext(`
    const SYNC_PUSH_DEBOUNCE_MS = 600
    let syncPushTimer = null
    let suppressLocalDirty = false
    let syncMetaCache = null
    let syncOperationQueue = Promise.resolve()
    let stateWriteQueue = Promise.resolve()

    async function getState() {
      const stored = await storageGet(['freedirectState'])
      return migrateState(stored.freedirectState)
    }
    async function saveState(state) {
      await storageSet({ freedirectState: state })
      await markLocalDirty()
    }
    function withStateWrite(mutator) {
      const run = stateWriteQueue.catch(() => null).then(async () => {
        const state = await getState()
        const result = await mutator(state)
        await saveState(state)
        return result
      })
      stateWriteQueue = run.then(() => null, () => null)
      return run
    }
    ${syncSource}
    globalThis.syncTest = {
      stateHash,
      payloadHash,
      syncPush,
      syncPull,
      setSyncEnabled,
      syncResolve,
      removeSyncCloud,
      getSyncMeta,
      withStateWrite
    }
  `, context, { filename: 'background-sync.js' })

  return { api: context.syncTest, storage, nativeCalls, timers }
}

{
  const harness = makeHarness()
  const cloudState = { schemaVersion: 1, value: 'cloud' }
  assert.equal(
    harness.api.payloadHash({ contentHash: 'forged-hash', state: cloudState }),
    harness.api.stateHash(cloudState),
    'cloud content hashes must be computed from the payload instead of trusted metadata'
  )
}

{
  const conflict = { cloudUpdatedAt: '2026-07-14T00:00:00.000Z', cloudOrigin: 'remote' }
  const harness = makeHarness({ meta: { pendingConflict: conflict } })
  await assert.rejects(harness.api.syncResolve('invalid'), /Unknown direction/)
  assert.deepEqual(harness.storage.freedirectSyncMeta.pendingConflict, conflict, 'invalid conflict choices must not clear the conflict')
}

{
  const conflict = { cloudUpdatedAt: '2026-07-14T00:00:00.000Z', cloudOrigin: 'remote' }
  const harness = makeHarness({
    meta: { pendingConflict: conflict },
    native: async message => message.type === 'syncPut'
      ? { ok: false, available: true, error: 'temporary failure' }
      : { ok: true, available: true }
  })
  const result = await harness.api.syncResolve('local')
  assert.equal(result.ok, false)
  assert.deepEqual(harness.storage.freedirectSyncMeta.pendingConflict, conflict, 'failed local conflict resolution must remain retryable')
}

{
  const conflict = { cloudUpdatedAt: '2026-07-14T00:00:00.000Z', cloudOrigin: 'remote' }
  const harness = makeHarness({
    meta: { pendingConflict: conflict, cloudUpdatedAt: conflict.cloudUpdatedAt, cloudOrigin: conflict.cloudOrigin },
    native: async message => message.type === 'syncRemove'
      ? { ok: false, available: true, error: 'remove failed' }
      : { ok: true, available: true }
  })
  await assert.rejects(harness.api.removeSyncCloud(), /remove failed/)
  assert.deepEqual(harness.storage.freedirectSyncMeta.pendingConflict, conflict, 'failed cloud removal must preserve sync metadata')
  assert.equal(harness.storage.freedirectSyncMeta.cloudUpdatedAt, conflict.cloudUpdatedAt)
}

{
  let releaseRead
  const cloudRead = new Promise(resolve => { releaseRead = resolve })
  const originalState = { schemaVersion: 1, value: 'original' }
  const harness = makeHarness({
    state: originalState,
    meta: { syncEnabled: false },
    native: async message => {
      if (message.type !== 'syncGet') return { ok: true, available: true }
      await cloudRead
      return {
        ok: true,
        available: true,
        cloudUpdatedAt: '2026-07-14T00:00:00.000Z',
        cloudOrigin: 'remote',
        payload: { updatedAt: '2026-07-14T00:00:00.000Z', originDevice: 'remote', state: originalState }
      }
    }
  })
  const enabling = harness.api.setSyncEnabled(true)
  await new Promise(resolve => setImmediate(resolve))
  await harness.api.withStateWrite(state => { state.value = 'edited-during-enable' })
  releaseRead()
  await enabling
  assert.equal(harness.storage.freedirectState.value, 'edited-during-enable')
  assert.ok(harness.storage.freedirectSyncMeta.localDirtyAt, 'an edit made during enablement must stay dirty')
  assert.ok(harness.storage.freedirectSyncMeta.pendingConflict, 'an edit made during enablement must not be mistaken for cloud-equivalent content')
}

{
  let releaseFirst
  const firstWrite = new Promise(resolve => { releaseFirst = resolve })
  const harness = makeHarness({
    native: async (message, callNumber) => {
      if (message.type !== 'syncPut') return { ok: true, available: true }
      if (callNumber === 1) await firstWrite
      return { ok: true, available: true, written: true, cloudUpdatedAt: message.payload.updatedAt }
    }
  })
  const first = harness.api.syncPush({ force: true })
  await new Promise(resolve => setImmediate(resolve))
  const second = harness.api.syncPush({ force: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.nativeCalls.length, 1, 'a second sync mutation must wait for the first operation')
  releaseFirst()
  await Promise.all([first, second])
  assert.equal(harness.nativeCalls.length, 2)
}

console.log('iCloud sync behavior ok')
