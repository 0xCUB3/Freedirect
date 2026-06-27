'use strict'

const api = globalThis.chrome ?? globalThis.browser
const RULE_ID_BASE = 1000
const SESSION_RULE_ID_BASE = 900000
const MAX_RULES = 5000
const HEALTH_TIMEOUT_MS = 6000
const BEST_INSTANCE_HEALTH_TIMEOUT_MS = 2500
const BEST_INSTANCE_CONCURRENCY = 8
const INSTANCE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const INSTANCE_SNAPSHOT_PATH = 'instances.json'
const INSTANCE_SOURCES = [
  'https://raw.githubusercontent.com/libredirect/instances/main/data.json',
  'https://codeberg.org/LibRedirect/instances/raw/branch/main/data.json'
]
const DEFAULT_FARSIDE_BASE_URL = 'https://farside.link'
const FARSIDE_LOAD_FALLBACK_MS = 45000
const FARSIDE_ERROR_FALLBACK_MS = 8000
const FARSIDE_ROUTING = new Set(['direct', 'fallback', 'always'])
const FARSIDE_FRONTEND_MAP = {
  invidious: 'invidious',
  piped: 'piped',
  redlib: 'redlib',
  libreddit: 'libreddit',
  nitter: 'nitter',
  proxigram: 'proxigram',
  scribe: 'scribe',
  wikiless: 'wikiless',
  libremdb: 'libremdb',
  breezeWiki: 'breezewiki',
  rimgo: 'rimgo',
  searxng: 'searxng',
  whoogle: 'whoogle',
  proxiTok: 'proxitok',
  simplyTranslate: 'simplytranslate',
  lingva: 'lingva',
  quetre: 'quetre',
  gothub: 'gothub',
  anonymousOverflow: 'anonymousoverflow',
  dumb: 'dumb'
}
const FARSIDE_SERVICE_IDS = Object.fromEntries(Object.entries(FARSIDE_FRONTEND_MAP).map(([frontendId, farsideService]) => [farsideService, frontendId]))
const TOOLBAR_ICONS = {
  active: {
    16: 'images/toolbar-blue-16.png',
    32: 'images/toolbar-blue-32.png',
    48: 'images/toolbar-blue-48.png',
    128: 'images/toolbar-blue-128.png'
  },
  inactive: {
    16: 'images/toolbar-gray-16.png',
    32: 'images/toolbar-gray-32.png',
    48: 'images/toolbar-gray-48.png',
    128: 'images/toolbar-gray-128.png'
  }
}
let bundledInstancesLoaded = false
let publicInstanceRefreshStarted = false
let stateWriteQueue = Promise.resolve()
let ruleRebuildQueue = Promise.resolve()
const tabLastGoodUrls = new Map()
const recentNavigationRedirects = new Map()
const pendingFarsideFallbacks = new Map()
const NATIVE_APP_ID = 'app.freedirect.Freedirect'
const PROMISE_STYLE_API = Boolean(globalThis.browser) && api === globalThis.browser

function lastRuntimeError() {
  return api?.runtime?.lastError?.message
}

async function apiTabsUpdate(tabId, properties) {
  // Safari's chrome.tabs.update can ignore callbacks, which makes callApi hang.
  // Use a returned promise when present; otherwise this is fire-and-forget.
  if (!api.tabs?.update) throw new Error('tabs.update unavailable')
  const result = api.tabs.update(tabId, properties)
  if (result?.then) await result
}

function callApi(target, method, ...args) {
  if (!target?.[method]) return Promise.reject(new Error(`${method} unavailable`))
  if (PROMISE_STYLE_API) {
    try {
      const result = target[method](...args)
      return result?.then ? result : Promise.resolve(result)
    } catch (error) {
      return Promise.reject(error)
    }
  }
  return new Promise((resolve, reject) => {
    try {
      target[method](...args, (...values) => {
        const error = lastRuntimeError()
        if (error) reject(new Error(error))
        else resolve(values.length > 1 ? values : values[0])
      })
    } catch (error) {
      reject(error)
    }
  })
}

const PROFILES = {
  balanced: {
    name: 'Balanced',
    description: 'Redirect the highest-impact search, social, and video services while keeping niche services manual.',
    enabledServices: ['youtube', 'reddit', 'twitter', 'instagram', 'search']
  },
  strict: {
    name: 'Strict',
    description: 'Enable every implemented redirect template.',
    enabledServices: 'all'
  },
  manual: {
    name: 'Manual',
    description: 'Keep current service choices and only change settings explicitly.'
  }
}

const SERVICE_CATALOG = {
  youtube: {
    name: 'YouTube',
    confidence: 'high',
    originalHosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'],
    defaultFrontend: 'invidious',
    frontends: {
      invidious: { name: 'Invidious', instances: ['https://inv.thepixora.com', 'https://yt.chocolatemoo53.com', 'https://invidious.tiekoetter.com', 'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://invidious.f5.si'], rules: [
        { source: '^https?://(www\\.|m\\.)?youtube\\.com/watch\\?v=([^?&#/]+)(.*)', path: '/watch?v=$2$3&local=false', priority: 20, dnrRules: [
          { source: '^https?://youtube\\.com/watch\\?v=([^?&#/]+)(.*)', path: '/watch?v=$1$2&local=false', priority: 20 },
          { source: '^https?://www\\.youtube\\.com/watch\\?v=([^?&#/]+)(.*)', path: '/watch?v=$1$2&local=false', priority: 20 },
          { source: '^https?://m\\.youtube\\.com/watch\\?v=([^?&#/]+)(.*)', path: '/watch?v=$1$2&local=false', priority: 20 }
        ] },
        { source: '^https?://youtu\\.be/([^?&#/]+)(.*)', path: '/watch?v=$1&local=false', priority: 20 },
        { source: '^https?://(www\\.|m\\.)?youtube\\.com/(.*)', path: '/$2', dnrRules: [
          { source: '^https?://youtube\\.com/(.*)', path: '/$1' },
          { source: '^https?://www\\.youtube\\.com/(.*)', path: '/$1' },
          { source: '^https?://m\\.youtube\\.com/(.*)', path: '/$1' }
        ] },
        { source: '^https?://(www\\.)?youtube-nocookie\\.com/embed/([^?&#/]+)(.*)', path: '/embed/$2' }
      ] },
      piped: { name: 'Piped', instances: ['https://piped.video', 'https://cf.piped.video', 'https://vc.piped.video', 'https://re.piped.video', 'https://fl.piped.video', 'https://do.piped.video', 'https://nf.piped.video', 'https://az.piped.video', 'https://piped.private.coffee', 'https://piped.yt', 'https://piped.drgns.space', 'https://piped.owo.si', 'https://piped.ducks.party', 'https://piped.codespace.cz', 'https://piped.reallyaweso.me', 'https://piped.darkness.services', 'https://piped.orangenet.cc', 'https://piped.leptons.xyz', 'https://piped.nosebs.ru', 'https://piped.privacy.com.de', 'https://piped.adminforge.de', 'https://adminforge.de'] },
      freetube: { name: 'FreeTube', instances: ['freetube://'], appProtocol: true, rules: [
        { source: '^https?://(www\\.|m\\.)?youtube\\.com/watch\\?v=([^?&#/]+)(.*)', path: 'https://www.youtube.com/watch?v=$2$3' },
        { source: '^https?://youtu\\.be/([^?&#/]+)(.*)', path: 'https://youtu.be/$1$2' },
        { source: '^https?://(www\\.|m\\.)?youtube\\.com/(.*)', path: 'https://www.youtube.com/$2' },
        { source: '^https?://(www\\.)?youtube-nocookie\\.com/embed/([^?&#/]+)(.*)', path: 'https://www.youtube.com/embed/$2$3' }
      ] },
      materialious: { name: 'Materialious', instances: ['materialious://'], appProtocol: true, rules: [
        { source: '^https?://(www\\.|m\\.)?youtube\\.com/watch\\?v=([^?&#/]+)(.*)', path: 'watch/$2' },
        { source: '^https?://youtu\\.be/([^?&#/]+)(.*)', path: 'watch/$1' },
        { source: '^https?://(www\\.|m\\.)?youtube\\.com/shorts/([^?&#/]+)(.*)', path: 'watch/$2' },
        { source: '^https?://(www\\.)?youtube-nocookie\\.com/embed/([^?&#/]+)(.*)', path: 'watch/$2' }
      ] }
    },
    rules: [
      { source: '^https?://(www\\.|m\\.)?youtube\\.com/(.*)', path: '/$2' },
      { source: '^https?://youtu\\.be/([^?&#/]+)(.*)', path: '/watch?v=$1' },
      { source: '^https?://(www\\.)?youtube-nocookie\\.com/embed/([^?&#/]+)(.*)', path: '/embed/$2' }
    ]
  },
  reddit: {
    name: 'Reddit',
    confidence: 'high',
    originalHosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'redd.it'],
    defaultFrontend: 'redlib',
    frontends: {
      redlib: { name: 'Redlib', instances: ['https://redlib.net', 'https://safereddit.com', 'https://libreddit.bus-hit.me'] },
      libreddit: { name: 'Libreddit', instances: ['https://libreddit.projectsegfau.lt'] }
    },
    rules: [
      { source: '^https?://(www\\.|old\\.|new\\.)?reddit\\.com/(.*)', path: '/$2', dnrRules: [
        { source: '^https?://reddit\\.com/(.*)', path: '/$1' },
        { source: '^https?://www\\.reddit\\.com/(.*)', path: '/$1' },
        { source: '^https?://old\\.reddit\\.com/(.*)', path: '/$1' },
        { source: '^https?://new\\.reddit\\.com/(.*)', path: '/$1' }
      ] },
      { source: '^https?://redd\\.it/(.*)', path: '/$1' }
    ]
  },
  twitter: {
    name: 'X / Twitter',
    confidence: 'high',
    originalHosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
    defaultFrontend: 'nitter',
    frontends: {
      nitter: { name: 'Nitter-compatible', instances: ['https://nitter.net', 'https://nitter.poast.org', 'https://xcancel.com'] }
    },
    rules: [
      { source: '^https?://(www\\.|mobile\\.)?(twitter|x)\\.com/(.*)', path: '/$3', dnrRules: [
        { source: '^https?://x\\.com/(.*)', path: '/$1' },
        { source: '^https?://www\\.x\\.com/(.*)', path: '/$1' },
        { source: '^https?://twitter\\.com/(.*)', path: '/$1' },
        { source: '^https?://www\\.twitter\\.com/(.*)', path: '/$1' },
        { source: '^https?://mobile\\.twitter\\.com/(.*)', path: '/$1' }
      ] }
    ]
  },
  instagram: {
    name: 'Instagram',
    confidence: 'high',
    originalHosts: ['instagram.com', 'www.instagram.com'],
    defaultFrontend: 'kittygram',
    frontends: {
      kittygram: { name: 'kittygram', instances: ['https://kittygr.am', 'https://kittygram.irelephant.net', 'https://kittygram.kareem.one', 'https://kg.meowing.de'] },
      proxigram: { name: 'Proxigram', instances: ['https://ig.opnxng.com', 'https://proxigram.lunar.icu', 'https://gram.whatever.social', 'https://ig.snine.nl', 'https://proxigram.privacyredirect.com'] }
    },
    rules: [{ source: '^https?://(www\\.)?instagram\\.com/(.*)', path: '/$2' }]
  },
  tiktok: {
    name: 'TikTok',
    confidence: 'high',
    originalHosts: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'],
    defaultFrontend: 'proxiTok',
    frontends: {
      proxiTok: { name: 'ProxiTok', instances: ['https://proxitok.pabloferreiro.es', 'https://tt.opnxng.com', 'https://tok.habedieeh.re', 'https://proxitok.privacydev.net', 'https://tok.artemislena.eu', 'https://cringe.whatever.social', 'https://proxitok.lunar.icu', 'https://cringe.seitan-ayoub.lol', 'https://proxitok.r4fo.com', 'https://proxitok.belloworld.it', 'https://proxitok.smnz.de', 'https://proxitok.esmailelbob.xyz'] }
    },
    rules: [{ source: '^https?://(www\\.|vm\\.)?tiktok\\.com/(.*)', path: '/$2', dnrRules: [
      { source: '^https?://tiktok\\.com/(.*)', path: '/$1' },
      { source: '^https?://www\\.tiktok\\.com/(.*)', path: '/$1' },
      { source: '^https?://vm\\.tiktok\\.com/(.*)', path: '/$1' }
    ] }]
  },
  search: {
    name: 'Google Search',
    confidence: 'high',
    originalHosts: ['google.com', 'www.google.com'],
    defaultFrontend: 'searxng',
    frontends: {
      searxng: { name: 'SearXNG', instances: ['https://search.sapti.me', 'https://searx.be'] },
      whoogle: { name: 'Whoogle', instances: ['https://whoogle.dcs0.hu'] },
      librex: { name: 'LibreX', instances: ['https://librex.beparanoid.de'] }
    },
    rules: [{ source: '^https?://(www\\.)?google\\.[^/]+/search\\?(.+)', path: '/search?$2' }]
  },
  maps: {
    name: 'Google Maps',
    confidence: 'high',
    originalHosts: ['maps.google.com', 'www.google.com'],
    defaultFrontend: 'osm',
    frontends: {
      osm: { name: 'OpenStreetMap', instances: ['https://www.openstreetmap.org'] },
      appleMaps: { name: 'Apple Maps', instances: ['https://maps.apple.com'], rules: [
        { source: '^https?://maps\\.google\\.[^/]+/maps\\?q=([^&#]+).*', path: '/?q=$1', priority: 20 },
        { source: '^https?://maps\\.google\\.[^/]+/search/([^?&#]+).*', path: '/?q=$1', priority: 20 },
        { source: '^https?://maps\\.google\\.[^/]+/place/([^?&#]+).*', path: '/?q=$1', priority: 20 },
        { source: '^https?://maps\\.google\\.[^/]+/@(-?[0-9.]+),(-?[0-9.]+),.*', path: '/?ll=$1,$2', priority: 20 },
        { source: '^https?://(www\\.)?google\\.[^/]+/maps/search/([^?&#]+).*', path: '/?q=$2', priority: 20 },
        { source: '^https?://(www\\.)?google\\.[^/]+/maps/place/([^?&#]+).*', path: '/?q=$2', priority: 20 },
        { source: '^https?://(www\\.)?google\\.[^/]+/maps/@(-?[0-9.]+),(-?[0-9.]+),.*', path: '/?ll=$2,$3', priority: 20 },
        { source: '^https?://maps\\.google\\.[^/]+/(.*)', path: '/?q=$1' },
        { source: '^https?://(www\\.)?google\\.[^/]+/maps/(.*)', path: '/?q=$2' }
      ] }
    },
    rules: [
      { source: '^https?://maps\\.google\\.[^/]+/(.*)', path: '/search?query=$1' },
      { source: '^https?://(www\\.)?google\\.[^/]+/maps/(.*)', path: '/search?query=$2' }
    ]
  },
  medium: {
    name: 'Medium',
    confidence: 'high',
    originalHosts: ['medium.com', 'www.medium.com'],
    defaultFrontend: 'scribe',
    frontends: {
      scribe: { name: 'Scribe', instances: ['https://scribe.rip'] },
      freedium: { name: 'Freedium', instances: ['https://freedium.cfd'] }
    },
    rules: [{ source: '^https?://(www\\.)?medium\\.com/(.*)', path: '/$2' }]
  },
  wikipedia: {
    name: 'Wikipedia',
    confidence: 'high',
    originalHosts: ['wikipedia.org', 'www.wikipedia.org'],
    defaultFrontend: 'wikiless',
    frontends: {
      wikiless: { name: 'Wikiless', instances: ['https://wikiless.org', 'https://wiki.froth.zone'] }
    },
    rules: [{ source: '^https?://([a-z]+)\\.wikipedia\\.org/wiki/(.*)', path: '/wiki/$2' }]
  },
  imdb: {
    name: 'IMDb',
    confidence: 'high',
    originalHosts: ['imdb.com', 'www.imdb.com'],
    defaultFrontend: 'libremdb',
    frontends: { libremdb: { name: 'libremdb', instances: ['https://libremdb.iket.me'] } },
    rules: [{ source: '^https?://(www\\.)?imdb\\.com/(.*)', path: '/$2' }]
  },
  fandom: {
    name: 'Fandom',
    confidence: 'high',
    originalHosts: ['fandom.com', 'www.fandom.com'],
    sampleUrl: 'https://minecraft.fandom.com/wiki/Minecraft_Wiki',
    defaultFrontend: 'breezeWiki',
    frontends: { breezeWiki: { name: 'BreezeWiki', instances: ['https://breezewiki.com', 'https://antifandom.com'] } },
    rules: [{ source: '^https?://([^./]+)\\.fandom\\.com/wiki/(.*)', path: '/$1/wiki/$2' }]
  }
}

