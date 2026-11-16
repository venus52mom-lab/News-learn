// 離線快取：App 本體先用快取，匯率資料先抓網路、失敗才用快取
const V = "fx-v8";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.pathname.includes("/data/")) {
    const key = u.origin + u.pathname;
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(key, c)); return r; })
      .catch(() => caches.match(key)));
  } else {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request)));
  }
});
