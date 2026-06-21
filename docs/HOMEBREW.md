# Homebrew cask release

Freedirect can be distributed as a signed and notarized DMG through the dedicated tap repo `0xCUB3/homebrew-freedirect`.

## Install

```sh
brew tap 0xcub3/freedirect
brew install --cask freedirect
```

To upgrade later:

```sh
brew update
brew upgrade --cask freedirect
```

## Release flow

The workflow `.github/workflows/homebrew-cask.yml` builds and publishes the Homebrew DMG. It runs when a version tag is pushed, or manually through `workflow_dispatch`.

Accepted tag styles:

- `v0.1.0`
- `0.1.0`

The workflow:

1. extracts `VERSION` from the tag, stripping a leading `v` when present
2. imports the Developer ID certificate
3. optionally installs macOS provisioning profiles
4. builds `build/homebrew/Freedirect-${VERSION}.dmg` with `scripts/build-dmg.sh`
5. notarizes and staples the DMG
6. uploads it to the matching GitHub Release
7. updates `Casks/freedirect.rb` in `0xCUB3/homebrew-freedirect` with the new version and SHA-256

## Required GitHub Actions secrets

Signing:

- `MACOS_CERT_P12_B64`: base64-encoded exported `.p12` for the Developer ID Application certificate and private key
- `MACOS_CERT_PASSWORD`: password used when exporting the `.p12`
- `MACOS_PROFILE_APP_B64`: optional base64-encoded provisioning profile for the macOS app
- `MACOS_PROFILE_EXTENSION_B64`: optional base64-encoded provisioning profile for the Safari extension

Notarization:

- `APPLE_API_KEY_ID`: App Store Connect API key ID
- `APPLE_API_ISSUER_ID`: App Store Connect issuer UUID
- `APPLE_API_KEY_P8_B64`: base64-encoded `.p8` API key

Tap update:

- `HOMEBREW_TAP_TOKEN`: token with push access to `0xCUB3/homebrew-freedirect`

## Notes

- Signing uses `Developer ID Application: Alexander Skula (DNP7DGUB7B)`.
- Release assets are versioned as `Freedirect-${VERSION}.dmg`.
- The app currently targets macOS 26+.