Object.assign(SERVICE_CATALOG, {
  youtubeMusic: simpleService('YouTube Music', ['music.youtube.com'], 'hyperpipe', 'Hyperpipe', ['https://hyperpipe.surge.sh']),
  chatGpt: simpleService('ChatGPT', ['chatgpt.com', 'chat.openai.com'], 'duckDuckGoAiChat', 'DuckDuckGo AI Chat', ['https://duck.ai']),
  bluesky: simpleService('Bluesky', ['bsky.app', 'www.bsky.app'], 'skyview', 'Skyview', ['https://skyview.social']),
  tumblr: simpleService('Tumblr', ['tumblr.com', 'www.tumblr.com'], 'priviblur', 'Priviblur', ['https://pb.bloat.cat', 'https://priviblur.canine.tools', 'https://priviblur.pussthecat.org']),
  twitch: simpleService('Twitch', ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'], 'safetwitch', 'SafeTwitch', ['https://ttv.vern.cc', 'https://twitch.sudovanilla.org', 'https://safetwitch.adminforge.de']),
  pixiv: simpleService('Pixiv', ['pixiv.net', 'www.pixiv.net'], 'pixivFe', 'PixivFE', ['https://pixivfe.darkness.services', 'https://pixiv.perennialte.ch']),
  imgur: simpleService('Imgur', ['imgur.com', 'www.imgur.com', 'i.imgur.com'], 'rimgo', 'Rimgo', ['https://rimgo.catsarch.com', 'https://imgur.artemislena.eu', 'https://rimgo.pussthecat.org']),
  pinterest: simpleService('Pinterest', ['pinterest.com', 'www.pinterest.com'], 'binternet', 'Binternet', ['https://bn.bloat.cat', 'https://bn.opnxng.com', 'https://binternet.privacyredirect.com']),
  soundcloud: simpleService('SoundCloud', ['soundcloud.com', 'www.soundcloud.com'], 'tuboSoundcloud', 'Tubo', ['https://tubo.reallyaweso.me']),
  bandcamp: simpleService('Bandcamp', ['bandcamp.com', 'www.bandcamp.com'], 'tent', 'Tent', ['https://tent.sny.sh']),
  tekstowo: {
    name: 'Tekstowo',
    confidence: 'starter',
    originalHosts: ['tekstowo.pl', 'www.tekstowo.pl'],
    defaultFrontend: 'tekstoLibre',
    frontends: { tekstoLibre: { name: 'TekstoLibre', instances: ['https://davilarek.github.io'] } },
    rules: [{ source: '^https?://(www\\.)?tekstowo\\.pl/?(.*)', path: '/TekstoLibre/$2' }]
  },
  genius: simpleService('Genius', ['genius.com', 'www.genius.com'], 'dumb', 'Dumb', ['https://dm.vern.cc']),
  quora: simpleService('Quora', ['quora.com', 'www.quora.com'], 'quetre', 'Quetre', ['https://quetre.iket.me']),
  github: simpleService('GitHub', ['github.com', 'www.github.com'], 'gothub', 'GotHub', ['https://gh.vern.cc']),
  gitlab: simpleService('GitLab', ['gitlab.com', 'www.gitlab.com'], 'laboratory', 'Laboratory', ['https://lab.vern.cc']),
  stackOverflow: simpleService('Stack Overflow', ['stackoverflow.com', 'www.stackoverflow.com', 'stackexchange.com'], 'anonymousOverflow', 'AnonymousOverflow', ['https://ao.vern.cc']),
  reuters: simpleService('Reuters', ['reuters.com', 'www.reuters.com'], 'neuters', 'Neuters', ['https://nu.vern.cc']),
  snopes: simpleService('Snopes', ['snopes.com', 'www.snopes.com'], 'suds', 'Suds', ['https://sd.vern.cc']),
  ifunny: simpleService('iFunny', ['ifunny.co', 'www.ifunny.co'], 'unfunny', 'Unfunny', ['https://uf.vern.cc']),
  tenor: simpleService('Tenor', ['tenor.com', 'www.tenor.com'], 'soprano', 'Soprano', ['https://sp.vern.cc']),
  knowyourmeme: simpleService('Know Your Meme', ['knowyourmeme.com', 'www.knowyourmeme.com'], 'meme', 'Meme', ['https://meme.vern.cc']),
  urbanDictionary: simpleService('Urban Dictionary', ['urbandictionary.com', 'www.urbandictionary.com'], 'ruralDictionary', 'Rural Dictionary', ['https://rd.vern.cc']),
  goodreads: simpleService('Goodreads', ['goodreads.com', 'www.goodreads.com'], 'biblioReads', 'BiblioReads', ['https://biblioreads.eu.org', 'https://biblioreads.mooo.com', 'https://read.seitan-ayoub.lol']),
  wolframAlpha: simpleService('WolframAlpha', ['wolframalpha.com', 'www.wolframalpha.com'], 'wolfreeAlpha', 'WolfreeAlpha', ['https://wolfreealpha.gitlab.io']),
  instructables: simpleService('Instructables', ['instructables.com', 'www.instructables.com'], 'structables', 'Structables', ['https://structables.private.coffee']),
  waybackMachine: simpleService('Wayback Machine', ['web.archive.org'], 'waybackClassic', 'Wayback Classic', ['https://web.archive.org']),
  pastebin: simpleService('Pastebin', ['pastebin.com', 'www.pastebin.com'], 'pasted', 'Pasted', ['https://pasted.drakeerv.com']),
  translate: simpleService('Google Translate', ['translate.google.com'], 'simplyTranslate', 'SimplyTranslate', ['https://simplytranslate.org']),
  googleLens: simpleService('Google Lens', ['lens.google.com'], 'rens', 'Rens', ['https://lens.vern.cc']),
  meet: simpleService('Google Meet', ['meet.google.com'], 'jitsi', 'Jitsi Meet', ['https://meet.jit.si']),
  sendFiles: simpleService('Send Files', ['send.firefox.com'], 'send', 'Send', ['https://send.vis.ee']),
  textStorage: simpleService('Text Storage', ['paste.mozilla.org', 'hastebin.com'], 'privateBin', 'PrivateBin', ['https://privatebin.net']),
  office: simpleService('Office', ['office.com', 'www.office.com'], 'cryptPad', 'CryptPad', ['https://cryptpad.fr']),
  ultimateGuitar: simpleService('Ultimate Guitar', ['ultimate-guitar.com', 'www.ultimate-guitar.com'], 'freetar', 'Freetar', ['https://freetar.de']),
  baiduTieba: simpleService('Baidu Tieba', ['tieba.baidu.com'], 'ratAintTieba', 'RatAintTieba', ['https://rat.vern.cc']),
  threads: simpleService('Threads', ['threads.net', 'www.threads.net'], 'shoelace', 'Shoelace', ['https://shoelace.vern.cc']),
  deviantArt: simpleService('DeviantArt', ['deviantart.com', 'www.deviantart.com'], 'skunkyArt', 'SkunkyArt', ['https://art.bloat.cat', 'https://da.opnxng.com']),
  geeksForGeeks: simpleService('GeeksForGeeks', ['geeksforgeeks.org', 'www.geeksforgeeks.org'], 'nerdsForNerds', 'NerdsForNerds', ['https://nerds.vern.cc']),
  coub: simpleService('Coub', ['coub.com', 'www.coub.com'], 'koub', 'Koub', ['https://koub.vern.cc']),
  chefkoch: simpleService('Chefkoch', ['chefkoch.de', 'www.chefkoch.de'], 'gocook', 'GoCook', ['https://gocook.vern.cc'])
})

const RESEARCHED_LIMITATIONS = [
  'Safari DNR redirect rules require declarativeNetRequestWithHostAccess and user-granted host permissions for source and destination sites.',
  'Safari documented RuleCondition support does not include tabIds, so per-tab bypass is approximated with exact-URL session allow rules.',
  'DNR cannot run arbitrary JavaScript per request; random instance selection is implemented by regenerating rules from the selected or rotated instance.',
  'Complex service-specific rewrites are implemented as researched templates and must be expanded service-by-service rather than copied from GPL code.'
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function localized(key, fallback) {
  return api.i18n?.getMessage(key) || fallback
}

function simpleService(name, originalHosts, defaultFrontend, frontendName, instances) {
  const hosts = Array.from(new Set(originalHosts.map(host => host.replace(/^www\./, ''))))
  return {
    name,
    confidence: 'starter',
    originalHosts,
    defaultFrontend,
    frontends: { [defaultFrontend]: { name: frontendName, instances } },
    rules: hosts.map(host => ({ source: `^https?://(www\\.)?${host.replace(/\./g, '\\.')}/?(.*)`, path: '/$2' }))
  }
}

function defaultState() {
  const services = {}
  const balancedServices = new Set(PROFILES.balanced.enabledServices)
  for (const [id, service] of Object.entries(SERVICE_CATALOG)) {
    const frontendId = service.defaultFrontend
    services[id] = {
      enabled: balancedServices.has(id),
      frontend: frontendId,
      instance: service.frontends[frontendId].instances[0],
      mode: 'selected',
      routing: 'direct',
      customInstances: [],
      favoriteInstances: [],
      health: {}
    }
  }
  return {
    schemaVersion: 1,
    globalEnabled: true,
    farsideBaseUrl: DEFAULT_FARSIDE_BASE_URL,
    farsideFallbackEnabled: true,
    profile: 'balanced',
    customProfiles: {},
    services,
    diagnostics: {
      lastGeneratedAt: null,
      lastRuleCount: 0,
      bypassedUrls: [],
      lastError: null,
      lastHealthCheckAt: null,
      lastHealthError: null,
      lastInstanceRefreshAt: null,
      lastInstanceRefreshError: null,
      lastRejectedRules: []
    }
  }
}

async function storageGet(keys) {
  return await callApi(api.storage.local, 'get', keys)
}

async function storageSet(value) {
  return await callApi(api.storage.local, 'set', value)
}

function normalizeInstanceOrigin(value) {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function normalizeFarsideBaseUrl(value) {
  return normalizeInstanceOrigin(value) || DEFAULT_FARSIDE_BASE_URL
}

function farsideBaseUrl(state) {
  return normalizeFarsideBaseUrl(state?.farsideBaseUrl)
}

function farsideServiceForFrontend(frontendId) {
  return FARSIDE_FRONTEND_MAP[frontendId] || null
}

function farsideServiceForPathSegment(segment) {
  const frontendId = FARSIDE_SERVICE_IDS[String(segment || '').toLowerCase()]
  return frontendId ? { frontendId, farsideService: String(segment).toLowerCase() } : null
}

function farsidePathForFrontend(frontendId, path) {
  const service = farsideServiceForFrontend(frontendId)
  if (!service || typeof path !== 'string' || /^https?:/i.test(path) || path.startsWith('$')) return null
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `/${service}${suffix}`
}

function configuredRouting(service, config, frontendId) {
  const routing = FARSIDE_ROUTING.has(config?.routing) ? config.routing : 'direct'
  return routing !== 'direct' && !farsidePathForFrontend(frontendId, '/') ? 'direct' : routing
}

function normalizeConfiguredRouting(service, frontendId, value) {
  const routing = FARSIDE_ROUTING.has(value) ? value : 'direct'
  return routing !== 'direct' && !farsidePathForFrontend(frontendId, '/') ? 'direct' : routing
}

function normalizeConfiguredInstance(serviceId, frontendId, value) {
  const raw = String(value ?? '')
  const builtin = SERVICE_CATALOG[serviceId]?.frontends?.[frontendId]?.instances ?? []
  if (builtin.includes(raw)) return raw
  return normalizeInstanceOrigin(raw)
}

function sanitizeStringArray(values, mapper = value => String(value)) {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map(mapper).filter(Boolean))).slice(0, 50)
}

function sanitizeCustomFrontendId(value) {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return id ? `custom:${id}` : null
}

function sanitizeCustomFrontends(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [rawId, rawFrontend] of Object.entries(value)) {
    const id = sanitizeCustomFrontendId(rawId.replace(/^custom:/, ''))
    if (!id || !rawFrontend || typeof rawFrontend !== 'object' || Array.isArray(rawFrontend)) continue
    const instances = sanitizeStringArray(rawFrontend.instances, normalizeInstanceOrigin)
    if (!instances.length) continue
    const name = String(rawFrontend.name || rawId.replace(/^custom:/, '')).trim().slice(0, 80) || 'Custom'
    result[id] = { name, instances }
  }
  return result
}

