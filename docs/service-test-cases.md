# Manual Service Test Cases

Generated from `scripts/service-test-cases.json` and `Shared (Extension)/Resources/background.js`. Use this for Safari runtime verification after granting site access. The expected URL is generated from the current strict-profile rule templates; fill the last columns manually during macOS/iOS Safari testing.

| ID | Service | Sample URL | Expected redirected URL | macOS Safari result | iOS/iPadOS Safari result |
|---|---|---|---|---|---|
| youtube | YouTube | `https://www.youtube.com/watch?v=test` | `https://inv.thepixora.com/watch?v=test&local=false` | | |
| reddit | Reddit | `https://www.reddit.com/r/privacy/` | `https://redlib.net/r/privacy/` | | |
| twitter | X / Twitter | `https://x.com/example/status/1` | `https://nitter.net/example/status/1` | | |
| instagram | Instagram | `https://www.instagram.com/p/example/` | `https://kittygr.am/p/example/` | | |
| tiktok | TikTok | `https://www.tiktok.com/@u/video/1` | `https://proxitok.pabloferreiro.es/@u/video/1` | | |
| search | Google Search | `https://www.google.com/search?q=privacy` | `https://search.sapti.me/search?q=privacy` | | |
| maps | Google Maps | `https://maps.google.com/place/privacy` | `https://www.openstreetmap.org/search?query=place/privacy` | | |
| medium | Medium | `https://medium.com/@user/post` | `https://scribe.rip/@user/post` | | |
| wikipedia | Wikipedia | `https://en.wikipedia.org/wiki/Privacy` | `https://wikiless.org/wiki/Privacy` | | |
| imdb | IMDb | `https://www.imdb.com/title/tt0000001/` | `https://libremdb.iket.me/title/tt0000001/` | | |
| fandom | Fandom | `https://starwars.fandom.com/wiki/Jedi` | `https://breezewiki.com/starwars/wiki/Jedi` | | |
| youtubeMusic | YouTube Music | `https://music.youtube.com/watch?v=test` | `https://hyperpipe.surge.sh/watch?v=test` | | |
| chatGpt | ChatGPT | `https://chat.openai.com/c/abc` | `https://duck.ai/c/abc` | | |
| bluesky | Bluesky | `https://bsky.app/profile/example.bsky.social` | `https://skyview.social/profile/example.bsky.social` | | |
| tumblr | Tumblr | `https://www.tumblr.com/example/1/post` | `https://priviblur.fly.dev/example/1/post` | | |
| twitch | Twitch | `https://www.twitch.tv/example` | `https://safetwitch.drgns.space/example` | | |
| bilibili | Bilibili | `https://www.bilibili.com/video/BV1xx411c7mD` | `https://mikuinv.resrv.org/video/BV1xx411c7mD` | | |
| pixiv | Pixiv | `https://www.pixiv.net/artworks/1` | `https://pixivfe.exozy.me/artworks/1` | | |
| imgur | Imgur | `https://i.imgur.com/example.png` | `https://rimgo.lunar.icu/example.png` | | |
| pinterest | Pinterest | `https://www.pinterest.com/pin/1/` | `https://binternet.ahwx.org/pin/1/` | | |
| soundcloud | SoundCloud | `https://soundcloud.com/user/track` | `https://tubo.migalmoreno.com/user/track` | | |
| bandcamp | Bandcamp | `https://bandcamp.com/discover` | `https://tent.sny.sh/discover` | | |
| tekstowo | Tekstowo | `https://www.tekstowo.pl/piosenka,artist,title.html` | `https://tekstolibre.sny.sh/piosenka,artist,title.html` | | |
| genius | Genius | `https://genius.com/Artist-song-lyrics` | `https://dm.vern.cc/Artist-song-lyrics` | | |
| quora | Quora | `https://www.quora.com/Question` | `https://quetre.iket.me/Question` | | |
| github | GitHub | `https://github.com/user/repo` | `https://gh.vern.cc/user/repo` | | |
| gitlab | GitLab | `https://gitlab.com/user/repo` | `https://lab.vern.cc/user/repo` | | |
| stackOverflow | Stack Overflow | `https://stackoverflow.com/questions/1/example` | `https://ao.vern.cc/questions/1/example` | | |
| reuters | Reuters | `https://www.reuters.com/world/` | `https://neuters.de/world/` | | |
| snopes | Snopes | `https://www.snopes.com/fact-check/example/` | `https://sd.vern.cc/fact-check/example/` | | |
| ifunny | iFunny | `https://ifunny.co/picture/example` | `https://uf.vern.cc/picture/example` | | |
| tenor | Tenor | `https://tenor.com/view/example` | `https://sp.vern.cc/view/example` | | |
| knowyourmeme | Know Your Meme | `https://knowyourmeme.com/memes/example` | `https://meme.vern.cc/memes/example` | | |
| urbanDictionary | Urban Dictionary | `https://www.urbandictionary.com/define.php?term=test` | `https://rd.vern.cc/define.php?term=test` | | |
| goodreads | Goodreads | `https://www.goodreads.com/book/show/1` | `https://biblioreads.ml/book/show/1` | | |
| wolframAlpha | WolframAlpha | `https://www.wolframalpha.com/input?i=2%2B2` | `https://wolfreealpha.gitlab.io/input?i=2%2B2` | | |
| instructables | Instructables | `https://www.instructables.com/project/` | `https://structables.private.coffee/project/` | | |
| waybackMachine | Wayback Machine | `https://web.archive.org/web/20200101000000/https://example.com/` | `https://web.archive.org/web/20200101000000/https://example.com/` | | |
| pastebin | Pastebin | `https://pastebin.com/abc123` | `https://pasted.drakeerv.com/abc123` | | |
| translate | Google Translate | `https://translate.google.com/?sl=auto&tl=en&text=test` | `https://simplytranslate.org/?sl=auto&tl=en&text=test` | | |
| googleLens | Google Lens | `https://lens.google.com/search?p=test` | `https://lens.vern.cc/search?p=test` | | |
| meet | Google Meet | `https://meet.google.com/abc-defg-hij` | `https://meet.jit.si/abc-defg-hij` | | |
| sendFiles | Send Files | `https://send.firefox.com/download/abc` | `https://send.vis.ee/download/abc` | | |
| textStorage | Text Storage | `https://paste.mozilla.org/abc` | `https://privatebin.net/abc` | | |
| office | Office | `https://www.office.com/launch/word` | `https://cryptpad.fr/launch/word` | | |
| ultimateGuitar | Ultimate Guitar | `https://www.ultimate-guitar.com/song/example` | `https://freetar.de/song/example` | | |
| baiduTieba | Baidu Tieba | `https://tieba.baidu.com/f?kw=test` | `https://rat.vern.cc/f?kw=test` | | |
| threads | Threads | `https://www.threads.net/@example/post/1` | `https://shoelace.vern.cc/@example/post/1` | | |
| deviantArt | DeviantArt | `https://www.deviantart.com/example/art/title-1` | `https://skunkyart.frontendfriendly.xyz/example/art/title-1` | | |
| geeksForGeeks | GeeksForGeeks | `https://www.geeksforgeeks.org/example/` | `https://nerds.vern.cc/example/` | | |
| coub | Coub | `https://coub.com/view/abc` | `https://koub.vern.cc/view/abc` | | |
| chefkoch | Chefkoch | `https://www.chefkoch.de/rezepte/1/example.html` | `https://gocook.vern.cc/rezepte/1/example.html` | | |

Total service groups: 52
