# Research Notes

Freedirect requires primary-source API research before each major Safari/WebKit-dependent feature. This file records implementation decisions and constraints.

## Safari redirect API decision

Sources:
- Apple, "Blocking content with your Safari web extension" — Safari implements Declarative Net Request (DNR), supports dynamic/session rules, and supports `redirect` with `declarativeNetRequestWithHostAccess` plus host permissions.
- Apple, WWDC26 "Create web extensions for Safari" — demonstrates dynamic `browser.declarativeNetRequest.updateDynamicRules`, redirect rules, host permission prompts, persistent storage, native messaging, iOS/iPadOS/macOS packaging, and TestFlight/App Store packaging.
- Apple, "Managing Safari web extension permissions" — Safari users grant and manage extension access per site; MV3 host patterns belong in `host_permissions`.
- WebKit Safari 26.0 feature notes — Safari Web Extension Packager supports packaging extension resources for macOS, iOS, iPadOS, and visionOS; SafariDriver can load extensions for automated testing.

Decision:
- Use a Safari Web Extension with Manifest V3 and a service-worker background script.
- Generate DNR dynamic redirect rules from user-selected service/frontend/instance state.
- Use `declarativeNetRequestWithHostAccess` and `<all_urls>` host permissions because a redirector cannot know every original and destination host ahead of time.
- Keep permission explanations in the extension options page and Safari Settings flow.

Known limitations / workarounds:
- Safari's documented DNR `RuleCondition` support does not list `tabIds`, so per-tab bypass is approximated with exact-URL session allow rules.
- DNR cannot run arbitrary rewrite JavaScript per network request, so complex rewrites must become deterministic templates or explicit action commands.
- Random instance selection cannot be truly per request through DNR alone; Freedirect uses selected or day-rotating instance choices and regenerates rules.
- Any unsupported LibRedirect behavior must be documented with evidence and replaced with the closest Safari-compatible behavior.

## Native app + extension packaging

Source:
- `xcrun safari-web-extension-converter --help` from Xcode beta documents `--ios-only`, `--macos-only`, `--copy-resources`, and shared iOS/macOS packaging generation.
- Generated Apple templates use separate iOS app, macOS app, iOS extension, and macOS extension targets with shared app/extension sources.
- Xcode beta iPhoneOS SafariServices headers expose `SFSafariExtensionManager.getStateOfExtension(withIdentifier:)` and `SFSafariExtensionState.isEnabled` as iOS/iPadOS/visionOS 26.2 APIs, while macOS continues to expose `getStateOfSafariExtension(withIdentifier:)`.
- iOS Safari extension settings deep links remain undocumented/fragile in public reports; avoid private `App-Prefs:` URL schemes for App Store-safe behavior.

Decision:
- Use the Safari Web Extension Packager output as the project base so the Xcode project has first-class iOS and macOS extension targets.
- Keep the template WebView companion app surface minimal; all redirect settings live in the Web Extension options page.
- Set deployment targets to iOS/macOS 26.0 to match the goal and current Safari 26 API research.
- Keep macOS app and appex sandbox entitlements explicit and build local macOS debug artifacts with signing enabled and the same Apple Development team; Safari/pluginkit can hide or reject web extensions that are rebuilt without a sealed sandboxed signature or with mismatched app/appex signing identities.
- Use macOS extension-state/preferences APIs where available; on iOS/iPadOS, use the researched 26.2 extension-state API behind availability checks and provide instructions instead of relying on private Settings deep links.

## Native messaging

Sources:
- Apple, "Messaging between the app and JavaScript in a Safari web extension" — messages can be sent from extension pages/background scripts to the app extension mediator.
- WWDC26 session transcript — native messaging path is JavaScript extension → app extension handler → native app/system APIs → response.

Decision:
- Include `nativeMessaging` permission and a Swift `SafariWebExtensionHandler`.
- Implement `ping` and `capabilities` responses now; reserve biometric protection and app-group-backed native settings for follow-up research and implementation.
- Use macOS `SFSafariApplication.dispatchMessage` for app-to-extension notifications such as "rebuild rules" where Safari supports it.
- Do not rely on app-to-extension dispatch for iOS: Apple documents that the containing iOS app cannot send messages directly to JavaScript, so iOS settings changes must use extension UI, native messaging initiated by JavaScript, or researched shared storage.

