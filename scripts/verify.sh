#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import json
from pathlib import Path
manifest = json.loads(Path('Shared (Extension)/Resources/manifest.json').read_text())
assert manifest['manifest_version'] == 3
assert manifest['background'].get('service_worker') == 'background.js'
assert 'declarativeNetRequestWithHostAccess' in manifest['permissions']
assert '<all_urls>' in manifest['host_permissions']
assert manifest['options_ui']['page'] == 'options.html'
assert manifest['default_locale'] == 'en'
assert manifest['name'] == '__MSG_extensionName__'
messages = json.loads(Path('Shared (Extension)/Resources/_locales/en/messages.json').read_text())
for key in ['extensionName', 'extensionDescription', 'popupRedirectPage', 'optionsTitle']:
    assert key in messages, key
for html_name in ['popup.html', 'options.html']:
    html = Path('Shared (Extension)/Resources', html_name).read_text()
    for attr in ['data-i18n', 'data-i18n-placeholder', 'data-i18n-aria-label']:
        for key in __import__('re').findall(attr + r'="([^"]+)"', html):
            assert key in messages, f'{html_name} missing i18n key {key}'
for value in [manifest['name'], manifest['description'], manifest['action']['default_title'], *(command['description'] for command in manifest['commands'].values())]:
    if value.startswith('__MSG_') and value.endswith('__'):
        assert value[6:-2] in messages, f'manifest missing i18n key {value}'
for path in ['background.js', 'content-script.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'instances.json']:
    assert Path('Shared (Extension)/Resources', path).exists(), path
instances = json.loads(Path('Shared (Extension)/Resources/instances.json').read_text())
assert len(instances) >= 30 and sum(len(v.get('clearnet', [])) for v in instances.values()) >= 300
assert manifest['content_scripts'][0]['run_at'] == 'document_start'
assert manifest['content_scripts'][0]['all_frames'] is False
assert 'content-script.js' in manifest['content_scripts'][0]['js']
popup = Path('Shared (Extension)/Resources/popup.html').read_text()
options = Path('Shared (Extension)/Resources/options.html').read_text()
assert '<script>' not in popup and '<script>' not in options
assert 'src="popup.js"' in popup and 'src="options.js"' in options
assert 'id="status"' in popup and 'aria-live="polite"' in popup
for required in ['serviceSearch', 'serviceFilter', 'debugUrl', 'backup']:
    assert required in options, required
assert options.count('aria-live="polite"') >= 5
print('manifest ok')
PY

node --check "Shared (Extension)/Resources/background.js"
node --check "Shared (Extension)/Resources/content-script.js"
node --check "Shared (Extension)/Resources/popup.js"
node --check "Shared (Extension)/Resources/options.js"
node scripts/smoke-extension.mjs
node scripts/validate-catalog.mjs
python3 -m py_compile scripts/safaridriver-extension-smoke.py
bash -n scripts/check-safari-extension-install.sh

python3 - <<'PY'
import json
from pathlib import Path
pbx = Path('Freedirect.xcodeproj/project.pbxproj').read_text()
for name in ['Freedirect (iOS)', 'Freedirect (macOS)', 'Freedirect Extension (iOS)', 'Freedirect Extension (macOS)']:
    assert name in pbx, name
assert 'IPHONEOS_DEPLOYMENT_TARGET = 26.0;' in pbx
assert 'MACOSX_DEPLOYMENT_TARGET = 26.0;' in pbx
assert 'TARGETED_DEVICE_FAMILY = "1,2";' in pbx
macos_app_info = Path('macOS (App)/Info.plist').read_text()
assert '<key>LSApplicationCategoryType</key>' in macos_app_info
assert '<string>public.app-category.utilities</string>' in macos_app_info
assert 'INFOPLIST_KEY_LSApplicationCategoryType = "public.app-category.utilities";' in pbx
assert 'com.apple.Safari.web-extension' in Path('iOS (Extension)/Info.plist').read_text()
assert 'com.apple.Safari.web-extension' in Path('macOS (Extension)/Info.plist').read_text()
assert '_locales in Resources' in pbx
assert 'content-script.js in Resources' in pbx
assert 'popup.js in Resources' in pbx
assert 'options.js in Resources' in pbx
assert 'instances.json in Resources' in pbx
assert 'GeneratedServiceCatalog.swift in Sources' not in pbx
assert not Path('Shared (App)/GeneratedServiceCatalog.swift').exists()
assert 'SwiftUI' not in Path('Shared (App)/ViewController.swift').read_text()
assert 'CODE_SIGN_ENTITLEMENTS = "macOS (App)/Freedirect.entitlements";' in pbx
assert 'CODE_SIGN_ENTITLEMENTS = "macOS (Extension)/Freedirect Extension.entitlements";' in pbx
assert pbx.count('DEVELOPMENT_TEAM = DNP7DGUB7B;') >= 6
print('project targets ok')
PY

if [ -d /Applications/Xcode-beta.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
  xcodebuild -list -project Freedirect.xcodeproj >/tmp/freedirect-xcodebuild-list.txt
  grep -q 'Freedirect (iOS)' /tmp/freedirect-xcodebuild-list.txt
  grep -q 'Freedirect (macOS)' /tmp/freedirect-xcodebuild-list.txt
  echo 'xcode project list ok'

  if [ "${1:-}" = "--build" ]; then
    # Keep macOS signing enabled: Safari/pluginkit can hide local web extensions
    # when the containing app/appex are rebuilt without a sealed sandboxed signature.
    xcodebuild -project Freedirect.xcodeproj -scheme 'Freedirect (macOS)' -configuration Debug build >/tmp/freedirect-macos-build.log
    xcodebuild -project Freedirect.xcodeproj -scheme 'Freedirect (iOS)' -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build >/tmp/freedirect-ios-build.log
    echo 'xcode builds ok'
  fi
else
  echo 'skipping xcodebuild list: /Applications/Xcode-beta.app missing'
fi
