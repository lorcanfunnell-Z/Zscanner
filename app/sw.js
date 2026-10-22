// Offline support: keeps the page, chocolate data and models on the phone after the first visit.
// Bump VERSION whenever any file changes so phones pick up the new version.
const VERSION = "scanner-v19";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "recognizer.js", "install.js", "collect.js", "debuglog.js", "admin.html", "admin.js", "vendor/jszip.min.js", "manifest.webmanifest",
  "data/chocolates.js", "model4/meta.json", "model4/finder/model.json", "model4/finder/weights.bin", "model4/reader/model.json", "model4/reader/weights.bin",
  "vendor/tf.min.js", 
  "icons/icon-192.png", "icons/apple-touch-icon.png",
  ...["zdark", "zmilk", "zwhite", ...Array.from({ length: 25 }, (_, i) => String(i))].map(k => `images/${k}.jpg`)
];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  // Network first, so updates show straight away; the saved copy is only used offline
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