function serviceFrontends(service, config = {}) {
  return { ...service.frontends, ...sanitizeCustomFrontends(config.customFrontends) }
}

function sanitizeHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [instance, health] of Object.entries(value)) {
    const origin = normalizeInstanceOrigin(instance)
    if (!origin || !health || typeof health !== 'object' || Array.isArray(health)) continue
    result[origin] = {
      ok: Boolean(health.ok),
      status: Number.isFinite(health.status) ? Number(health.status) : null,
      latencyMs: Number.isFinite(health.latencyMs) ? Math.max(0, Math.round(Number(health.latencyMs))) : null,
      checkedAt: typeof health.checkedAt === 'string' ? health.checkedAt : null,
      error: typeof health.error === 'string' ? health.error.slice(0, 500) : null
    }
  }
  return result
}

function sanitizeServiceConfig(serviceId, rawConfig, defaultConfig) {
  const service = SERVICE_CATALOG[serviceId]
  let config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {}
  if (serviceId === 'instagram' && config.frontend === 'proxigram' && (!config.instance || config.instance === 'https://proxigram.lunar.icu')) {
    config = { ...config, frontend: defaultConfig.frontend, instance: defaultConfig.instance }
  }
  if (serviceId === 'youtube' && config.frontend === 'invidious' && ['https://inv.nadeko.net', 'https://yewtu.be', 'https://vid.puffyan.us'].includes(config.instance)) {
    config = { ...config, instance: defaultConfig.instance }
  }
  const customFrontends = sanitizeCustomFrontends(config.customFrontends)
  const frontends = serviceFrontends(service, { customFrontends })
  const frontend = config.frontend in frontends ? config.frontend : defaultConfig.frontend
  const defaultInstance = frontends[frontend].instances[0]
  const customInstances = sanitizeStringArray(config.customInstances, normalizeInstanceOrigin)
  const favoriteInstances = sanitizeStringArray(config.favoriteInstances, normalizeInstanceOrigin)
  const allowedInstances = new Set([...customInstances, ...favoriteInstances, ...frontends[frontend].instances])
  const instance = normalizeConfiguredInstance(serviceId, frontend, config.instance) || normalizeInstanceOrigin(config.instance)
  return {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : defaultConfig.enabled,
    frontend,
    instance: instance && allowedInstances.has(instance) ? instance : defaultInstance,
    mode: 'selected',
    routing: 'direct',
    customInstances,
    customFrontends,
    favoriteInstances,
    health: sanitizeHealth(config.health)
  }
}

function sanitizeServiceUpdate(serviceId, currentConfig, patch) {
  const service = SERVICE_CATALOG[serviceId]
  if (!service) throw new Error('Unknown service')
  const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const customFrontends = input.customFrontends === undefined
    ? sanitizeCustomFrontends(currentConfig.customFrontends)
    : sanitizeCustomFrontends(input.customFrontends)
  const frontends = serviceFrontends(service, { customFrontends })
  const frontend = input.frontend === undefined
    ? (currentConfig.frontend in frontends ? currentConfig.frontend : service.defaultFrontend)
    : (input.frontend in frontends ? input.frontend : (currentConfig.frontend in frontends ? currentConfig.frontend : service.defaultFrontend))
  const customInstances = input.customInstances === undefined
    ? sanitizeStringArray(currentConfig.customInstances, normalizeInstanceOrigin)
    : sanitizeStringArray(input.customInstances, normalizeInstanceOrigin)
  const favoriteInstances = input.favoriteInstances === undefined
    ? sanitizeStringArray(currentConfig.favoriteInstances, normalizeInstanceOrigin)
    : sanitizeStringArray(input.favoriteInstances, normalizeInstanceOrigin)
  const allowedInstances = new Set([...customInstances, ...favoriteInstances, ...frontends[frontend].instances])
  const currentInstance = normalizeConfiguredInstance(serviceId, frontend, currentConfig.instance) || normalizeInstanceOrigin(currentConfig.instance)
  const requestedInstance = input.instance === undefined ? currentInstance : (normalizeConfiguredInstance(serviceId, frontend, input.instance) || normalizeInstanceOrigin(input.instance))
  const defaultInstance = frontends[frontend].instances[0]
  return {
    enabled: input.enabled === undefined ? Boolean(currentConfig.enabled) : Boolean(input.enabled),
    frontend,
    instance: requestedInstance && allowedInstances.has(requestedInstance) ? requestedInstance : (currentInstance && allowedInstances.has(currentInstance) ? currentInstance : defaultInstance),
    mode: 'selected',
    routing: 'direct',
    customInstances,
    customFrontends,
    favoriteInstances,
    health: sanitizeHealth(currentConfig.health)
  }
}

