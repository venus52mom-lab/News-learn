// 離線快取：一律先抓網路上的最新版（不吃瀏覽器快取），沒網路才用快取
const V = "fx-v14";
const SHELL = ["./", "index.html", "style.css?v=14", "app.js?v=14", "catalog.json", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;            // 鉅亨網、翻譯等外部網址不經過快取
  const key = u.pathname.includes("/data/") ? u.origin + u.pathname : e.request;
  e.respondWith(fetch(e.request, {cache: "no-cache"}).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(key, c)); }
    return r;
  }).catch(() => caches.match(key)));
});
