<div align="center">

<img src="media/freedirect_logo.png" alt="Freedirect logo" width="120">

# Freedirect

**A Safari redirector for privacy-friendly frontends.**

![Platform](https://img.shields.io/badge/macOS_26+_|_iOS_26+_|_iPadOS_26+-gray?style=flat&logo=apple&logoColor=white)
![Safari](https://img.shields.io/badge/Safari-Web_Extension-gray?style=flat&logo=safari&logoColor=white)
![License](https://img.shields.io/badge/GPL--3.0-gray?style=flat&label=license)

<img src="media/options.png" alt="Freedirect settings" width="900">

</div>

Freedirect redirects links from large platforms to alternative frontends in Safari. Think YouTube to Invidious or FreeTube, Reddit to Redlib, X/Twitter to Nitter-style instances, Medium to Scribe, Wikipedia to Wikiless, and similar redirects.

The native app is intentionally minimal. Redirect settings live in the Safari extension UI, not in a duplicated native settings screen.

## What it does

- Redirects supported service URLs to privacy-friendlier frontends.
- Uses Safari Declarative Net Request where possible.
- Falls back to early navigation handling for Safari edge cases, including DNS-blocked original domains.
- Supports custom instances, pinned instances, rotating instances, health checks, and JSON backup/import.
- Supports FreeTube app redirects through `freetube://`.

## Install

From Homebrew:

```sh
brew tap 0xcub3/freedirect
brew install --cask freedirect
```

Or download the DMG from the latest GitHub release.

## Current state

Freedirect is early software. Public alternative frontends break often, and Safari extension behavior differs across macOS/iOS releases. Some services are intentionally conservative or disabled by default when public frontends are unreliable.

If you use FreeTube, do not DNS-block every YouTube-related domain. FreeTube still needs access to YouTube extractor/media domains even if Safari never opens the YouTube page.

## Development

Technical notes, architecture, build commands, and release details live in [`TECHNICAL.md`](TECHNICAL.md).

## Credits

Made by [0xCUB3](https://github.com/0xCUB3).

Freedirect is inspired by [LibRedirect](https://github.com/libredirect/browser_extension). If you use Firefox or Chromium, LibRedirect is still the project to try first.

## License

GPL-3.0. See [`LICENSE`](LICENSE).