function migrateState(rawState) {
  const defaults = defaultState()
  const input = rawState && typeof rawState === 'object' && !Array.isArray(rawState) ? rawState : {}
  const migrations = []
  if (!rawState || rawState.schemaVersion !== defaults.schemaVersion) {
    migrations.push({ from: rawState?.schemaVersion ?? 0, to: defaults.schemaVersion, at: new Date().toISOString() })
  }
  const state = { ...defaults }
  state.schemaVersion = defaults.schemaVersion
  state.globalEnabled = typeof input.globalEnabled === 'boolean' ? input.globalEnabled : defaults.globalEnabled
  state.farsideBaseUrl = normalizeFarsideBaseUrl(input.farsideBaseUrl ?? defaults.farsideBaseUrl)
  state.farsideFallbackEnabled = typeof input.farsideFallbackEnabled === 'boolean' ? input.farsideFallbackEnabled : defaults.farsideFallbackEnabled
  state.customProfiles = input.customProfiles && typeof input.customProfiles === 'object' && !Array.isArray(input.customProfiles) ? Object.fromEntries(Object.entries(input.customProfiles).map(([id, profile]) => [String(id).slice(0, 40), { name: String(profile?.name || id).slice(0, 80), enabledServices: sanitizeStringArray(profile?.enabledServices, value => String(value)).filter(id => id in SERVICE_CATALOG) }]).filter(([, profile]) => profile.enabledServices.length)) : {}
  const allProfiles = { ...PROFILES, ...state.customProfiles }
  state.profile = input.profile in allProfiles ? input.profile : defaults.profile
  state.services = {}
  for (const [serviceId, serviceDefaults] of Object.entries(defaults.services)) {
    state.services[serviceId] = sanitizeServiceConfig(serviceId, input.services?.[serviceId], serviceDefaults)
  }
  state.diagnostics = { ...defaults.diagnostics }
  if (input.diagnostics && typeof input.diagnostics === 'object' && !Array.isArray(input.diagnostics)) {
    state.diagnostics = {
      ...state.diagnostics,
      lastGeneratedAt: typeof input.diagnostics.lastGeneratedAt === 'string' ? input.diagnostics.lastGeneratedAt : null,
      lastRuleCount: Number.isFinite(input.diagnostics.lastRuleCount) ? Math.max(0, Math.round(Number(input.diagnostics.lastRuleCount))) : 0,
      lastError: typeof input.diagnostics.lastError === 'string' ? input.diagnostics.lastError.slice(0, 500) : null,
      bypassedUrls: sanitizeStringArray(input.diagnostics.bypassedUrls, value => {
        try { return new URL(String(value)).href } catch { return null }
      }).slice(0, 20),
      lastHealthCheckAt: typeof input.diagnostics.lastHealthCheckAt === 'string' ? input.diagnostics.lastHealthCheckAt : null,
      lastHealthError: typeof input.diagnostics.lastHealthError === 'string' ? input.diagnostics.lastHealthError.slice(0, 500) : null,
      lastInstanceRefreshAt: typeof input.diagnostics.lastInstanceRefreshAt === 'string' ? input.diagnostics.lastInstanceRefreshAt : null,
      lastInstanceRefreshError: typeof input.diagnostics.lastInstanceRefreshError === 'string' ? input.diagnostics.lastInstanceRefreshError.slice(0, 500) : null,
      lastRejectedRules: Array.isArray(input.diagnostics.lastRejectedRules) ? input.diagnostics.lastRejectedRules.slice(0, 20).map(rule => ({ id: Number(rule.id) || null, serviceId: String(rule.serviceId || ''), serviceName: String(rule.serviceName || ''), source: String(rule.source || ''), reason: String(rule.reason || '').slice(0, 200) })).filter(rule => rule.id) : [],
      migrations: Array.isArray(input.diagnostics.migrations) ? input.diagnostics.migrations.filter(item => item && typeof item === 'object').slice(-10) : []
    }
  }
  if (migrations.length) state.diagnostics.migrations = [...(state.diagnostics.migrations ?? []), ...migrations].slice(-10)
  return state
}

async function getState() {
  const stored = await storageGet(['freedirectState'])
  return migrateState(stored.freedirectState)
}

async function saveState(state) {
  await storageSet({ freedirectState: state })
}

function withStateWrite(mutator) {
  const run = stateWriteQueue.catch(() => null).then(async () => {
    const state = await getState()
    const result = await mutator(state)
    await saveState(state)
    return result
  })
  stateWriteQueue = run.then(() => null, () => null)
  return run
}

function mergePublicInstanceData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0
  let added = 0
  for (const service of Object.values(SERVICE_CATALOG)) {
    for (const [frontendId, frontend] of Object.entries(service.frontends)) {
      const publicInstances = sanitizeStringArray(data[frontendId]?.clearnet, normalizeInstanceOrigin)
      if (!publicInstances.length) continue
      const before = frontend.instances.length
      frontend.instances = publicInstances
      added += Math.max(0, frontend.instances.length - before)
    }
  }
  return added
}

async function loadBundledPublicInstances() {
  if (bundledInstancesLoaded) return { ok: true, bundled: true }
  const url = api.runtime?.getURL ? api.runtime.getURL(INSTANCE_SNAPSHOT_PATH) : INSTANCE_SNAPSHOT_PATH
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Bundled instance snapshot failed: HTTP ${response.status}`)
  const data = await response.json()
  const added = mergePublicInstanceData(data)
  bundledInstancesLoaded = true
  return { ok: true, bundled: true, added }
}

async function loadPublicInstances({ force = false, bundledOnly = false } = {}) {
  try { await loadBundledPublicInstances() } catch {}
  const stored = await storageGet(['freedirectPublicInstances', 'freedirectState'])
  const cached = stored.freedirectPublicInstances
  if (cached?.data) mergePublicInstanceData(cached.data)
  if (bundledOnly) return { ok: true, bundled: true, cached: Boolean(cached?.data), fetchedAt: cached?.fetchedAt ?? null }
  if (!force && cached?.data && Date.now() - Date.parse(cached.fetchedAt || 0) < INSTANCE_CACHE_MAX_AGE_MS) {
    return { ok: true, cached: true, fetchedAt: cached.fetchedAt }
  }
  let lastError = null
  for (const url of INSTANCE_SOURCES) {
    try {
      const response = await fetchWithTimeout(url, HEALTH_TIMEOUT_MS)
      if (!response.response?.ok) throw new Error(`HTTP ${response.response?.status || 'failed'}`)
      const data = await response.response.json()
      const fetchedAt = new Date().toISOString()
      mergePublicInstanceData(data)
      await storageSet({ freedirectPublicInstances: { fetchedAt, source: url, data } })
      await withStateWrite(state => {
        state.diagnostics.lastInstanceRefreshAt = fetchedAt
        state.diagnostics.lastInstanceRefreshError = null
      })
      return { ok: true, cached: false, fetchedAt, source: url }
    } catch (error) {
      lastError = error
    }
  }
  if (cached?.data) {
    mergePublicInstanceData(cached.data)
    return { ok: true, cached: true, fetchedAt: cached.fetchedAt, warning: String(lastError?.message ?? lastError) }
  }
  const reason = String(lastError?.message ?? lastError ?? 'No public instance source available')
  await withStateWrite(state => {
    state.diagnostics.lastInstanceRefreshError = reason
  })
  return { ok: false, reason }
}

function selectedInstance(serviceId, state) {
  const service = SERVICE_CATALOG[serviceId]
  const config = state.services[serviceId]
  const frontends = serviceFrontends(service, config)
  const frontendId = config.frontend in frontends ? config.frontend : service.defaultFrontend
  const frontend = frontends[frontendId]
  const candidates = [...(config.favoriteInstances ?? []), ...(config.customInstances ?? []), ...frontend.instances]
  return candidates.includes(config.instance) ? config.instance : candidates[0]
}

function templateSubstitution(instance, path, { dnr = false } = {}) {
  const base = instance.endsWith('://') ? instance : instance.replace(/\/$/, '')
  return base + (dnr ? path.replaceAll('$', '\\') : path)
}

function ruleRecords(state) {
  if (!state.globalEnabled) return []
  const records = []
  let id = RULE_ID_BASE
  for (const [serviceId, service] of Object.entries(SERVICE_CATALOG)) {
    const config = state.services[serviceId]
    if (!config?.enabled) continue
    const frontends = serviceFrontends(service, config)
    const frontendId = config.frontend in frontends ? config.frontend : service.defaultFrontend
    const frontend = frontends[frontendId]
    if (frontend.appProtocol) continue
    const instance = selectedInstance(serviceId, state)
    const templates = frontend.rules ?? service.rules
    const dnrTemplates = templates.flatMap(template => {
      if (!Array.isArray(template.dnrRules) || !template.dnrRules.length) return [template]
      return template.dnrRules.map(dnrRule => ({ ...template, ...dnrRule, priority: dnrRule.priority ?? template.priority }))
    })
    for (const template of dnrTemplates) {
      const path = template.path
      if (records.length >= MAX_RULES || !path) break
      const substitution = templateSubstitution(instance, path, { dnr: true })
      const rule = {
        id: id++,
        priority: template.priority ?? 10,
        action: {
          type: 'redirect',
          redirect: { regexSubstitution: substitution }
        },
        condition: {
          regexFilter: template.source,
          resourceTypes: ['main_frame']
        }
      }
      records.push({
        id: rule.id,
        serviceId,
        serviceName: service.name,
        frontendId,
        frontendName: frontends[frontendId].name,
        routing: configuredRouting(service, config, frontendId),
        instance,
        source: template.source,
        substitution,
        rule
      })
    }
  }
  return records
}

function makeRules(state) {
  return ruleRecords(state).map(record => record.rule)
}

function rulePreview(state) {
  return ruleRecords(state).map(({ rule, ...metadata }) => metadata)
}

async function supportedDnrRules(rules) {
  if (!api.declarativeNetRequest?.isRegexSupported) return { rules, rejected: [] }
  const accepted = []
  const rejected = []
  for (const rule of rules) {
    try {
      const result = await callApi(api.declarativeNetRequest, 'isRegexSupported', { regex: rule.condition.regexFilter })
      if (result?.isSupported === false) rejected.push({ id: rule.id, reason: result.reason || 'unsupported regex' })
      else accepted.push(rule)
    } catch {
      accepted.push(rule)
    }
  }
  return { rules: accepted, rejected }
}

function rebuildRules() {
  const run = ruleRebuildQueue.catch(() => null).then(rebuildRulesNow)
  ruleRebuildQueue = run.then(() => null, () => null)
  return run
}

async function rebuildRulesNow() {
  const state = await getState()
  const existing = await callApi(api.declarativeNetRequest, 'getDynamicRules')
  const removeRuleIds = existing.map(rule => rule.id)
  const records = ruleRecords(state)
  const requestedRules = records.map(record => record.rule)
  const validation = await supportedDnrRules(requestedRules)
  const addRules = validation.rules
  const metadataById = new Map(records.map(record => [record.rule.id, record]))
  const rejectedRules = validation.rejected.map(rejected => ({ id: rejected.id, reason: rejected.reason || 'unsupported regex' }))
  const diagnostics = { lastGeneratedAt: new Date().toISOString(), lastRuleCount: 0, lastRejectedRules: [], lastError: null }
  try {
    await callApi(api.declarativeNetRequest, 'updateDynamicRules', { removeRuleIds, addRules })
    diagnostics.lastRuleCount = addRules.length
  } catch (error) {
    try {
      const clearRuleIds = Array.from(new Set([...removeRuleIds, ...addRules.map(rule => rule.id)]))
      await callApi(api.declarativeNetRequest, 'updateDynamicRules', { removeRuleIds: clearRuleIds, addRules: [] })
      for (const rule of addRules) {
        try {
          await callApi(api.declarativeNetRequest, 'updateDynamicRules', { removeRuleIds: [], addRules: [rule] })
          diagnostics.lastRuleCount += 1
        } catch (ruleError) {
          rejectedRules.push({ id: rule.id, reason: String(ruleError?.message ?? ruleError) })
        }
      }
    } catch (fallbackError) {
      diagnostics.lastError = String(fallbackError?.message ?? fallbackError ?? error)
    }
  }
  diagnostics.lastRejectedRules = rejectedRules.map(rejected => ({
    id: rejected.id,
    serviceId: metadataById.get(rejected.id)?.serviceId || null,
    serviceName: metadataById.get(rejected.id)?.serviceName || null,
    source: metadataById.get(rejected.id)?.source || null,
    reason: rejected.reason || 'unsupported regex'
  }))
  if (!diagnostics.lastError && diagnostics.lastRejectedRules.length) diagnostics.lastError = `${diagnostics.lastRejectedRules.length} dynamic redirect rules were skipped.`
  return await withStateWrite(latest => {
    latest.diagnostics = { ...latest.diagnostics, ...diagnostics }
    return latest.diagnostics
  })
}

function serviceForOriginal(url) {
  const host = url.hostname.replace(/^www\./, '')
  for (const [id, service] of Object.entries(SERVICE_CATALOG)) {
    if (service.originalHosts.some(candidate => host === candidate.replace(/^www\./, '') || host.endsWith('.' + candidate.replace(/^www\./, '')))) {
      return [id, service]
    }
  }
  return null
}

function applyTemplateRedirect(urlString, state) {
  return diagnoseUrl(urlString, state).redirectUrl
}

function redirectForServiceUrl(serviceId, service, config, url, state, { forceFarside = false } = {}) {
  if (!config?.enabled) return null
  const frontends = serviceFrontends(service, config)
  const frontendId = config.frontend in frontends ? config.frontend : service.defaultFrontend
  const frontend = frontends[frontendId]
  const useFarside = Boolean(forceFarside)
  const rawInstance = useFarside ? farsideBaseUrl(state) : selectedInstance(serviceId, state)
  const instance = frontend.appProtocol ? rawInstance : rawInstance.replace(/\/$/, '')
  const templates = frontend.rules ?? service.rules
  for (const template of templates) {
    const regex = new RegExp(template.source)
    if (!regex.test(url.href)) continue
    const path = useFarside ? farsidePathForFrontend(frontendId, template.path) : template.path
    if (!path) return null
    return {
      url: url.href,
      serviceId,
      serviceName: service.name,
      frontendName: `${frontends[frontendId].name}${useFarside ? ' via Farside' : ''}`,
      routing: useFarside ? 'always' : configuredRouting(service, config, frontendId),
      instance,
      redirectUrl: url.href.replace(regex, templateSubstitution(instance, path)),
      reason: 'matched'
    }
  }
  return null
}

function diagnoseUrl(urlString, state) {
  let url
  try { url = new URL(urlString) } catch { return { url: null, serviceId: null, serviceName: null, frontendName: null, instance: null, routing: null, redirectUrl: null, reverseUrl: null, reason: 'invalid-url' } }
  const reversed = reverseUrl(urlString, state)
  if (isBypassedUrl(url.href, state)) return { url: url.href, serviceId: null, serviceName: null, frontendName: null, instance: null, routing: null, redirectUrl: null, reverseUrl: reversed, reason: 'bypassed' }
  if (!state.globalEnabled) return { url: url.href, serviceId: null, serviceName: null, frontendName: null, instance: null, routing: null, redirectUrl: null, reverseUrl: reversed, reason: 'disabled' }
  for (const [serviceId, service] of Object.entries(SERVICE_CATALOG)) {
    const result = redirectForServiceUrl(serviceId, service, state.services[serviceId], url, state)
    if (result) return { ...result, reverseUrl: reversed }
  }
  return { url: url.href, serviceId: null, serviceName: null, frontendName: null, instance: null, routing: null, redirectUrl: null, reverseUrl: reversed, reason: reversed ? 'frontend' : 'no-match' }
}

function originalUrlForServicePath(serviceId, pathname, search, hash) {
  const service = SERVICE_CATALOG[serviceId]
  if (!service) return null
  const primaryHost = service.originalHosts[0]
  if (serviceId === 'youtube' && pathname.startsWith('/watch')) return `https://www.youtube.com${pathname}${search}`
  if (serviceId === 'youtube' && pathname.startsWith('/embed/')) return `https://www.youtube.com${pathname}${search}`
  if (serviceId === 'wikipedia' && pathname.startsWith('/wiki/')) return `https://en.wikipedia.org${pathname}${search}${hash}`
  if (serviceId === 'fandom') {
    const match = pathname.match(/^\/([^/]+)\/wiki\/(.*)$/)
    if (match) return `https://${match[1]}.fandom.com/wiki/${match[2]}${search}${hash}`
  }
  if (serviceId === 'search' && pathname.startsWith('/search')) return `https://www.google.com${pathname}${search}${hash}`
  if (serviceId === 'maps' && pathname.startsWith('/search')) return `https://maps.google.com${pathname}${search}${hash}`
  return `https://${primaryHost}${pathname}${search}${hash}`
}