## Safari DNR bypass research

Sources:
- Apple, "Blocking content with your Safari web extension" — Safari supports DNR `allowAllRequests` only for `main_frame` and requires `declarativeNetRequestWithHostAccess` plus user site permission for redirect rules.
- MDN `declarativeNetRequest.RuleCondition` — `allowAllRequests` rules must specify resource types and are limited to `main_frame`/`sub_frame`.
- WebKit PRs/commits around `allowAllRequests` — Safari/WebKit has had implementation fixes specifically for main-frame `allowAllRequests` behavior.

Decision:
- Keep Freedirect's temporary bypass workaround as an exact-URL `sessionRules` `allowAllRequests` rule scoped to `main_frame`.
- Keep the workaround documented as limited because Safari does not document `tabIds` conditions, so exact URL session bypass is the closest viable platform-supported approximation.

## Safari commands research

Sources:
- MDN WebExtensions `commands` manifest docs — `suggested_key` can include platform-specific keys including `default`, `mac`, and `ios`.
- WebKit PR #21249 — WebKit added menu item and key-command support for WebExtension commands across macOS and iOS internals.
- WebKit PR #44341 — iOS-specific activation-key handling exists for WebExtension commands.
- Apple Safari extension compatibility docs — Safari generally ignores unsupported manifest keys, but unsupported API behavior must be checked and worked around.
- Apple "Running your Safari web extension" — Safari 26 can load a web extension folder temporarily from Safari Settings > Developer > Add Temporary Extension, but the containing-app route still requires running the app once and local signing/unsigned-extension allowances for debug builds.

Decision:
- Keep command declarations and iOS/macOS suggested keys in the Manifest V3 extension.
- Treat keyboard-command behavior as platform/runtime verified rather than guaranteed by static tests; `docs/testing.md` keeps manual macOS/iPadOS hardware checks.

## Safari native messaging research

Sources:
- Apple, "Messaging between the app and JavaScript in a Safari web extension" — JavaScript sends messages with `browser.runtime.sendNativeMessage("application.id", message, callback)`; Safari ignores the application-id value and routes to the containing app's native extension handler.
- Apple, "Messaging a Web Extension's Native App" sample — native app extension receives `SFExtensionMessageKey` in an `NSExtensionRequestHandling` handler and replies via an `NSExtensionItem`.
- MDN `runtime.sendNativeMessage()` — cross-browser form expects a native application name plus JSON payload and may be Promise-based.

Decision:
- Use the two-argument/callback-compatible Safari form with `app.freedirect.Freedirect` as the documented application id placeholder.
- Keep a guarded one-argument fallback for Safari/WebKit compatibility variations and existing mocks.
- Add a timeout and surfaced error reason so the options-page native bridge check does not hang when Safari native messaging is unavailable or misconfigured.

## WebExtension permission-state diagnostics research

Sources:
- Apple, "Managing Safari web extension permissions" — Safari users grant/manage site access, and iOS/macOS have different permission management surfaces.
- MDN `permissions.contains()` — checks whether an extension currently has requested API or origin permissions.
- WebKit permissions API implementation notes — Safari implements WebExtension permissions APIs against current granted permissions and match patterns.

Decision:
- Use `browser.permissions.contains({ origins: ['<all_urls>'] })` and active-tab origin checks where available to display actionable permission diagnostics.
- Keep broad permission requests behind user action (`Request site access`) and explain that redirects require source/destination host access.
- Treat permission APIs as optional/guarded because Safari version/platform support can vary.

## WebExtension localization research

Sources:
- MDN WebExtensions internationalization docs — `_locales/<locale>/messages.json`, `default_locale`, `__MSG_key__` manifest substitution, and `browser.i18n.getMessage` are the standard WebExtension localization model.
- Apple Safari compatibility documentation — Safari Web Extensions support common WebExtension APIs and both `browser.*`/`chrome.*` namespaces, but compatibility should be checked for planned APIs.
- Safari-specific compatibility reports note that generated/tooling wrappers may trip over `browser.i18n.getMessage`; Freedirect uses a direct `browser ?? chrome` namespace and fallback strings to avoid blank UI.
- Safari and Chromium-family WebExtension builds differ between Promise and callback-style runtime messaging in edge cases. Freedirect's popup/options message wrapper accepts either style and shows a timeout/error instead of staying in a loading state.

