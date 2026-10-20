// Offline support: keeps the page, chocolate data and models on the phone after the first visit.
// Bump VERSION whenever any file changes so phones pick up the new version.
const VERSION = "scanner-v1";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "recognizer.js", "install.js", "manifest.webmanifest",
  "data/chocolates.js", "model/labels.json", "model/head/model.json", "model/head/weights.bin",
  "vendor/tf.min.js", "vendor/mobilenet/model.json",
  "vendor/mobilenet/group1-shard1of3.bin", "vendor/mobilenet/group1-shard2of3.bin", "vendor/mobilenet/group1-shard3of3.bin",
  "icons/icon-192.png", "icons/apple-touch-icon.png",
  ...["zdark", "zmilk", "zwhite", ...Array.from({ length: 25 }, (_, i) => String(i))].map(k => `images/${k}.jpg`)
];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