function serviceIdForFarsideSegment(segment, state) {
  const match = farsideServiceForPathSegment(segment)
  if (!match) return null
  for (const [serviceId, service] of Object.entries(SERVICE_CATALOG)) {
    const config = state.services[serviceId]
    const frontends = serviceFrontends(service, config)
    if (frontends[match.frontendId]) return serviceId
  }
  return null
}

function reverseFarsideUrl(url, state) {
  if (![farsideBaseUrl(state), DEFAULT_FARSIDE_BASE_URL, 'https://cf.farside.link'].includes(url.origin)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (!parts.length) return null
  const serviceId = serviceIdForFarsideSegment(parts[0], state)
  if (!serviceId) return null
  return originalUrlForServicePath(serviceId, `/${parts.slice(1).join('/')}`, url.search, url.hash)
}

function reverseUrl(urlString, state) {
  let url
  try { url = new URL(urlString) } catch { return null }
  const farsideOriginal = reverseFarsideUrl(url, state)
  if (farsideOriginal) return farsideOriginal
  for (const [serviceId, service] of Object.entries(SERVICE_CATALOG)) {
    const config = state.services[serviceId]
    if (!config) continue
    const frontends = Object.entries(serviceFrontends(service, config))
    for (const [, frontend] of frontends) {
      const instances = [...(config.favoriteInstances ?? []), ...(config.customInstances ?? []), ...frontend.instances]
      for (const instance of instances) {
        let instanceUrl
        try { instanceUrl = new URL(instance) } catch { continue }
        if (url.hostname !== instanceUrl.hostname) continue
        return originalUrlForServicePath(serviceId, url.pathname, url.search, url.hash)
      }
    }
  }
  return null
}

function farsideFallbackRedirect(urlString, state, { respectGlobal = true } = {}) {
  if (respectGlobal && !state?.farsideFallbackEnabled) return null
  let url
  try { url = new URL(urlString) } catch { return null }
  if (url.origin === farsideBaseUrl(state)) return null
  for (const [serviceId, service] of Object.entries(SERVICE_CATALOG)) {
    const config = state.services[serviceId]
    if (!config?.enabled) continue
    const frontends = serviceFrontends(service, config)
    const frontendId = config.frontend in frontends ? config.frontend : service.defaultFrontend
    let selected
    try { selected = new URL(selectedInstance(serviceId, state)) } catch { continue }
    if (url.hostname !== selected.hostname) continue
    const farsidePath = farsidePathForFrontend(frontendId, `${url.pathname}${url.search}${url.hash}`)
    if (farsidePath) return `${farsideBaseUrl(state)}${farsidePath}`
  }
  return null
}

function farsideRedirectForUrl(urlString, state, { respectGlobal = false } = {}) {
  let url
  try { url = new URL(urlString) } catch { return null }
  const fallback = farsideFallbackRedirect(url.href, state, { respectGlobal })
  if (fallback) return fallback
  for (const [serviceId, service] of Object.entries(SERVICE_CATALOG)) {
    const config = state.services[serviceId]
    if (!config?.enabled) continue
    const result = redirectForServiceUrl(serviceId, service, config, url, state, { forceFarside: true })
    if (result?.redirectUrl && result.redirectUrl !== url.href) return result.redirectUrl
  }
  return null
}

function clearFarsideFallbackTimer(tabId) {
  const timer = pendingFarsideFallbacks.get(tabId)
  if (timer) clearTimeout(timer)
  pendingFarsideFallbacks.delete(tabId)
}

function scheduleFarsideFallbackTimer(tabId, url, state, delay = FARSIDE_LOAD_FALLBACK_MS) {
  if (!api.webNavigation?.onCompleted || tabId === undefined || tabId < 0) return
  const target = farsideFallbackRedirect(url, state)
  if (!target) return
  clearFarsideFallbackTimer(tabId)
  const timer = setTimeout(async () => {
    pendingFarsideFallbacks.delete(tabId)
    try {
      if (api.tabs?.get) {
        const tab = await callApi(api.tabs, 'get', tabId)
        if (tab?.url !== url) return
      }
      await apiTabsUpdate(tabId, { url: target })
    } catch {}
  }, delay)
  pendingFarsideFallbacks.set(tabId, timer)
}

function applyProfile(state, profileId) {
  const profiles = { ...PROFILES, ...(state.customProfiles ?? {}) }
  if (!(profileId in profiles)) throw new Error('Unknown profile')
  state.profile = profileId
  const profile = profiles[profileId]
  if (profile.enabledServices === 'all') {
    for (const serviceId of Object.keys(state.services)) state.services[serviceId].enabled = true
  } else if (Array.isArray(profile.enabledServices)) {
    for (const serviceId of Object.keys(state.services)) {
      state.services[serviceId].enabled = profile.enabledServices.includes(serviceId)
    }
  }
  return state
}

async function fetchWithTimeout(url, timeout = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const started = performance.now()
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal })
    const reachable = response.ok || response.type === 'opaque' || (response.status >= 400 && response.status < 500)
    return { ok: reachable, status: response.status || null, latencyMs: Math.round(performance.now() - started), response }
  } finally {
    clearTimeout(timer)
  }
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await worker(items[current], current)
    }
  }))
  return results
}

async function checkInstanceHealth(serviceId, instance) {
  const service = SERVICE_CATALOG[serviceId]
  if (!service) throw new Error('Unknown service')
  const state = await getState()
  const frontendId = Object.entries(serviceFrontends(service, state.services[serviceId])).find(([, frontend]) => frontend.instances.includes(instance))?.[0]
  if (frontendId && serviceFrontends(service, state.services[serviceId])[frontendId].appProtocol) return { ok: true, status: null, latencyMs: null, checkedAt: new Date().toISOString(), error: null }
  const origin = normalizeInstanceOrigin(instance)
  if (!origin) throw new Error('Instance must be an HTTPS URL')
  let health
  try {
    const result = await fetchWithTimeout(origin)
    health = { ...result, checkedAt: new Date().toISOString(), error: null }
  } catch (error) {
    health = { ok: false, status: null, latencyMs: null, checkedAt: new Date().toISOString(), error: String(error?.message ?? error) }
  }
  await withStateWrite(latest => {
    if (!latest.services[serviceId]) return
    latest.services[serviceId].health = { ...(latest.services[serviceId].health ?? {}), [origin]: health }
    latest.diagnostics.lastHealthCheckAt = health.checkedAt
    latest.diagnostics.lastHealthError = health.ok ? null : health.error
  })
  return health
}

