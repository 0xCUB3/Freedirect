#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${ROOT_DIR}/Freedirect.xcodeproj"
SCHEME="Freedirect (macOS)"
CONFIGURATION="Release"

OUT_DIR="${ROOT_DIR}/build/homebrew"
DERIVED_DATA="${OUT_DIR}/DerivedData"
APP_PATH="${DERIVED_DATA}/Build/Products/${CONFIGURATION}/Freedirect.app"

SIGNING_IDENTITY="${SIGNING_IDENTITY:-}"
VERSION="${VERSION:-}"
TEAM_ID="${TEAM_ID:-DNP7DGUB7B}"
if [[ -n "${VERSION}" ]]; then
  DMG_NAME="Freedirect-${VERSION}.dmg"
else
  DMG_NAME="Freedirect.dmg"
fi
DMG_PATH="${OUT_DIR}/${DMG_NAME}"

mkdir -p "${OUT_DIR}"
rm -f "${DMG_PATH}"
rm -rf "${DERIVED_DATA}"

echo "Building ${SCHEME} (${CONFIGURATION})…"
if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode-beta.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
fi
xcodebuild \
  -project "${PROJECT_PATH}" \
  -scheme "${SCHEME}" \
  -configuration "${CONFIGURATION}" \
  -destination "generic/platform=macOS" \
  -derivedDataPath "${DERIVED_DATA}" \
  "CODE_SIGNING_ALLOWED=NO" \
  "ARCHS=arm64 x86_64" \
  build

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Expected app not found at: ${APP_PATH}" >&2
  exit 1
fi

xattr -cr "${APP_PATH}" || true

if [[ -n "${SIGNING_IDENTITY}" ]]; then
  echo "Signing app for distribution…"

  APP_ENTITLEMENTS="$(mktemp)"
  EXT_ENTITLEMENTS="$(mktemp)"
  cat > "${APP_ENTITLEMENTS}" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <true/>
</dict>
</plist>
PLIST
  cp "${APP_ENTITLEMENTS}" "${EXT_ENTITLEMENTS}"

  sign_item() {
    local item_path="$1"
    local entitlements_path="${2:-}"
    if [[ -n "${entitlements_path}" ]]; then
      codesign --force --options runtime --timestamp \
        --sign "${SIGNING_IDENTITY}" \
        --entitlements "${entitlements_path}" \
        "${item_path}"
    else
      codesign --force --options runtime --timestamp \
        --sign "${SIGNING_IDENTITY}" \
        "${item_path}"
    fi
  }

  if [[ -d "${APP_PATH}/Contents/PlugIns" ]]; then
    while IFS= read -r -d '' appex; do
      if [[ -d "${appex}/Contents/Frameworks" ]]; then
        while IFS= read -r -d '' nested; do
          sign_item "${nested}"
        done < <(find "${appex}/Contents/Frameworks" -maxdepth 1 \( -name "*.framework" -o -name "*.dylib" \) -print0)
      fi
      sign_item "${appex}" "${EXT_ENTITLEMENTS}"
    done < <(find "${APP_PATH}/Contents/PlugIns" -maxdepth 1 -name "*.appex" -print0)
  fi

  if [[ -d "${APP_PATH}/Contents/Frameworks" ]]; then
    while IFS= read -r -d '' framework; do
      sign_item "${framework}"
    done < <(find "${APP_PATH}/Contents/Frameworks" -maxdepth 1 \( -name "*.framework" -o -name "*.dylib" \) -print0)
  fi

  sign_item "${APP_PATH}" "${APP_ENTITLEMENTS}"
  rm -f "${APP_ENTITLEMENTS}" "${EXT_ENTITLEMENTS}"

  echo "Verifying code signature…"
  codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
fi

STAGING_DIR="${OUT_DIR}/dmg-root"
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"
cp -R "${APP_PATH}" "${STAGING_DIR}/"
ln -s /Applications "${STAGING_DIR}/Applications"

hdiutil create \
  -volname "Freedirect" \
  -srcfolder "${STAGING_DIR}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}" >/dev/null

rm -rf "${STAGING_DIR}"
echo "Created: ${DMG_PATH}"
