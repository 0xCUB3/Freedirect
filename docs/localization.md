# Localization Strategy

Freedirect must support localization without making redirect behavior ambiguous.

## Scope

Localize:
- Minimal native companion labels for Safari settings handoff.
- Extension manifest strings (`name`, `description`, action title) through `_locales` once resource inclusion is finalized.
- Popup/options labels and help text.
- Safari permission guidance per platform.

Do not localize:
- URL patterns, DNR rule data, service identifiers, exported JSON keys, or diagnostic machine-readable fields.
- Frontend/project names unless the upstream project has an official localized name.

## Implementation plan

1. Keep stable internal IDs in English-like ASCII (`youtube`, `redlib`, `strict`) and map display strings separately.
2. Keep native companion strings minimal; prioritize Web Extension strings.
3. Add WebExtension `_locales/en/messages.json`, then replace manifest/UI text with message keys.
4. Add a pseudo-localization pass for truncation, Dynamic Type, and right-to-left layout.
5. Test VoiceOver and keyboard navigation in English before adding translators.

## Current status

Implemented:
- WebExtension `_locales/en/messages.json` exists.
- `manifest.json` uses `default_locale: "en"` and `__MSG_...__` substitutions for name, description, action title, and command descriptions.
- Popup, options, manifest, command descriptions, and context menu titles localize through WebExtension i18n with visible fallbacks; popup status/action strings and options service summary labels now use message keys with WebExtension placeholders.
- Native companion app has an initial `Localizable.xcstrings` catalog for top-level navigation, activation, diagnostics, service, and backup copy.

Pending:
- Full Web Extension localization beyond English.
- Full popup/options string sweep once feature copy stabilizes.
- Pseudo-localization, RTL, and truncation testing.
