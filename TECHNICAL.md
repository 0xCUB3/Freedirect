# Freedirect technical notes

## Targets

- macOS 26+
- iOS 26+
- iPadOS 26+
- Safari Web Extension, Manifest V3
- Native app is only a Safari extension container/setup shell

## Architecture

- `Shared (Extension)/Resources/manifest.json` — MV3 extension manifest
- `Shared (Extension)/Resources/background.js` — service catalog, state migration, DNR rule generation, navigation fallbacks, context menus, commands
- `Shared (Extension)/Resources/content-script.js` — `document_start` fallback redirect path
- `Shared (Extension)/Resources/options.html` / `options.js` — extension-owned settings UI
- `Shared (Extension)/Resources/popup.html` / `popup.js` — toolbar popup
- `Shared (Extension)/Resources/static_rules.json` — static DNR bootstrap rules for high-impact services
- `Shared (Extension)/Resources/instances.json` — bundled public instance snapshot
- `Shared (App)/ViewController.swift` — minimal companion WebView setup screen

Settings are stored in `browser.storage.local` under `freedirectState`. The native app does not mirror or own redirect settings.

## Redirect pipeline

1. Static DNR rules cover selected high-impact defaults only during first-install bootstrap.
2. Dynamic DNR rules are generated from the configured service catalog; once initialized, the static ruleset is disabled so stale defaults cannot override custom instances.
3. `webNavigation.onBeforeNavigate` and `tabs.onUpdated` handle app-protocol redirects and Safari race cases.
4. `webNavigation.onErrorOccurred` retries redirectable failed main-frame navigations, useful when DNS blocking wins before Safari finishes extension handling.
5. `content-script.js` provides a last-resort `document_start` redirect path when a page can load.

App-protocol frontends such as FreeTube and Materialious use app URL schemes and are intentionally excluded from DNR generation.

## Build

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer ./scripts/verify.sh --build
```

Local Safari extension registration check:

```sh
./scripts/check-safari-extension-install.sh --open
```

Unsigned builds are not the intended path. Use Apple Development signing for local Safari testing.

## DMG

Manual DMG build:

```sh
VERSION=0.1.0 scripts/build-dmg.sh
```

The script builds the macOS target, optionally signs with `SIGNING_IDENTITY`, and writes:

```text
build/homebrew/Freedirect-${VERSION}.dmg
```

## Version state

- App/appex marketing version: `0.1.0`
- App/appex build: `1`
- Extension manifest version: `0.1.0`