async function checkAllSelectedHealth() {
  const state = await getState()
  const entries = Object.entries(state.services).filter(([, config]) => config.enabled)
  const checkedAt = new Date().toISOString()
  const results = {}
  const writes = {}
  await mapConcurrent(entries, BEST_INSTANCE_CONCURRENCY, async ([serviceId]) => {
    const service = SERVICE_CATALOG[serviceId]
    const instance = selectedInstance(serviceId, state)
    const frontend = serviceFrontends(service, state.services[serviceId])[state.services[serviceId].frontend]
    if (frontend?.appProtocol) {
      results[serviceId] = { ok: true, status: null, latencyMs: null, checkedAt, error: null }
      writes[serviceId] = { instance, health: results[serviceId] }
      return
    }
    try {
      const result = await fetchWithTimeout(instance)
      results[serviceId] = { ok: result.ok, status: result.status, latencyMs: result.latencyMs, checkedAt, error: null }
    } catch (error) {
      results[serviceId] = { ok: false, status: null, latencyMs: null, checkedAt, error: String(error?.message ?? error) }
    }
    writes[serviceId] = { instance, health: results[serviceId] }
  })
  await withStateWrite(latest => {
    for (const [serviceId, record] of Object.entries(writes)) {
      if (!latest.services[serviceId]) continue
      latest.services[serviceId].health = { ...(latest.services[serviceId].health ?? {}), [record.instance]: record.health }
    }
    latest.diagnostics.lastHealthCheckAt = checkedAt
    latest.diagnostics.lastHealthError = Object.values(results).find(result => !result.ok)?.error ?? null
  })
  return results
}

async function runSanityCheck() {
  await ensureInitialized({ rebuildIfMissing: true })
  const state = await getState()
  const dynamicRules = api.declarativeNetRequest?.getDynamicRules ? await callApi(api.declarativeNetRequest, 'getDynamicRules') : []
  const sessionRules = api.declarativeNetRequest?.getSessionRules ? await callApi(api.declarativeNetRequest, 'getSessionRules') : []
  const generated = ruleRecords(state)
  const enabled = Object.entries(SERVICE_CATALOG).filter(([serviceId]) => state.services[serviceId]?.enabled)
  const permission = await permissionState()
  const issues = []
  const notes = []
  const checks = []
  const installedRuleCount = dynamicRules.length
  const acceptedRuleCount = state.diagnostics.lastGeneratedAt ? state.diagnostics.lastRuleCount : installedRuleCount
  const skippedUnsupported = /unsupported redirect rules were skipped/i.test(state.diagnostics.lastError || '')
  checks.push({ name: 'Global redirect switch', ok: state.globalEnabled, detail: state.globalEnabled ? 'enabled' : 'disabled' })
  checks.push({ name: 'Safari permission visibility', ok: true, detail: permission.available ? (permission.allUrls ? 'all-sites visible' : 'not visible to extension API') : permission.reason })
  checks.push({ name: 'Enabled services', ok: enabled.length > 0, detail: `${enabled.length} enabled` })
  checks.push({ name: 'Generated rules', ok: generated.length > 0 || enabled.every(([serviceId, service]) => serviceFrontends(service, state.services[serviceId])[state.services[serviceId].frontend]?.appProtocol), detail: `${generated.length} requested dynamic redirect rules` })
  checks.push({ name: 'Installed dynamic rules', ok: installedRuleCount >= acceptedRuleCount, detail: `${installedRuleCount} installed${skippedUnsupported ? ` · ${state.diagnostics.lastError}` : ''}` })
  if (state.diagnostics.lastError && !skippedUnsupported) issues.push(`Rule generator: ${state.diagnostics.lastError}`)
  if (state.diagnostics.lastRejectedRules?.length) issues.push(`Unsupported skipped rules: ${state.diagnostics.lastRejectedRules.map(rule => `${rule.id} ${rule.serviceName || rule.serviceId}: ${rule.reason}`).join('; ')}`)
  if (permission.available && permission.allUrls === false) notes.push('Safari does not expose all-sites permission reliably here. If redirects work, this can be ignored; otherwise check Safari extension website access.')
  if (acceptedRuleCount && installedRuleCount < acceptedRuleCount) issues.push(`Only ${installedRuleCount}/${acceptedRuleCount} accepted dynamic rules are installed. Try Rebuild rules.`)

  const services = enabled.map(([serviceId, service]) => {
    const config = state.services[serviceId]
    const frontends = serviceFrontends(service, config)
    const frontendId = config.frontend in frontends ? config.frontend : service.defaultFrontend
    const frontend = frontends[frontendId]
    const instance = selectedInstance(serviceId, state)
    const templates = frontend.rules ?? service.rules
    const sample = service.sampleUrl || `https://${service.originalHosts[0]}/`
    const diagnosis = diagnoseUrl(sample, state)
    const health = config.health?.[instance] ?? null
    const hasRule = frontend.appProtocol || generated.some(rule => rule.serviceId === serviceId)
    const sampleMatches = Boolean(diagnosis.redirectUrl)
    const ok = hasRule && sampleMatches
    if (!ok) issues.push(`${service.name}: sample URL did not produce a redirect (${sample}).`)
    return {
      serviceId,
      name: service.name,
      frontend: frontend.name,
      instance,
      ok,
      ruleCount: frontend.appProtocol ? templates.length : generated.filter(rule => rule.serviceId === serviceId).length,
      sample,
      sampleRedirect: diagnosis.redirectUrl,
      health: health ? { ok: health.ok, status: health.status, latencyMs: health.latencyMs, error: health.error ?? null, checkedAt: health.checkedAt ?? null } : null
    }
  })
  const healthRecords = services.filter(service => service.health)
  const failedHealth = healthRecords.filter(service => service.health && !service.health.ok)
  if (failedHealth.length) issues.push(`${failedHealth.length} selected instance health checks are failed. This is reachability only; redirects can still work if the instance serves deep links.`)
  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    summary: `${issues.length ? 'Issues found' : 'Looks good'} · ${enabled.length} services · ${dynamicRules.length} installed rules · ${failedHealth.length} failed health checks`,
    checks,
    services,
    issues,
    notes,
    diagnostics: state.diagnostics,
    sessionRuleCount: sessionRules.length
  }
}

async function selectBestInstance(serviceId) {
  await loadPublicInstances()
  const state = await getState()
  const service = SERVICE_CATALOG[serviceId]
  const config = state.services[serviceId]
  if (!service || !config) throw new Error('Unknown service')
  const frontends = serviceFrontends(service, config)
  const frontendId = config.frontend in frontends ? config.frontend : service.defaultFrontend
  const frontend = frontends[frontendId]
  const candidates = Array.from(new Set([...(config.favoriteInstances ?? []), ...(config.customInstances ?? []), ...frontend.instances])).slice(0, 80)
  if (!candidates.length) throw new Error('No instances available')
  if (frontend.appProtocol) {
    const best = { ok: true, status: null, latencyMs: null, checkedAt: new Date().toISOString(), error: null }
    await withStateWrite(latest => {
      if (!latest.services[serviceId]) return
      latest.services[serviceId] = sanitizeServiceUpdate(serviceId, latest.services[serviceId], { instance: candidates[0], mode: 'selected' })
    })
    await rebuildRules()
    return { serviceId, instance: candidates[0], health: best, checked: 1 }
  }
  let best = null
  const health = { ...(config.health ?? {}) }
  const checkedAt = new Date().toISOString()
  const checked = await mapConcurrent(candidates, BEST_INSTANCE_CONCURRENCY, async instance => {
    try {
      const result = await fetchWithTimeout(instance, BEST_INSTANCE_HEALTH_TIMEOUT_MS)
      return { instance, health: { ok: result.ok, status: result.status, latencyMs: result.latencyMs, checkedAt, error: null } }
    } catch (error) {
      return { instance, health: { ok: false, status: null, latencyMs: null, checkedAt, error: String(error?.message ?? error) } }
    }
  })
  for (const record of checked) {
    health[record.instance] = record.health
    if (record.health.ok && (!best || record.health.latencyMs < best.health.latencyMs)) best = record
  }
  if (!best) throw new Error('No reachable instance found')
  await withStateWrite(latest => {
    if (!latest.services[serviceId]) return
    latest.services[serviceId] = sanitizeServiceUpdate(serviceId, latest.services[serviceId], { instance: best.instance, mode: 'selected' })
    latest.services[serviceId].health = { ...(latest.services[serviceId].health ?? {}), ...health }
    latest.diagnostics.lastHealthCheckAt = checkedAt
    latest.diagnostics.lastHealthError = null
  })
  await rebuildRules()
  return { serviceId, instance: best.instance, health: best.health, checked: candidates.length }
}

async function commandState() {
  if (!api.commands?.getAll) return { available: false, commands: [], reason: 'commands.getAll unavailable' }
  try {
    return { available: true, commands: await callApi(api.commands, 'getAll') }
  } catch (error) {
    return { available: false, commands: [], reason: String(error?.message ?? error) }
  }
}

async function permissionState() {
  if (!api.permissions?.contains) {
    return { available: false, allUrls: null, reason: 'permissions.contains unavailable' }
  }
  try {
    return { available: true, allUrls: await callApi(api.permissions, 'contains', { origins: ['<all_urls>'] }) }
  } catch (error) {
    return { available: false, allUrls: null, reason: String(error?.message ?? error) }
  }
}

async function activeTabPermissionState() {
  const tab = await activeTab()
  if (!tab?.url || !api.permissions?.contains) return { available: false, origin: null, granted: null }
  try {
    const origin = new URL(tab.url).origin + '/*'
    return { available: true, origin, granted: await callApi(api.permissions, 'contains', { origins: [origin] }) }
  } catch (error) {
    return { available: false, origin: null, granted: null, reason: String(error?.message ?? error) }
  }
}

async function sendNativeMessage(message) {
  if (!api.runtime.sendNativeMessage) return { ok: false, reason: 'native messaging unavailable' }
  return await new Promise(resolve => {
    let settled = false
    const timer = setTimeout(() => finish({ ok: false, reason: 'native messaging timed out' }), HEALTH_TIMEOUT_MS)
    const finish = response => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(response ?? { ok: false, reason: api.runtime.lastError?.message ?? 'empty native response' })
    }
    try {
      const result = api.runtime.sendNativeMessage(NATIVE_APP_ID, message, finish)
      if (result?.then) result.then(finish, error => finish({ ok: false, reason: String(error?.message ?? error) }))
    } catch (error) {
      try {
        const result = api.runtime.sendNativeMessage(message, finish)
        if (result?.then) result.then(finish, innerError => finish({ ok: false, reason: String(innerError?.message ?? innerError) }))
      } catch (innerError) {
        finish({ ok: false, reason: String(innerError?.message ?? innerError) })
      }
    }
  })
}

async function activeTab() {
  const tabs = await callApi(api.tabs, 'query', { active: true, currentWindow: true })
  return tabs?.[0]
}

async function updateActionIconForTab(tab) {
  const actionApi = api.action ?? api.browserAction
  if (!actionApi?.setIcon) return
  try {
    const state = await getState()
    const diagnosis = tab?.url ? diagnoseUrl(tab.url, state) : null
    const active = Boolean(state.globalEnabled && (diagnosis?.redirectUrl || diagnosis?.reverseUrl))
    const details = { path: active ? TOOLBAR_ICONS.active : TOOLBAR_ICONS.inactive }
    if (tab?.id !== undefined) details.tabId = tab.id
    await callApi(actionApi, 'setIcon', details)
  } catch {}
}