Decision:
- Add `_locales/en/messages.json`, `default_locale`, and localized manifest strings now.
- Use `api.i18n?.getMessage(key) || key` fallbacks in popup/options pages so a Safari i18n failure degrades to visible keys rather than blank controls.
- Keep native companion copy minimal; Web Extension localization remains the primary localization surface.

## Service parity expansion research

Sources:
- LibRedirect public manifest/config was inspected for behavioral discovery only: service group names, frontend names, and the breadth of parity expected.
- Public frontend project/domain conventions were used to seed first-pass instance candidates; no LibRedirect implementation code was copied.
- Safari DNR research above constrains service support to deterministic regex substitution rules unless a command/action performs an explicit JavaScript rewrite.

Decision:
- Catalog all 52 reference service groups so users can see and configure the full parity surface early.
- Mark 11 common services as high-confidence bespoke templates.
- Use conservative path-preserving templates for the remaining groups until each is verified against real URLs and frontend route behavior.
- Keep unverified templates disabled by default through the Balanced profile; Strict opts into the whole catalog for testers.

## Profiles and instance health research

Sources:
- WebKit PR "Add support for the alarms Web Extension API" — Safari has been adding WebExtension scheduling support, but periodic background work must still be treated carefully because extension backgrounds are non-persistent.
- Apple Developer Forum / Stack Overflow reports on Safari extension background timers and CORS — background timers can be throttled/stopped, and extension page/background fetch access depends on host permissions and Safari CORS behavior.
- Apple, "Managing Safari web extension permissions" — host access must be granted by the user and should be minimized; broad redirect/health features need clear user-facing permission explanation.

Decision:
- Implement health checks as explicit user-triggered checks from the options page rather than unbounded background polling.
- Store per-instance health results in extension local state next to service settings.
- Ship a clearnet public-instance snapshot derived from the LibRedirect instances repository for broad default choice coverage, and let users refresh that data from the extension settings page.
- Treat health checks as advisory: CORS, permission denial, captive networks, and instance-specific blocking can all produce false negatives.
- Add profiles/presets as local configuration transforms that regenerate DNR rules immediately.

## SafariDriver testing research

Sources:
- WebKit Safari 26.0 feature notes — SafariDriver can load Web Extensions for automated testing.
- Selenium 4.40+ Safari WebDriver documentation — exposes `driver.webextension.install(path=...)` for WebExtension install/uninstall flows.
- Apple `safaridriver --help` — automation requires user-enabled SafariDriver configuration via `safaridriver --enable`.

Decision:
- Add an optional SafariDriver smoke script that skips when local prerequisites are missing instead of mutating user security settings.
- Keep deterministic unit/smoke tests in Node for CI-like verification, and use SafariDriver for local runtime checks after explicit user setup.

## Storage and migration research

Sources:
- WWDC26 "Create web extensions for Safari" — uses the WebExtension storage API for durable extension settings.
- WebKit storage policy notes and Safari extension storage reports — storage is finite and platform-managed, so exported state should stay compact and schema-versioned.

Decision:
- Store only compact service configuration, diagnostics, health snapshots, and migration history in `browser.storage.local`.
- Version state with `schemaVersion` and merge imported/older state into current defaults.
- Keep exported backups human-readable JSON for now; avoid large embedded caches that could hit iOS storage quotas.

## Shared native settings research

Sources:
- Apple, "Messaging between the app and JavaScript in a Safari web extension" — states app groups share data between the containing app and the native app extension, while messaging connects JavaScript and native code.
- Apple, "Configuring app groups" — app groups provide shared containers between app targets from the same team.
- Apple Developer Forums discussion on Safari Web Extensions and XPC — XPC services are not a shared bridge visible to both containing app and extension in the desired way; app groups/UserDefaults are the practical path for shared settings.

Decision:
- Keep current extension-owned redirect state in `browser.storage.local` until App Group entitlement details are configured.
- Add native UI and native-message hooks now, but avoid adding placeholder app-group entitlements that would require a paid team/account decision.
- Do not duplicate settings natively unless a future platform requirement appears; keep extension UI as the settings source of truth.
