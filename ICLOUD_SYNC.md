# iCloud sync design

Sync Freedirect settings (the `freedirectState` blob) across the user's macOS and iOS devices through iCloud, using `NSUbiquitousKeyValueStore` as the cloud transport and the existing Safari native-messaging channel as the bridge.

## Why not the obvious approaches

- **`browser.storage.sync`** — exposes the API shape in Safari but Apple never wired it to iCloud. No sync happens. (Safari 15 also had a bug that merged sync/local storage and silently wiped prefs; see Jeff Johnson / StopTheMadness writeup.) Dead end here.
- **Apple's "Syncing Safari web extensions across devices"** — only syncs the extension's *installed/enabled* state. Doesn't touch extension storage. Worth turning on anyway (free, no code) but it does not solve settings sync.

## Source of truth

Stays in `browser.storage.local` under `freedirectState`. Sync is an **overlay/mirror**, not a relocation of source of truth. This keeps the diff minimal and avoids rewriting every storage call site in `background.js`.

Cloud transport writes the same envelope the `exportState` path already produces:

```json
{
  "format": "freedirect-state",
  "schemaVersion": <int>,
  "updatedAt": <iso8601>,
  "originDevice": <string>,
  "state": { ...freedirectState... }
}
```

## Transport

`NSUbiquitousKeyValueStore.default`, keyed by a fixed cloud key. The appex (not the container app) talks to it directly. Extensions can use the KV store as long as the `com.apple.developer.ubiquity-kvstore-identifier` entitlement is on the appex target. No App Group needed — the KV store is keyed by entitlement, not by shared container.

KV store cap is 1MB; our envelope is well under. Latency is seconds to minutes cross-device, controlled entirely by iCloud; we don't try to beat it.

The macOS and iOS appexes must declare the **same** KV identifier so both read/write one logical store:

```
com.apple.developer.ubiquity-kvstore-identifier = $(AppIdentifierPrefix)app.freedirect.cloud
```

`$(AppIdentifierPrefix)` resolves to `<TeamID>.` at sign time, making it a stable, shared identifier across both apps on one account.

## Native messaging schema

Extension → native via `browser.runtime.sendNativeMessage(NATIVE_APP_ID, …)`. The existing `SafariWebExtensionHandler` already handles `ping`/`capabilities`; we add:

| `type`     | Request body                                       | Response                                                                                          |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `syncGet`  | `{}`                                               | `{ ok, available, payload: <envelope\|null>, cloudUpdatedAt, cloudOrigin: <string\|null> }`       |
| `syncPut`  | `{ payload: <envelope>, updatedAt }`               | `{ ok, available, written: bool, cloudUpdatedAt }`                                               |
| `syncRemove` | `{}`                                            | `{ ok, available, removed: bool }`                                                               |

`available: false` means iCloud KV store is unreachable (no entitlement, no account, quota). The JS layer treats that as "sync disabled, local-only" rather than an error to surface loudly.

The `capabilities` response gains `icloudSync: true`.

## JS sync state machine (background.js)

New storage key: `freedirectSyncMeta`

```json
{
  "syncEnabled": true,
  "localUpdatedAt": <iso8601|null>,
  "cloudUpdatedAt": <iso8601|null>,
  "cloudOrigin": <string|null>,
  "lastSyncAt": <iso8601|null>,
  "lastSyncError": <string|null>,
  "deviceId": "<random uuid, persisted>"
}
```

Now `saveState()` bumps `localUpdatedAt` before writing to `storage.local`.

### Events

1. **Push** — `saveState` → debounced (`SYNC_PUSH_DEBOUNCE_MS = 500`) `syncPush()`:
   read `localUpdatedAt`; if equal to `cloudUpdatedAt`, skip (already mirrored); otherwise call native `syncPut` with the current state envelope. On success set `cloudUpdatedAt = localUpdatedAt`, `lastSyncAt = now`, clear `lastSyncError`. On failure record `lastSyncError`, schedule retry.
2. **Pull on wake** — `onStartup`, `onInstalled`, and when options page opens: `syncPull()`:
   native `syncGet`; compare `cloudUpdatedAt` vs `localUpdatedAt`.
   - `cloudUpdatedAt > localUpdatedAt` → `importState(cloud.state)` (reuses existing merge/migrate + rule rebuild), set `localUpdatedAt = cloudUpdatedAt` (no push).
   - `cloudUpdatedAt < localUpdatedAt` → `syncPush()` (local is ahead of cloud; push).
   - equal → nothing.
   - `cloudUpdatedAt == null` (empty cloud, local non-empty) → push.
   - `localUpdatedAt == null && cloudUpdatedAt != null` (fresh install pulling existing cloud) → import, then push a new envelope to claim ownership.
3. **Periodic poll** — `chrome.alarms` (MV3-safe), every `SYNC_POLL_INTERVAL_MIN = 5` minutes: `syncPull()`. Cheap and handles cross-device pushes we can't be notified of directly.
4. **Settings enable/disable** — toggling `syncEnabled`:
   - enable → pull, then push.
   - disable → stop pushing/pulling; leave cloud copy intact (offer a separate "Remove cloud copy" button).

### Conflict resolution

Last-write-wins by `updatedAt` (wall clock, UTC ISO 8601). Cross-device divergence case: A and B both edit offline. Whichever's `updatedAt` is later at first post-edit sync wins. The device whose state lost is overwritten on next pull. This is acceptable for v1 given Freedirect settings are small, infrequently changed, and the project already has JSON import/export for manual recovery.

`deviceId` (a persisted random UUID) is included in envelopes to disambiguate "I wrote this" from "another device did" — used only for diagnostics, not for merge decisions.

## Settings UI

New "Sync" section in `options.html`:

- Toggle: "Sync settings across devices (iCloud)".
- Status line (aria-live): "Last synced <time>" / "Sync disabled" / "Cloud copy: <updated at>" / last error.
- Button: "Remove cloud copy" (clears the cloud KV entry; requires confirmation).

## Entitlements / project config

1. Both appex targets get `com.apple.developer.ubiquity-kvstore-identifier`.
2. Both container apps get the same (for future parity; not strictly required for appex-only sync).
3. iOS app/appex need entitlements files (currently only macOS targets have them) and `CODE_SIGN_ENTITLEMENTS` build settings.
4. Info.plist `SFSafariCorresponding[IOS|MacOS]BundleIdentifier` on both apps and `SFSafariCorresponding[IOS|MacOS]ExtensionBundleIdentifier` on both appexes — opts into Apple's free extension-enabled-state cross-device sync.

## Manifest

Add `alarms` permission to `manifest.json`.

## Failure modes / non-goals

- No real-time push from native → extension; the iOS appex can't reliably hold a long-lived observer while suspended. Periodic pull + push on every change is the realistic model.
- Cloud write quota / KV store conflict: handled by last-write-wins; the cloud always reflects whichever device last did `syncPut`.
- No account (signed out of iCloud): `NSUbiquitousKeyValueStore` writes succeed locally but don't propagate. UI shows "local only / no iCloud account" when `available: false`.
- Does not sync `freedirectPublicInstances` cache (regenerable) or `freedirectSyncMeta` itself.