async function updateCurrentActionIcon() {
  try { await updateActionIconForTab(await activeTab()) } catch {}
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function shouldRememberTabUrl(urlString, state) {
  const url = safeHttpUrl(urlString)
  if (!url) return false
  const diagnosis = diagnoseUrl(url, state)
  return !diagnosis.redirectUrl
}

async function finishAppProtocolRedirect(tabId, previousUrl) {
  await new Promise(resolve => setTimeout(resolve, 900))
  const restoreUrl = safeHttpUrl(previousUrl)
  if (restoreUrl) {
    try { await apiTabsUpdate(tabId, { url: restoreUrl }); return } catch {}
  }
  try { if (api.tabs?.remove) await callApi(api.tabs, 'remove', tabId) } catch {}
}

function isAppProtocolRedirect(url) {
  return /^(freetube|materialious):\/\//i.test(String(url || ''))
}

async function openRedirectInTab(tabId, redirected, previousUrl = null) {
  await apiTabsUpdate(tabId, { url: redirected })
  if (isAppProtocolRedirect(redirected)) finishAppProtocolRedirect(tabId, previousUrl)
}

async function redirectNavigationUrl(tabId, url, { rescue = false } = {}) {
  if (tabId === undefined || tabId < 0 || !/^https?:/.test(url || '')) return null
  const state = await getState()
  const redirected = applyTemplateRedirect(url, state)
  if (!redirected || redirected === url) return null

  // Normal web redirects should be handled by DNR before Safari commits the
  // original URL, or by the document_start content script via location.replace.
  // Updating the tab from navigation events can leave the original URL in iOS
  // Safari's back stack, which breaks swipe-back behavior.
  if (!rescue && !isAppProtocolRedirect(redirected)) return redirected

  const key = `${tabId}:${url}`
  const previousAttempt = recentNavigationRedirects.get(key) || 0
  if (!rescue && Date.now() - previousAttempt < 1500) return redirected
  recentNavigationRedirects.set(key, Date.now())
  if (recentNavigationRedirects.size > 80) recentNavigationRedirects.clear()
  await openRedirectInTab(tabId, redirected, tabLastGoodUrls.get(tabId))
  return redirected
}

async function redirectCurrent() {
  const tab = await activeTab()
  if (!tab?.url) return null
  const state = await getState()
  const redirected = applyTemplateRedirect(tab.url, state)
  if (redirected) await openRedirectInTab(tab.id, redirected, tabLastGoodUrls.get(tab.id))
  return redirected
}

async function allowOriginalUrl(tabId, url) {
  const original = safeHttpUrl(url)
  if (!original) return null
  const existing = await callApi(api.declarativeNetRequest, 'getSessionRules')
  const id = SESSION_RULE_ID_BASE + Math.max(1, Number(tabId || 1))
  const removeRuleIds = existing.filter(rule => rule.id === id).map(rule => rule.id)
  const rule = {
    id,
    priority: 100,
    action: { type: 'allow' },
    condition: { regexFilter: bypassRegexForUrl(original), resourceTypes: ['main_frame'] }
  }
  await callApi(api.declarativeNetRequest, 'updateSessionRules', { removeRuleIds, addRules: [rule] })
  const state = await getState()
  state.diagnostics.bypassedUrls = [original, ...(state.diagnostics.bypassedUrls ?? []).filter(value => value !== original)].slice(0, 20)
  await saveState(state)
  return original
}

async function openOriginalInTab(tabId, original) {
  const allowed = await allowOriginalUrl(tabId, original)
  if (allowed) await apiTabsUpdate(tabId, { url: allowed })
  return allowed
}

async function openOriginalInNewTab(original) {
  const safeOriginal = safeHttpUrl(original)
  if (!safeOriginal) return null
  const created = await callApi(api.tabs, 'create', { url: 'about:blank', active: true })
  if (created?.id !== undefined) return openOriginalInTab(created.id, safeOriginal)
  return callApi(api.tabs, 'create', { url: safeOriginal })
}

async function reverseCurrent() {
  const tab = await activeTab()
  if (!tab?.url) return null
  const state = await getState()
  const reversed = reverseUrl(tab.url, state)
  if (reversed) await openOriginalInTab(tab.id, reversed)
  return reversed
}

async function originalForCurrent() {
  const tab = await activeTab()
  if (!tab?.url) return null
  const state = await getState()
  return reverseUrl(tab.url, state) ?? tab.url
}

async function diagnoseCurrent() {
  const tab = await activeTab()
  if (!tab?.url) return null
  const state = await getState()
  return diagnoseUrl(tab.url, state)
}

function bypassHostsForUrl(url) {
  const serviceEntry = serviceForOriginal(url)
  const hosts = serviceEntry ? serviceEntry[1].originalHosts : [url.hostname]
  return Array.from(new Set([url.hostname, ...hosts])).filter(Boolean)
}

function bypassRegexForUrl(value) {
  const url = new URL(value)
  const hosts = bypassHostsForUrl(url).map(escapeRegex).join('|')
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '')
  const pathPattern = path === '/' ? '/?' : `${escapeRegex(path)}/?`
  return `^https?://(${hosts})${pathPattern}([?#].*)?$`
}

function isBypassedUrl(value, state) {
  return (state.diagnostics.bypassedUrls ?? []).some(bypassed => {
    try { return new RegExp(bypassRegexForUrl(bypassed)).test(new URL(value).href) }
    catch { return value === bypassed }
  })
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function bypassCurrent() {
  const tab = await activeTab()
  if (!tab?.url) return null
  const existing = await callApi(api.declarativeNetRequest, 'getSessionRules')
  const removeRuleIds = existing.filter(rule => rule.id >= SESSION_RULE_ID_BASE).map(rule => rule.id)
  if (removeRuleIds.length) await callApi(api.declarativeNetRequest, 'updateSessionRules', { removeRuleIds, addRules: [] })
  const allowed = await allowOriginalUrl(tab.id, tab.url)
  if (allowed) await callApi(api.tabs, 'reload', tab.id)
  return allowed
}

async function clearBypasses() {
  const existing = await callApi(api.declarativeNetRequest, 'getSessionRules')
  const removeRuleIds = existing.filter(rule => rule.id >= SESSION_RULE_ID_BASE).map(rule => rule.id)
  await callApi(api.declarativeNetRequest, 'updateSessionRules', { removeRuleIds, addRules: [] })
  const state = await getState()
  state.diagnostics.bypassedUrls = []
  await saveState(state)
  return { cleared: removeRuleIds.length }
}

let menusCreated = false
let menusCreating = null

async function safeCreateMenu(item) {
  if (!api.contextMenus?.create) return
  await new Promise(resolve => {
    try {
      const result = api.contextMenus.create(item, () => {
        // Consume duplicate-id/other creation errors so Safari does not show
        // unchecked runtime.lastError diagnostics in the extension page.
        lastRuntimeError()
        resolve()
      })
      if (result?.then) result.then(resolve, resolve)
      else if (api === globalThis.browser) resolve()
    } catch {
      resolve()
    }
  })
}

function refreshPublicInstancesInBackground() {
  if (publicInstanceRefreshStarted) return
  publicInstanceRefreshStarted = true
  setTimeout(() => {
    loadPublicInstances().then(() => rebuildRules()).catch(() => {})
  }, 0)
}

async function createMenus() {
  if (!api.contextMenus || menusCreated) return
  if (menusCreating) return menusCreating
  menusCreating = (async () => {
  try {
    if (api.contextMenus.removeAll) await callApi(api.contextMenus, 'removeAll')
  } catch {}
  const items = [
    { id: 'freedirect-redirect', title: localized('menuRedirect', 'Freedirect: Redirect'), contexts: ['page', 'link'] },
    { id: 'freedirect-redirect-new-tab', title: localized('menuRedirectNewTab', 'Freedirect: Redirect in New Tab'), contexts: ['link'] },
    { id: 'freedirect-reverse', title: localized('menuOpenOriginal', 'Freedirect: Open original'), contexts: ['page', 'link'] },
    { id: 'freedirect-reverse-new-tab', title: localized('menuOpenOriginalNewTab', 'Freedirect: Open original in New Tab'), contexts: ['link'] },
    { id: 'freedirect-bypass', title: localized('menuBypass', 'Freedirect: Bypass this URL'), contexts: ['page'] },
    { id: 'freedirect-options', title: localized('menuSettings', 'Freedirect Settings'), contexts: ['action'] }
  ]
  menusCreated = true
  for (const item of items) await safeCreateMenu(item)
  })()
  try { await menusCreating } finally { menusCreating = null }
}

async function ensureInitialized({ rebuildIfMissing = false } = {}) {
  const stored = await storageGet(['freedirectState'])
  if (!stored.freedirectState) {
    await saveState(defaultState())
  } else {
    const migrated = migrateState(stored.freedirectState)
    if (stored.freedirectState.schemaVersion !== migrated.schemaVersion) await saveState(migrated)
  }
  try { await loadPublicInstances({ bundledOnly: true }) } catch {}
  refreshPublicInstancesInBackground()
  await createMenus()
  await updateCurrentActionIcon()
  if (rebuildIfMissing && api.declarativeNetRequest?.getDynamicRules) {
    const state = await getState()
    const existing = await callApi(api.declarativeNetRequest, 'getDynamicRules')
    if (state.globalEnabled && existing.length === 0 && Object.values(state.services).some(service => service.enabled)) {
      await rebuildRules()
    }
  }
}

api.runtime.onInstalled.addListener(async () => {
  await ensureInitialized()
  await rebuildRules()
})

api.runtime.onStartup?.addListener(async () => {
  await ensureInitialized({ rebuildIfMissing: true })
})

api.tabs?.onActivated?.addListener(() => { updateCurrentActionIcon() })
api.tabs?.onUpdated?.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url || tab?.active) updateActionIconForTab(tab)
  try {
    if (changeInfo.url) await redirectNavigationUrl(tabId, changeInfo.url)
    const state = await getState()
    if (tab?.url && shouldRememberTabUrl(tab.url, state)) tabLastGoodUrls.set(tabId, tab.url)
  } catch {}
})
api.webNavigation?.onBeforeNavigate?.addListener(async details => {
  if (details.frameId !== 0 || details.tabId === undefined || !/^https?:/.test(details.url || '')) return
  try {
    const state = await getState()
    scheduleFarsideFallbackTimer(details.tabId, details.url, state)
    await redirectNavigationUrl(details.tabId, details.url)
  } catch {}
})
api.webNavigation?.onCompleted?.addListener(details => {
  if (details.frameId === 0 && details.tabId !== undefined) clearFarsideFallbackTimer(details.tabId)
})
api.webNavigation?.onErrorOccurred?.addListener(async details => {
  if (details.frameId !== 0 || details.tabId === undefined || !/^https?:/.test(details.url || '')) return
  const error = String(details.error || '').toLowerCase()
  clearFarsideFallbackTimer(details.tabId)
  if (/cancel|abort|interrupted|blocked/.test(error)) return
  try {
    const state = await getState()
    if (farsideFallbackRedirect(details.url, state)) scheduleFarsideFallbackTimer(details.tabId, details.url, state, FARSIDE_ERROR_FALLBACK_MS)
    else await redirectNavigationUrl(details.tabId, details.url, { rescue: true })
  } catch {}
})

api.contextMenus?.onClicked?.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url
  const state = await getState()
  if (info.menuItemId === 'freedirect-options') return api.runtime.openOptionsPage()
  if (info.menuItemId === 'freedirect-bypass') return bypassCurrent()
  if (!url) return
  if (info.menuItemId === 'freedirect-redirect') {
    const redirected = applyTemplateRedirect(url, state)
    if (redirected) return openRedirectInTab(tab.id, redirected, tabLastGoodUrls.get(tab.id))
  }
  if (info.menuItemId === 'freedirect-redirect-new-tab') {
    const redirected = applyTemplateRedirect(url, state)
    if (redirected) return callApi(api.tabs, 'create', { url: redirected })
  }
  if (info.menuItemId === 'freedirect-reverse') {
    const reversed = reverseUrl(url, state)
    if (reversed) return openOriginalInTab(tab.id, reversed)
  }
  if (info.menuItemId === 'freedirect-reverse-new-tab') {
    const reversed = reverseUrl(url, state)
    if (reversed) return openOriginalInNewTab(reversed)
  }
})

