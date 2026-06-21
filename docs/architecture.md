# Freedirect Architecture

## Shape

Freedirect is a native Apple-platform app plus a Safari Web Extension.

```text
iOS/macOS companion app
  - boilerplate WebView
  - opens Safari extension settings/preferences where public APIs allow

Safari Web Extension
  - Manifest V3
  - service-worker background script
  - dynamic Declarative Net Request redirect rules
  - popup and options pages
  - context menus and commands where Safari supports them
  - native messaging bridge
```

The Xcode project follows Apple's Safari Web Extension Packager structure:

- `iOS (App)`
- `macOS (App)`
- `iOS (Extension)`
- `macOS (Extension)`
- `Shared (App)`
- `Shared (Extension)`

## Redirect flow

1. Extension loads stored Freedirect state from `browser.storage.local`.
2. Background service worker generates DNR redirect rules from enabled services, selected frontends, and selected or daily-rotating instances.
3. Rules are installed with `browser.declarativeNetRequest.updateDynamicRules`.
4. Safari evaluates matching main-frame navigations declaratively.
5. Popup/options/context actions can trigger immediate redirect, reverse redirect, bypass, or rebuild.

## Why DNR instead of webRequestBlocking

Safari's supported privacy-preserving path for request blocking/modification/redirecting is Declarative Net Request. LibRedirect-style `webRequestBlocking` code cannot be assumed available in Safari, and DNR is also the API Apple documents and demonstrates for Safari 26-era extensions.

## Storage

Current implementation stores extension settings in `browser.storage.local` under `freedirectState`. State is versioned with `schemaVersion`; backup export uses a `freedirect-state` envelope with export timestamp, and imported/loaded state plus live settings patches are migrated against current defaults and sanitized so unknown services, invalid frontends, unsafe non-HTTPS instance URLs, and malformed diagnostics are dropped. The native app intentionally does not duplicate settings; the extension options page is the primary configuration UI.

Planned research/implementation:
- migration strategy for schema changes,
- optional sync behavior if Safari extension storage sync is available and appropriate.

## Native messaging

The extension can call the native `SafariWebExtensionHandler` with `browser.runtime.sendNativeMessage`. Freedirect exposes guarded `nativePing` and `nativeCapabilities` messages so the options page can verify the bridge without requiring App Group entitlements.

## Platform notes

- iOS/iPadOS and macOS are first-class targets; iOS app/extension build settings target device family `1,2` for iPhone and iPad.
- Safari permission UX differs by platform; docs and onboarding must stay platform-specific.
- macOS can open extension preferences with `SFSafariApplication.showPreferencesForExtension` and can send app-to-extension messages with `SFSafariApplication.dispatchMessage`.
- iOS/iPadOS 26.2+ can report extension enabled state through `SFSafariExtensionManager.getStateOfExtension`; earlier 26.x releases fall back to instruction-only guidance.
- iOS cannot send containing-app messages directly to Web Extension JavaScript; use extension UI/native messages initiated by JavaScript or researched app-group storage.
- Some commands/context menus may differ by Safari platform and must be manually tested.
