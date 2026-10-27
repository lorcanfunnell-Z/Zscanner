// Offline support and speed: keeps the page, chocolate data and models on the phone after the first visit.
// Bump VERSION whenever a page/code file changes so phones pick up the new version.
// Bump MODEL_VERSION only when a model file changes: models are big (several MB) and are loaded from the phone
// after the first visit (cache first), so a second visit doesn't download them again.
const VERSION = "scanner-v36";
const MODEL_VERSION = "models-6.1";
const isModel = url => /\/(model\d+\/|vendor\/tf\.min\.js|vendor\/mnv2\/)/.test(url) && !/meta\.json/.test(url);   // settings (meta.json) always fresh
const FILES = [
  "./", "index.html", "styles.css", "app.js", "recognizer.js", "install.js", "collect.js", "debuglog.js", "admin.html", "admin.js", "vendor/jszip.min.js", "manifest.webmanifest",
  "data/chocolates.js",   // models (model6) are saved on the phone the first time they load (cache first, below)
  "vendor/tf.min.js", 
  "icons/icon-192.png", "icons/apple-touch-icon.png",
  ...["zdark", "zmilk", "zwhite", ...Array.from({ length: 25 }, (_, i) => String(i))].map(k => `images/${k}.jpg`)
];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== MODEL_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  // Models: from the phone if saved (cache first), else download once and save
  if (isModel(e.request.url)) {
    e.respondWith(caches.open(MODEL_VERSION).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  // Everything else: network first, so updates show straight away; the saved copy is only used offline
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
