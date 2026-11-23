// myTube service worker：沒網路時也能打開；有網路時一定拿最新版（不用 iPhone 舊的快取）
const VER = '20261124e';
const CACHE = 'mytube-' + VER;
const SHELL = ['./', 'index.html', 'styles.css?v=' + VER, 'app.js?v=' + VER, 'books.js?v=' + VER, 'studio.js?v=' + VER, 'vendor/ffmpeg/ffmpeg.js', 'vendor/ffmpeg/814.ffmpeg.js', 'vendor/ffmpeg/util.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mytube-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  // 網路優先，而且跳過 iPhone 的瀏覽器快取（no-store），才不會拿到新舊混在一起的檔案
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
