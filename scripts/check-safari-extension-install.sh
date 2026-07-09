#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
OPEN_APP=false
if [ "${1:-}" = "--open" ]; then
  OPEN_APP=true
fi

echo "Building macOS app..."
DERIVED_DATA="${TMPDIR:-/tmp}/Freedirect-DerivedData"
rm -rf "$DERIVED_DATA"
xcodebuild -project Freedirect.xcodeproj -scheme 'Freedirect (macOS)' -configuration Debug -derivedDataPath "$DERIVED_DATA" build >/tmp/freedirect-macos-build.log

APP="$DERIVED_DATA/Build/Products/Debug/Freedirect.app"
if [ ! -d "$APP" ]; then
  echo "FAIL: built Freedirect.app was not found at $APP"
  exit 1
fi

APPEX="$APP/Contents/PlugIns/Freedirect Extension.appex"
if [ ! -d "$APPEX" ]; then
  echo "FAIL: embedded Safari extension is missing: $APPEX"
  exit 1
fi

POINT="$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionPointIdentifier' "$APPEX/Contents/Info.plist")"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APPEX/Contents/Info.plist")"
MANIFEST="$APPEX/Contents/Resources/manifest.json"

if [ "$POINT" != "com.apple.Safari.web-extension" ]; then
  echo "FAIL: extension point is $POINT"
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "FAIL: manifest missing from embedded extension"
  exit 1
fi

if ! codesign -d --entitlements :- "$APPEX" 2>/dev/null | grep -q 'com.apple.security.app-sandbox'; then
  echo "FAIL: embedded extension is not signed with the app sandbox entitlement"
  echo "Safari may silently omit local web extensions without a valid signed/sandboxed appex."
  exit 1
fi

APP_TEAM="$(codesign -dv "$APP" 2>&1 | awk -F= '/TeamIdentifier/ { print $2; exit }')"
APPEX_TEAM="$(codesign -dv "$APPEX" 2>&1 | awk -F= '/TeamIdentifier/ { print $2; exit }')"
if [ -n "$APP_TEAM" ] && [ -n "$APPEX_TEAM" ] && [ "$APP_TEAM" != "$APPEX_TEAM" ]; then
  echo "FAIL: app and extension are signed by different teams ($APP_TEAM vs $APPEX_TEAM)"
  exit 1
fi

echo "App: $APP"
echo "Extension bundle id: $BUNDLE_ID"
echo "Extension point: $POINT"
echo "Manifest: $MANIFEST"
echo "Signing team: ${APPEX_TEAM:-not set}"

if [ "$OPEN_APP" = true ]; then
  echo "Opening containing app to trigger Safari extension registration..."
  open "$APP"
  sleep 2
fi

echo
if pluginkit -m -p com.apple.Safari.web-extension 2>/dev/null | grep -q "$BUNDLE_ID"; then
  echo "pluginkit: registered"
else
  echo "pluginkit: not registered yet"
  LS=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  if [ -x "$LS" ]; then
    echo "Refreshing LaunchServices registration..."
    "$LS" -f "$APP" || true
    sleep 1
    if pluginkit -m -p com.apple.Safari.web-extension 2>/dev/null | grep -q "$BUNDLE_ID"; then
      echo "pluginkit: registered after LaunchServices refresh"
    else
      echo "FAIL: pluginkit still does not list $BUNDLE_ID after LaunchServices refresh" >&2
      exit 1
    fi
  else
    echo "FAIL: LaunchServices registration tool is unavailable" >&2
    exit 1
  fi
fi

echo
cat <<'NOTE'
If the extension is not visible in Safari Settings > Extensions for this local debug build:
1. Build/run the Freedirect (macOS) scheme from Xcode so the signed containing app launches once.
2. Quit and reopen Safari Settings > Extensions.
3. If it still does not appear, restart Safari (or log out/in) so LaunchServices and pluginkit caches refresh.
4. Safari 26 fallback for extension-resource debugging: Safari Settings > Developer > Add Temporary Extension… and select Shared (Extension)/Resources.

Apple Development signed builds should not need Develop > Allow Unsigned Extensions.
This script does not change Safari security settings or enable SafariDriver.
NOTE
