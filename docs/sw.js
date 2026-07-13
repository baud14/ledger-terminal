// THE LEDGER TERMINAL service worker.
// - shell: precache, CacheFirst (bump VERSION to ship updates)
// - ./data/*.json: NetworkFirst (4s) -> last-good fallback
// - card images (assets.tcgdex.net): CacheFirst with LRU cap
// - api.tcgdex.net: never cached (always live; app has its own catalog fallback)

const VERSION = "v2";
const SHELL_CACHE = `lt-shell-${VERSION}`;
const DATA_CACHE = "lt-data-v1";
const IMG_CACHE = "lt-img-v1";
// OCR engine (~9MB) lives in its own cache so shell VERSION bumps never
// force it to re-download; bump this name only if the vendored files change.
const VENDOR_CACHE = "lt-vendor-v1";
const IMG_MAX_ENTRIES = 300;

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./learn/lessons.json",
  "./src/main.js",
  "./src/router.js",
  "./src/db.js",
  "./src/portfolio.js",
  "./src/snapshots.js",
  "./src/backup.js",
  "./src/ticker.js",
  "./src/sparkline.js",
  "./src/api/data.js",
  "./src/api/tcgdex.js",
  "./src/api/catalog.js",
  "./src/ui/format.js",
  "./src/ui/toast.js",
  "./src/ui/cards.js",
  "./src/screens/home.js",
  "./src/screens/movers.js",
  "./src/screens/mycards.js",
  "./src/screens/sets.js",
  "./src/screens/news.js",
  "./src/screens/learn.js",
  "./src/scan.js",
  "./icons/icon-192.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("lt-shell-") && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName, timeoutMs = 4000) {
  const cache = await caches.open(cacheName);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(req, { signal: ctrl.signal });
    clearTimeout(t);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw new Error("offline, no cache");
  }
}

async function cacheFirstImg(req) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const resp = await fetch(req);
  if (resp.ok) {
    await cache.put(req, resp.clone());
    // LRU-ish cap: evict oldest entries beyond the limit
    const keys = await cache.keys();
    if (keys.length > IMG_MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - IMG_MAX_ENTRIES)) await cache.delete(k);
    }
  }
  return resp;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.hostname === "api.tcgdex.net") return; // always live

  if (url.hostname === "assets.tcgdex.net") {
    e.respondWith(cacheFirstImg(e.request));
    return;
  }

  if (url.origin === location.origin) {
    if (url.pathname.includes("/data/")) {
      e.respondWith(networkFirst(e.request, DATA_CACHE));
      return;
    }
    if (url.pathname.includes("/vendor/")) {
      // OCR assets: CacheFirst into the persistent vendor cache
      e.respondWith((async () => {
        const cache = await caches.open(VENDOR_CACHE);
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      })());
      return;
    }
    // shell: cache first, network fallback (and populate on miss)
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      const resp = await fetch(e.request);
      if (resp.ok) (await caches.open(SHELL_CACHE)).put(e.request, resp.clone());
      return resp;
    })());
  }
});
