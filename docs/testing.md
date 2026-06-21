# Testing Notes

## Automated checks performed

```bash
./scripts/verify.sh
node scripts/smoke-extension.mjs
node scripts/validate-catalog.mjs
python3 -m py_compile scripts/safaridriver-extension-smoke.py
./scripts/check-safari-extension-install.sh # checks embedded macOS appex and pluginkit visibility
./scripts/check-safari-extension-install.sh --open # also opens the containing app to trigger local registration
./scripts/safaridriver-extension-smoke.py # optional; skips when Selenium/SafariDriver is not configured
./scripts/safaridriver-extension-smoke.py --redirect-service youtube # optional after manual Safari site-access grants
./scripts/safaridriver-extension-smoke.py --redirect-defaults # optional balanced-profile redirect checks after manual grants
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild -project Freedirect.xcodeproj -scheme 'Freedirect (macOS)' -configuration Debug CODE_SIGNING_ALLOWED=NO build
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild -project Freedirect.xcodeproj -scheme 'Freedirect (iOS)' -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Current result: mocked extension smoke test passes, catalog validation passes for all 52 service groups and 61 strict-profile DNR rules, all service groups have at least one redirect sample asserted, high-confidence exact redirect samples are asserted, generated service matrix and generated manual service test case checklist cover 52 groups, and macOS and iOS simulator builds succeed with Xcode beta and iOS/macOS 26.0 deployment targets.

## Manual Safari checks still required

These behaviors depend on Safari runtime permissions and must be verified in real Safari sessions:

1. Enable the macOS Safari extension from Safari Settings > Extensions.
2. Enable the iOS/iPadOS extension from Settings > Safari > Extensions.
3. Confirm the popup loads and shows generated dynamic rule count, site access state, and current-page redirect/reverse diagnosis.
4. Confirm the options page can toggle services, select frontends, export/import JSON, and rebuild rules.
5. Grant site access and test representative redirects; use `docs/service-test-cases.md` for the full 52-service checklist with generated expected redirect URLs. Start with:
   - `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
   - `https://www.reddit.com/r/privacy/`
   - `https://x.com/`
6. Test context actions: Redirect, Open original, Bypass this URL.
7. Test keyboard commands on macOS and iPadOS hardware where supported.
8. Test VoiceOver/keyboard focus through popup and options controls, including live diagnostic updates.
9. Inspect Safari/Web Extension console for DNR or permission errors.

## macOS extension visibility

If Freedirect does not appear in Safari Settings > Extensions for a local debug build, run:

```bash
./scripts/check-safari-extension-install.sh --open
```

The script verifies that the built macOS app embeds `Freedirect Extension.appex`, that the appex uses `com.apple.Safari.web-extension`, that the manifest is present, that the appex is signed with the sandbox entitlement, that app/appex signing teams match, and whether `pluginkit` reports the extension. Apple Development signed builds should be built/run directly from Xcode and should not need Develop > Allow Unsigned Extensions. Redirects also require website access; use the popup's Request access button or Safari Settings > Extensions > Freedirect website access. Avoid rebuilding the macOS app with `CODE_SIGNING_ALLOWED=NO`; Safari/pluginkit can briefly show and then hide an unsealed or unsandboxed appex. If the containing-app route remains stale, Safari 26's Developer tab can load `Shared (Extension)/Resources` via Add Temporary Extension for resource-level debugging. The script prints guidance but does not mutate Safari security settings.

## SafariDriver automation

`scripts/safaridriver-extension-smoke.py` is an optional Selenium/SafariDriver smoke test for loading the unpacked extension and opening a known page. It intentionally skips when Selenium is absent or SafariDriver is not enabled because `safaridriver --enable` is a user-approved local security setting.

After manually granting Safari site access, pass `--redirect-service <id>` to assert a real DNR redirect against the generated expected URL in `docs/service-test-cases.md`, or `--redirect-defaults` to check the balanced-profile defaults. This remains a manual/CI-hybrid check because Safari permission prompts are user-controlled and should not be bypassed by automation.
