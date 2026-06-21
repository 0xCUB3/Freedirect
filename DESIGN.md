# DESIGN.md

## Overview

Freedirect is a restrained native product UI. The physical scene is: a user is in Safari settings or a quiet preferences window, trying to make privacy redirects reliable without feeling like they are operating security software. The visual system should recede, with clarity, status, and evidence carrying the product.

## Color System

Use OKLCH tokens in web-extension CSS. Strategy: restrained product utility with amber as a sparse trust/activation accent.

```css
:root {
  --fd-bg: oklch(1 0 0);
  --fd-surface: oklch(0.975 0.003 91.3);
  --fd-surface-elevated: oklch(0.955 0.006 91.3);
  --fd-ink: oklch(0.205 0.018 255);
  --fd-muted: oklch(0.46 0.018 255);
  --fd-primary: oklch(0.68 0.155 87);
  --fd-primary-pressed: oklch(0.58 0.16 87);
  --fd-accent: oklch(0.36 0.13 274);
  --fd-success: oklch(0.55 0.12 155);
  --fd-warning: oklch(0.72 0.14 75);
  --fd-error: oklch(0.55 0.18 28);
  --fd-border: oklch(0.88 0.008 255);
  --fd-focus: oklch(0.62 0.17 87);
}
```

Filled saturated controls use white text. Status must pair color with icon/text.

## Typography

Use platform typography first. Extension HTML uses `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Keep headings functional, not marketing-like.

## Layout

- Native app: boilerplate page only, with Quit and Open Safari Settings on macOS.
- Extension options: one service list with toggles, frontend selection, instance selection, profiles, and compact diagnostic details.
- Keep line length under 75ch for explanations.
- Avoid nested cards. Prefer native `Form`, `List`, and section headers; use panels only for dashboards and diagnostics.

## Components

- Activation checklist: shows Safari extension state, permission status, first redirect test, and next action.
- Service row: icon/monogram, service name, enabled switch, selected frontend, instance health.
- Instance picker: searchable list with health, latency, favorite/pin, and custom URL entry.
- Rule diagnostics: generated rule count, last generation time, Safari API used, known limitations.
- Research note: source-backed implementation decision with date and API link.
- Import/export: native file interaction with clear overwrite/merge choices.

Every interactive component needs default, disabled, loading, error, and success states.

## Motion

Use short 150–220ms state transitions only for progress, toggles, and diagnostics updates. Respect reduced motion. No page-load choreography.

## Accessibility

Support Dynamic Type, VoiceOver labels for service/frontends/status, keyboard focus rings, 4.5:1 minimum text contrast, and non-color status communication.