api.commands?.onCommand?.addListener(command => {
  if (command === 'redirect-current') redirectCurrent()
  if (command === 'reverse-current') reverseCurrent()
  if (command === 'bypass-current') bypassCurrent()
})

api.runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
  ;(async () => {
    const name = message?.name ?? message?.type ?? ''
    if (name === 'freedirectRebuild' || name === 'rebuildRules') {
      return { diagnostics: await rebuildRules() }
    }
    return { ok: true, received: message ?? null }
  })().then(sendResponse, error => sendResponse({ error: String(error?.message ?? error) }))
  return true
})

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    await ensureInitialized({ rebuildIfMissing: true })
    const state = await getState()
    switch (message?.type) {
      case 'getState':
        return { state, catalog: SERVICE_CATALOG, profiles: { ...PROFILES, ...(state.customProfiles ?? {}) }, farside: { baseUrl: farsideBaseUrl(state), supportedFrontends: FARSIDE_FRONTEND_MAP }, limitations: RESEARCHED_LIMITATIONS, permissions: await permissionState(), activeTabPermissions: await activeTabPermissionState() }
      case 'setGlobalEnabled': {
        state.globalEnabled = Boolean(message.enabled)
        await saveState(state)
        const diagnostics = await rebuildRules()
        await updateCurrentActionIcon()
        return { diagnostics }
      }
      case 'setFarsideBaseUrl': {
        state.farsideBaseUrl = normalizeFarsideBaseUrl(message.url)
        await saveState(state)
        return { diagnostics: await rebuildRules(), farsideBaseUrl: state.farsideBaseUrl }
      }
      case 'setFarsideFallbackEnabled': {
        state.farsideFallbackEnabled = Boolean(message.enabled)
        await saveState(state)
        return { farsideFallbackEnabled: state.farsideFallbackEnabled }
      }
      case 'updateService': {
        const service = state.services[message.serviceId]
        if (!service) throw new Error('Unknown service')
        const wasEnabled = Boolean(service.enabled)
        const wantsEnabled = message.patch?.enabled === true
        state.services[message.serviceId] = sanitizeServiceUpdate(message.serviceId, service, message.patch)
        await saveState(state)
        if (wantsEnabled) {
          if (!wasEnabled) {
            try { await selectBestInstance(message.serviceId) } catch { await checkInstanceHealth(message.serviceId, state.services[message.serviceId].instance).catch(() => null) }
          } else {
            const instance = state.services[message.serviceId].instance
            const health = await checkInstanceHealth(message.serviceId, instance).catch(() => ({ ok: false }))
            if (!health?.ok) await selectBestInstance(message.serviceId).catch(() => null)
          }
        }
        const diagnostics = await rebuildRules()
        await updateCurrentActionIcon()
        return { diagnostics }
      }
      case 'applyProfile': {
        applyProfile(state, message.profile)
        await saveState(state)
        const diagnostics = await rebuildRules()
        await updateCurrentActionIcon()
        return { diagnostics }
      }
      case 'saveProfile': {
        const name = String(message.name || '').trim().slice(0, 80)
        if (!name) throw new Error('Profile needs a name')
        const id = `custom-${Date.now()}`
        state.customProfiles = { ...(state.customProfiles ?? {}), [id]: { name, enabledServices: Object.entries(state.services).filter(([, config]) => config.enabled).map(([serviceId]) => serviceId) } }
        state.profile = id
        await saveState(state)
        return { profile: id }
      }
      case 'setAllServices': {
        const enabled = Boolean(message.enabled)
        for (const service of Object.values(state.services)) service.enabled = enabled
        state.profile = 'manual'
        await saveState(state)
        const diagnostics = await rebuildRules()
        await updateCurrentActionIcon()
        return { diagnostics }
      }
      case 'resetState': {
        await saveState(defaultState())
        const diagnostics = await rebuildRules()
        await updateCurrentActionIcon()
        return { diagnostics }
      }
      case 'addCustomInstance': {
        const config = state.services[message.serviceId]
        if (!config) throw new Error('Unknown service')
        const instance = normalizeInstanceOrigin(message.instance)
        if (!instance) throw new Error('Custom instance must be an HTTPS URL')
        const customInstances = Array.from(new Set([instance, ...(config.customInstances ?? [])]))
        state.services[message.serviceId] = sanitizeServiceUpdate(message.serviceId, config, { customInstances, instance })
        await saveState(state)
        return { diagnostics: await rebuildRules() }
      }
      case 'addCustomFrontend': {
        const config = state.services[message.serviceId]
        if (!config) throw new Error('Unknown service')
        const id = sanitizeCustomFrontendId(message.frontendId || message.name)
        if (!id) throw new Error('Custom frontend needs a name')
        const instance = normalizeInstanceOrigin(message.instance)
        if (!instance) throw new Error('Custom frontend instance must be an HTTPS URL')
        const customFrontends = sanitizeCustomFrontends({ ...(config.customFrontends ?? {}), [id]: { name: message.name || id.replace(/^custom:/, ''), instances: [instance] } })
        state.services[message.serviceId] = sanitizeServiceUpdate(message.serviceId, config, { customFrontends, frontend: id, instance })
        await saveState(state)
        return { diagnostics: await rebuildRules() }
      }
      case 'removeCustomFrontend': {
        const config = state.services[message.serviceId]
        if (!config) throw new Error('Unknown service')
        const id = sanitizeCustomFrontendId(String(message.frontendId || '').replace(/^custom:/, ''))
        if (!id || !config.customFrontends?.[id]) throw new Error('Unknown custom frontend')
        const customFrontends = { ...(config.customFrontends ?? {}) }
        delete customFrontends[id]
        const patch = { customFrontends }
        if (config.frontend === id) patch.frontend = SERVICE_CATALOG[message.serviceId].defaultFrontend
        state.services[message.serviceId] = sanitizeServiceUpdate(message.serviceId, config, patch)
        await saveState(state)
        return { diagnostics: await rebuildRules() }
      }
      case 'removeCustomInstance': {
        const config = state.services[message.serviceId]
        if (!config) throw new Error('Unknown service')
        const instance = normalizeInstanceOrigin(message.instance)
        if (!instance) throw new Error('Custom instance must be an HTTPS URL')
        const customInstances = (config.customInstances ?? []).filter(value => value !== instance)
        const favoriteInstances = (config.favoriteInstances ?? []).filter(value => value !== instance)
        const service = SERVICE_CATALOG[message.serviceId]
        const frontends = serviceFrontends(service, config)
        const frontend = config.frontend in frontends ? config.frontend : service.defaultFrontend
        const patch = { customInstances, favoriteInstances }
        if (config.instance === instance) patch.instance = frontends[frontend].instances[0]
        state.services[message.serviceId] = sanitizeServiceUpdate(message.serviceId, config, patch)
        await saveState(state)
        return { diagnostics: await rebuildRules() }
      }
      case 'toggleFavoriteInstance': {
        const config = state.services[message.serviceId]
        if (!config) throw new Error('Unknown service')
        const instance = normalizeInstanceOrigin(message.instance)
        if (!instance) throw new Error('Favorite instance must be an HTTPS URL')
        const favorites = new Set(config.favoriteInstances ?? [])
        if (favorites.has(instance)) favorites.delete(instance)
        else favorites.add(instance)
        state.services[message.serviceId] = sanitizeServiceUpdate(message.serviceId, config, { favoriteInstances: Array.from(favorites) })
        await saveState(state)
        return { favorites: state.services[message.serviceId].favoriteInstances }
      }
      case 'checkInstanceHealth':
        return { health: await checkInstanceHealth(message.serviceId, message.instance) }
      case 'selectBestInstance':
        return { best: await selectBestInstance(message.serviceId) }
      case 'checkAllSelectedHealth':
        return { health: await checkAllSelectedHealth() }
      case 'runSanityCheck':
        return { report: await runSanityCheck() }
      case 'refreshPublicInstances':
        return { instances: await loadPublicInstances({ force: true }) }
      case 'rebuildRules':
        return { diagnostics: await rebuildRules() }
      case 'getRules': {
        const enabledRulesets = api.declarativeNetRequest?.getEnabledRulesets ? await callApi(api.declarativeNetRequest, 'getEnabledRulesets') : []
        return { dynamicRules: await callApi(api.declarativeNetRequest, 'getDynamicRules'), sessionRules: await callApi(api.declarativeNetRequest, 'getSessionRules'), enabledRulesets, rulePreview: rulePreview(state) }
      }
      case 'previewRedirect':
        return { url: applyTemplateRedirect(message.url, state) }
      case 'diagnoseUrl':
        return { diagnosis: diagnoseUrl(message.url, state) }
      case 'farsideFallbackForUrl':
        return { url: farsideFallbackRedirect(message.url, state) }
      case 'farsideForUrl':
        return { url: farsideRedirectForUrl(message.url, state) }
      case 'farsideCurrent': {
        const tab = await activeTab()
        return { url: tab?.url ? farsideRedirectForUrl(tab.url, state) : null }
      }
      case 'openFarsideCurrent': {
        const tab = await activeTab()
        const url = tab?.url ? farsideRedirectForUrl(tab.url, state) : null
        if (url && tab?.id !== undefined) await openRedirectInTab(tab.id, url, tabLastGoodUrls.get(tab.id))
        return { url }
      }
      case 'diagnoseUrls':
        return { diagnoses: (message.urls ?? []).slice(0, 200).map(url => diagnoseUrl(url, state)) }
      case 'diagnoseCurrent':
        return { diagnosis: await diagnoseCurrent() }
      case 'previewReverse':
        return { url: reverseUrl(message.url, state) }
      case 'redirectCurrent':
        return { url: await redirectCurrent() }
      case 'reverseCurrent':
        return { url: await reverseCurrent() }
      case 'originalForCurrent':
        return { url: await originalForCurrent() }
      case 'bypassCurrent':
        return { url: await bypassCurrent() }
      case 'clearBypasses':
        return await clearBypasses()
      case 'exportState':
        return { exported: { format: 'freedirect-state', schemaVersion: state.schemaVersion, exportedAt: new Date().toISOString(), state } }
      case 'importState': {
        const importedState = message.state?.format === 'freedirect-state' ? message.state.state : message.state
        await saveState(migrateState(importedState))
        return { diagnostics: await rebuildRules() }
      }
      case 'requestAllHosts': {
        if (!api.permissions?.request) return { granted: false, reason: 'permissions.request unavailable' }
        const granted = await callApi(api.permissions, 'request', { origins: ['<all_urls>'] })
        const diagnostics = granted ? await rebuildRules() : state.diagnostics
        return { granted, permissions: await permissionState(), diagnostics }
      }
      case 'getPermissions':
        return { permissions: await permissionState(), activeTabPermissions: await activeTabPermissionState() }
      case 'getCommands':
        return await commandState()
      case 'nativePing':
        return await sendNativeMessage({ type: 'ping', at: new Date().toISOString() })
      case 'nativeCapabilities':
        return await sendNativeMessage({ type: 'capabilities', at: new Date().toISOString() })
      default:
        return { error: 'Unknown message type' }
    }
  })().then(sendResponse, error => sendResponse({ error: String(error?.message ?? error) }))
  return true
})
