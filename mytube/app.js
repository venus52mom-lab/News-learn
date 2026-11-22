/* =========================================================
   myTube — 個人影音庫 + YouTube 下載器（PWA）
   ========================================================= */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// localStorage 都加上 mytube_ 前綴，避免跟同網站的其他 App 互相干擾
const LS = {
  get: k => { try { return localStorage.getItem('mytube_' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('mytube_' + k, v); } catch {} },
  del: k => { try { localStorage.removeItem('mytube_' + k); } catch {} },
  clearAll: () => { try { Object.keys(localStorage).filter(k => k.startsWith('mytube_')).forEach(k => localStorage.removeItem(k)); } catch {} },
};
const isMobile = () => isIOS() || /Android/i.test(navigator.userAgent);

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

/* ---------------- IndexedDB ---------------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('mytube', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('media', { keyPath: 'id' });   // 影音資料（不含檔案本體）
      d.createObjectStore('blobs');                      // 影音檔案本體
      d.createObjectStore('playlists', { keyPath: 'id' });
      d.createObjectStore('history', { keyPath: 'id' });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('儲存空間不足或被中止'));
    });
  };
  return {
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, v, k) => tx(s, 'readwrite', st => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    clear: s => tx(s, 'readwrite', st => st.clear()),
  };
})();

/* ---------------- 狀態 ---------------- */
const S = {
  media: [], playlists: [], history: [],
  page: 'video', filter: { video: 'all', audio: 'all' },
  fmt: 'mp4', dirHandle: null,
};
const urlCache = new Map();   // media id -> blob URL
const thumbCache = new Map(); // media id -> thumb URL
const fileCache = new Map();  // media id -> File（給 iPhone 分享用，需同步取得）

function mediaURLSync(id) { return urlCache.get(id); }
async function mediaURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await DB.get('blobs', id);
  if (!b) throw new Error('找不到檔案');
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}
function thumbURL(m) {
  if (thumbCache.has(m.id)) return thumbCache.get(m.id);
  const u = m.thumb ? URL.createObjectURL(m.thumb) : placeholderArt(m);
  thumbCache.set(m.id, u);
  return u;
}
function hl(text) {
  const q = (S.query || '').trim();
  const t = esc(text);
  if (!q) return t;
  const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return t.replace(re, x => `<mark>${x}</mark>`);
}
function emptyMsg(type, normal, inPl) {
  if ((S.query || '').trim()) return `找不到符合「${esc(S.query.trim())}」的${type === 'video' ? '影片' : '音樂'}`;
  return S.filter[type] === 'all' ? normal : inPl;
}
function placeholderArt(m) {
  let h = 0; for (const c of m.title || 'x') h = (h * 31 + c.charCodeAt(0)) % 360;
  const icon = m.type === 'audio'
    ? '<path d="M44 70V36l26-5v31" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="37" cy="70" r="8" fill="#fff"/><circle cx="63" cy="62" r="8" fill="#fff"/>'
    : '<path d="M42 34l26 16-26 16z" fill="#fff"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},70%,35%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>${icon}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---------------- 小工具 ---------------- */
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function fmtSize(b) {
  if (!b) return '';
  if (b > 1 << 30) return (b / (1 << 30)).toFixed(2) + ' GB';
  if (b > 1 << 20) return (b / (1 << 20)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}
function fmtAgo(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return '剛剛';
  if (d < 3600) return Math.floor(d / 60) + ' 分鐘前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小時前';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
  return new Date(t).toLocaleDateString();
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function safeName(s) { return (s || 'myTube').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 120) || 'myTube'; }
function fileName(m) {
  if (m.filename) return m.filename;
  const ext = m.type === 'audio' ? (m.mime?.includes('mpeg') || !m.mime ? 'mp3' : (m.mime.split('/')[1] || 'mp3')) : (m.mime?.includes('quicktime') ? 'mov' : 'mp4');
  return `${safeName(m.title)}.${ext}`;
}

/* ---------------- 深色 / 淺色模式 ---------------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#themeColorMeta').content = t === 'dark' ? '#0f0f0f' : '#ffffff';
  LS.set('theme', t);
}
applyTheme(LS.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ---------------- 分頁 ---------------- */
function showPage(p) {
  S.page = p;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === p));
  $$('.page').forEach(x => x.classList.toggle('active', x.id === 'page-' + p));
  window.scrollTo({ top: 0 });
  LS.set('page', p);
  Preview.stop(true);
  if (p === 'download') refreshStorageInfo();
  requestAnimationFrame(() => Preview.check());
}
$$('.tab').forEach(t => t.onclick = () => showPage(t.dataset.page));
$('#logoBtn').onclick = () => showPage('video');

/* ---------------- 媒體資料 ---------------- */
function probeVideo(blob) {
  return new Promise(res => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const u = URL.createObjectURL(blob);
    let done = false;
    const finish = (thumb, dur) => {
      if (done) return; done = true;
      URL.revokeObjectURL(u); v.removeAttribute('src'); v.load();
      res({ thumb, duration: isFinite(dur) ? dur : 0 });
    };
    v.onloadedmetadata = () => { v.currentTime = Math.min(1.5, (v.duration || 3) / 3); };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 480; c.height = Math.round(480 * (v.videoHeight || 9) / (v.videoWidth || 16));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => finish(b, v.duration), 'image/jpeg', 0.75);
      } catch { finish(null, v.duration); }
    };
    v.onerror = () => finish(null, 0);
    setTimeout(() => finish(null, v.duration), 10000);
    v.src = u; v.load();
  });
}
function probeAudio(blob) {
  return new Promise(res => {
    const a = new Audio(); const u = URL.createObjectURL(blob);
    let done = false;
    const fin = d => { if (done) return; done = true; URL.revokeObjectURL(u); res(isFinite(d) ? d : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(a.duration);
    a.onerror = () => fin(0);
    setTimeout(() => fin(a.duration), 6000);
    a.src = u;
  });
}

async function addMedia(blob, meta) {
  const id = uid();
  let { thumb = null, duration = 0 } = meta;
  if (meta.type === 'video') {
    const p = await probeVideo(blob);
    if (!thumb) thumb = p.thumb;
    if (!duration) duration = p.duration;
  } else if (!duration) duration = await probeAudio(blob);
  const m = {
    id, type: meta.type, title: meta.title || '未命名', created: Date.now(), size: blob.size,
    duration, thumb, source: meta.source, mime: blob.type, filename: meta.filename || null,
  };
  await DB.put('blobs', blob, id);
  await DB.put('media', m);
  S.media.push(m);
  if (blob instanceof File) fileCache.set(id, blob);
  else fileCache.set(id, new File([blob], fileName(m), { type: blob.type || (m.type === 'video' ? 'video/mp4' : 'audio/mpeg') }));
  navigator.storage?.persist?.();
  renderLibrary(m.type);
  return m;
}

async function deleteMedia(id) {
  const m = S.media.find(x => x.id === id); if (!m) return;
  if (P.item?.id === id) Player.close();
  await DB.del('blobs', id); await DB.del('media', id);
  S.media = S.media.filter(x => x.id !== id);
  for (const pl of S.playlists) if (pl.items.includes(id)) { pl.items = pl.items.filter(x => x !== id); await DB.put('playlists', pl); }
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  thumbCache.delete(id); fileCache.delete(id);
  renderLibrary(m.type);
  toast('已刪除');
}

/* 自動分辨：影片 or 音樂（看檔案內容有沒有畫面） */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|weba|caf|aiff?)$/i;
async function isMpegTS(file) {
  try { const b = new Uint8Array(await file.slice(0, 377).arrayBuffer()); return b[0] === 0x47 && b[188] === 0x47; } catch { return false; }
}
function hasPicture(file) {
  return new Promise(res => {
    const v = document.createElement('video'); const u = URL.createObjectURL(file);
    let done = false; const fin = r => { if (done) return; done = true; URL.revokeObjectURL(u); v.removeAttribute('src'); v.load(); res(r); };
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onloadedmetadata = () => fin(v.videoWidth > 0 ? 'video' : 'audio');
    v.onerror = () => fin('unknown');
    setTimeout(() => fin(v.videoWidth > 0 ? 'video' : 'unknown'), 8000);
    v.src = u;
  });
}
async function detectType(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  const r = await hasPicture(file);
  if (r !== 'unknown') return r;
  return t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name) ? 'video' : 'audio';
}
async function importFiles(files) {
  const list = [...files]; if (!list.length) return;
  let n = 0; const cnt = { video: 0, audio: 0 }; const bad = [];
  for (const f of list) {
    toast(`正在載入 ${++n}/${list.length}…`, 60000);
    try {
      if (await isMpegTS(f)) { bad.push(f.name); continue; }
      const type = await detectType(f);
      await addMedia(f, { type, title: f.name.replace(/\.[^.]+$/, ''), source: 'import', filename: f.name });
      cnt[type]++;
    } catch (e) { console.error(e); toast('載入失敗：' + (e.message || e)); await sleep(1500); }
  }
  const parts = [];
  if (cnt.video) parts.push(`${cnt.video} 個影片（在「影片」）`);
  if (cnt.audio) parts.push(`${cnt.audio} 個音樂（在「音樂」）`);
  if (bad.length) {
    openSheet(`<h4>有 ${bad.length} 個檔案無法播放</h4>
      <p class="hint" style="padding:0 20px">${bad.map(esc).join('<br>')}<br><br>這是 YouTube 的串流格式（TS），iPhone 網頁播不了。請在 a-Shell 先更新下載程式再重新下載：<br><code>curl -sLo mt.py https://raw.githubusercontent.com/venus52mom-lab/News-learn/main/mytube/tools/mt.py</code></p>
      <button class="sheet-item" data-a="ok">知道了</button>`);
  }
  if (parts.length) toast('已載入 ' + parts.join('、'), 3500);
  if (cnt.video && !cnt.audio && S.page === 'audio') showPage('video');
  if (cnt.audio && !cnt.video && S.page === 'video') showPage('audio');
}
async function onImport(e, type) {
  const files = e.target.files; const hid = S.pendingImport; S.pendingImport = null;
  const before = S.media.length;
  await importFiles(files); e.target.value = '';
  const h = hid && S.history.find(x => x.id === hid);
  if (h && S.media.length > before) {
    const m = S.media[S.media.length - 1];
    setH(h, { status: 'imported', mediaId: m.id, title: m.title, size: m.size });
  }
}
$('#importVideo').onchange = e => onImport(e, 'video');
$('#importAudio').onchange = e => onImport(e, 'audio');

/* ---------------- 播放清單 ---------------- */
function currentList(type) {
  const f = S.filter[type];
  const q = (S.query || '').trim().toLowerCase();
  const items = S.media.filter(m => m.type === type && (!q || (m.title || '').toLowerCase().includes(q)));
  if (f !== 'all') {
    const pl = S.playlists.find(p => p.id === f);
    if (pl) return pl.items.map(id => items.find(m => m.id === id)).filter(Boolean);
    S.filter[type] = 'all';
  }
  return items.sort((a, b) => b.created - a.created);
}
async function createPlaylist(type, name) {
  const pl = { id: uid(), type, name: name.trim() || '新的播放清單', items: [], created: Date.now() };
  S.playlists.push(pl); await DB.put('playlists', pl);
  renderChips(type);
  return pl;
}
async function togglePlaylistItem(pl, id) {
  if (pl.items.includes(id)) pl.items = pl.items.filter(x => x !== id);
  else pl.items.push(id);
  await DB.put('playlists', pl);
  renderLibrary(pl.type);
}

/* ---------------- 繪製：分類 chips ---------------- */
function renderChips(type) {
  const box = $(type === 'video' ? '#videoChips' : '#audioChips');
  const pls = S.playlists.filter(p => p.type === type);
  const f = S.filter[type];
  box.innerHTML =
    `<button class="chip ${f === 'all' ? 'active' : ''}" data-f="all">全部</button>` +
    pls.map(p => `<button class="chip ${f === p.id ? 'active' : ''}" data-f="${p.id}">${esc(p.name)} · ${p.items.length}</button>`).join('') +
    `<button class="chip add" data-f="+">${ICON.plus}新增播放清單</button>`;
  box.onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    if (c.dataset.f === '+') return promptSheet('新增播放清單', '', async name => {
      const pl = await createPlaylist(type, name); S.filter[type] = pl.id; renderLibrary(type);
    });
    S.filter[type] = c.dataset.f; renderLibrary(type);
  };
  const head = $(type === 'video' ? '#videoPlHead' : '#audioPlHead');
  const pl = pls.find(p => p.id === f);
  head.hidden = !pl;
  if (pl) {
    head.innerHTML = `<span class="pl-name">${esc(pl.name)}</span>
      <button class="pill-btn" data-a="play">${ICON.play}播放</button>
      <button class="more-btn" data-a="more">${ICON.more}</button>`;
    head.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'play') { const l = currentList(type); if (l.length) Player.playList(l, 0); else toast('清單是空的'); }
      if (a === 'more') openSheet(`<h4>${esc(pl.name)}</h4>
        <button class="sheet-item" data-a="shuffle">🔀 隨機播放</button>
        <button class="sheet-item" data-a="rename">✏️ 重新命名</button>
        <button class="sheet-item danger" data-a="del">🗑️ 刪除播放清單</button>`, async a => {
        if (a === 'shuffle') { const l = currentList(type); if (l.length) { P.shuffle = true; Player.playList(l, Math.floor(Math.random() * l.length)); } }
        if (a === 'rename') promptSheet('重新命名', pl.name, async n => { pl.name = n.trim() || pl.name; await DB.put('playlists', pl); renderLibrary(type); });
        if (a === 'del') {
          S.playlists = S.playlists.filter(p => p.id !== pl.id); await DB.del('playlists', pl.id);
          S.filter[type] = 'all'; renderLibrary(type); toast('已刪除播放清單（影片/音樂本身不會刪除）');
        }
      });
    };
  }
}

/* ---------------- 繪製：影片 feed ---------------- */
function renderVideos() {
  renderChips('video');
  const list = currentList('video');
  const feed = $('#videoFeed');
  Preview.stop(true);
  if (!list.length) {
    feed.innerHTML = `<div class="empty">${ICON.video}<div>${emptyMsg('video',
      '還沒有影片<br>到「下載」貼上 YouTube 網址，或按上面「載入手機裡的影片」',
      '這個播放清單還沒有影片<br>在影片的「⋯」選「加入播放清單」')}</div></div>`;
    return;
  }
  feed.innerHTML = list.map(m => `
    <article class="vcard" data-id="${m.id}">
      <div class="vthumb" data-a="play">
        <img src="${thumbURL(m)}" alt="" loading="lazy">
        <span class="muted-ic">${ICON.mute}</span>
        <span class="dur">${fmtTime(m.duration)}</span>
        <div class="pbar"></div>
      </div>
      <div class="vmeta">
        <div class="avatar">${esc((m.title || '?').trim()[0] || '?')}</div>
        <div class="vtext" data-a="play">
          <div class="vtitle">${hl(m.title)}</div>
          <div class="vsub">${m.source === 'download' ? 'YouTube 下載' : '手機匯入'} · ${fmtSize(m.size)} · ${fmtAgo(m.created)}</div>
        </div>
        <button class="more-btn" data-a="more">${ICON.more}</button>
      </div>
    </article>`).join('');
  feed.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const id = e.target.closest('.vcard').dataset.id;
    if (a === 'play') Player.playList(currentList('video'), currentList('video').findIndex(m => m.id === id));
    if (a === 'more') itemMenu(id);
  };
  requestAnimationFrame(() => Preview.check());
}

/* ---------------- 繪製：音樂列表 ---------------- */
function musicRow(m, playing) {
  return `<div class="mrow ${playing ? 'playing' : ''}" data-id="${m.id}">
    <img class="mart" src="${thumbURL(m)}" alt="" loading="lazy">
    <div class="mtext" data-a="play">
      <div class="mtitle">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}${hl(m.title)}</div>
      <div class="msub">${m.type === 'video' ? '影片 · ' : ''}${fmtTime(m.duration)} · ${fmtSize(m.size)}</div>
    </div>
    <button class="more-btn" data-a="more">${ICON.more}</button>
  </div>`;
}
function renderAudio() {
  renderChips('audio');
  const list = currentList('audio');
  const box = $('#audioList');
  if (!list.length) {
    box.innerHTML = `<div class="empty">${ICON.music}<div>${emptyMsg('audio',
      '還沒有音樂<br>到「下載」選 MP3 下載，或按上面「載入手機裡的音樂」',
      '這個播放清單還沒有音樂<br>在音樂的「⋯」選「加入播放清單」')}</div></div>`;
    return;
  }
  box.innerHTML = list.map(m => musicRow(m, P.item?.id === m.id)).join('');
  box.onclick = e => {
    const row = e.target.closest('.mrow'); if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-a="more"]')) return itemMenu(id);
    const l = currentList('audio');
    Player.playList(l, l.findIndex(m => m.id === id));
  };
}
function renderLibrary(type) {
  if (!type || type === 'video') renderVideos();
  if (!type || type === 'audio') renderAudio();
}
$('#videoPlayAll').onclick = () => { const l = currentList('video'); if (l.length) { P.shuffle = false; Player.playList(l, 0); } else toast('還沒有影片'); };
$('#audioPlayAll').onclick = () => { const l = currentList('audio'); if (l.length) { P.shuffle = false; Player.playList(l, 0); } else toast('還沒有音樂'); };
$('#audioShuffle').onclick = () => { const l = currentList('audio'); if (l.length) { P.shuffle = true; Player.playList(l, Math.floor(Math.random() * l.length)); } else toast('還沒有音樂'); };

/* ---------------- 底部選單 ---------------- */
function openSheet(html, onAction) {
  const sh = $('#sheet'), bd = $('#sheetBackdrop');
  sh.innerHTML = html; sh.hidden = false; bd.hidden = false;
  const close = () => { sh.hidden = true; bd.hidden = true; sh.onclick = null; };
  bd.onclick = close;
  sh.onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.keep === undefined) close();
    onAction?.(b.dataset.a, b);
  };
  return { el: sh, close };
}
function promptSheet(title, value, onOk) {
  const s = openSheet(`<h4>${esc(title)}</h4>
    <div class="sheet-input"><input id="sheetInput" value="${esc(value)}" placeholder="名稱"><button class="pill-btn" data-a="ok">確定</button></div>`,
    a => { if (a === 'ok') onOk($('#sheetInput').value); });
  const inp = $('#sheetInput'); setTimeout(() => inp.focus(), 50);
  inp.onkeydown = e => { if (e.key === 'Enter') { s.close(); onOk(inp.value); } };
}
function itemMenu(id) {
  const m = S.media.find(x => x.id === id); if (!m) return;
  const f = S.filter[m.type];
  openSheet(`<h4>${esc(m.title)}</h4>
    <button class="sheet-item" data-a="play">▶️ 播放</button>
    <button class="sheet-item" data-a="bg">🎧 背景播放（只聽聲音）</button>
    <button class="sheet-item" data-a="pl">➕ 加入播放清單</button>
    ${f !== 'all' ? '<button class="sheet-item" data-a="unpl">➖ 從這個清單移除</button>' : ''}
    <button class="sheet-item" data-a="save">📁 存到裝置（檔案 App）</button>
    <button class="sheet-item" data-a="rename">✏️ 重新命名</button>
    <button class="sheet-item danger" data-a="del">🗑️ 從 myTube 刪除</button>`, async a => {
    const list = currentList(m.type), i = list.findIndex(x => x.id === id);
    if (a === 'play') Player.playList(list, i);
    if (a === 'bg') { P.bgVideo = m.type === 'video'; Player.playList(list, i, { mini: true }); }
    if (a === 'pl') playlistSheet(m);
    if (a === 'unpl') { const pl = S.playlists.find(p => p.id === f); if (pl) togglePlaylistItem(pl, id); }
    if (a === 'save') saveFlow(m);
    if (a === 'rename') promptSheet('重新命名', m.title, async n => {
      m.title = n.trim() || m.title; m.filename = null; fileCache.delete(m.id);
      await DB.put('media', m); renderLibrary(m.type); if (P.item?.id === m.id) Player.updateUI();
    });
    if (a === 'del') openSheet(`<h4>確定刪除「${esc(m.title)}」？</h4>
      <button class="sheet-item danger" data-a="yes">刪除</button><button class="sheet-item" data-a="no">取消</button>`,
      b => { if (b === 'yes') deleteMedia(id); });
  });
}
function playlistSheet(m) {
  const draw = () => {
    const pls = S.playlists.filter(p => p.type === m.type);
    return `<h4>加入播放清單（${m.type === 'video' ? '影片' : '音樂'}）</h4>
      ${pls.map(p => `<label class="sheet-item" data-a="t:${p.id}" data-keep><input type="checkbox" ${p.items.includes(m.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('') || '<p class="hint" style="padding:0 20px">還沒有播放清單</p>'}
      <div class="sheet-input"><input id="newPlName" placeholder="新播放清單名稱"><button class="pill-btn" data-a="new" data-keep>建立並加入</button></div>
      <button class="sheet-item" data-a="done">完成</button>`;
  };
  const s = openSheet(draw(), async (a, el) => {
    if (a.startsWith('t:')) {
      const pl = S.playlists.find(p => p.id === a.slice(2));
      setTimeout(async () => { const want = el.querySelector('input').checked; if (want !== pl.items.includes(m.id)) await togglePlaylistItem(pl, m.id); }, 0);
    }
    if (a === 'new') {
      const name = $('#newPlName').value.trim(); if (!name) return toast('請輸入名稱');
      const pl = await createPlaylist(m.type, name); await togglePlaylistItem(pl, m.id);
      s.el.innerHTML = draw(); toast(`已加入「${name}」`);
    }
  });
}

/* ---------------- 滑到螢幕中間自動預覽 5 秒 ---------------- */
const Preview = {
  card: null, video: null, timer: null, finished: false,
  check() {
    if (S.page !== 'video' || $('#player').classList.contains('full') || document.hidden) return this.stop(true);
    // 正在播放影片/音樂時不跑預覽（iPhone 播另一個影片可能會把正在播的暫停）
    if (P.item && !Player.active().paused) return this.stop(true);
    const mid = innerHeight / 2;
    let best = null, bd = Infinity;
    for (const c of $$('#videoFeed .vcard')) {
      const r = c.querySelector('.vthumb').getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < r.height * 0.75 && d < bd) { bd = d; best = c; }
    }
    if (best !== this.card) { this.stop(true); if (best) this.start(best); }
  },
  async start(card) {
    this.card = card; this.finished = false;
    const id = card.dataset.id;
    let url; try { url = await mediaURL(id); } catch { return; }
    if (this.card !== card) return;
    const th = card.querySelector('.vthumb');
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto'; v.src = url;
    th.insertBefore(v, th.querySelector('.muted-ic'));
    this.video = v;
    const bar = th.querySelector('.pbar');
    v.addEventListener('playing', () => {
      th.classList.add('previewing');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.end(), 5000);
    }, { once: true });
    v.ontimeupdate = () => { bar.style.width = Math.min(100, v.currentTime / 5 * 100) + '%'; };
    v.play().catch(() => {});
  },
  end() { // 預覽 5 秒結束：停在縮圖，直到滑到下一部
    this.finished = true; this.cleanup();
  },
  cleanup() {
    clearTimeout(this.timer);
    if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove(); this.video = null; }
    if (this.card) { const th = this.card.querySelector('.vthumb'); th.classList.remove('previewing'); th.querySelector('.pbar').style.width = '0'; }
  },
  stop(reset) { this.cleanup(); if (reset) this.card = null; },
};
let scrollRaf;
addEventListener('scroll', () => { cancelAnimationFrame(scrollRaf); scrollRaf = requestAnimationFrame(() => Preview.check()); }, { passive: true });
addEventListener('resize', () => Preview.check());

/* =========================================================
   播放器：影片 / 音樂 / 背景播放 / 縮小 / 子母畫面
   ========================================================= */
const videoEl = $('#videoEl'), audioEl = $('#audioEl'), playerBox = $('#player');
videoEl.setAttribute('autopictureinpicture', '');
const P = { queue: [], idx: -1, item: null, bgVideo: false, shuffle: false, repeat: 0, view: 'hidden', history: [] };

const Player = {
  active() { return (P.item?.type === 'audio' || P.bgVideo) ? audioEl : videoEl; },

  playList(items, idx = 0, opts = {}) {
    if (!items.length || idx < 0) return;
    P.queue = items.map(m => m.id); P.idx = idx; P.history = [];
    if (!opts.mini) P.bgVideo = false;
    this.load(true);
    opts.mini ? this.minimize() : this.openFull();
  },

  load(autoplay, startAt = 0) {
    const m = S.media.find(x => x.id === P.queue[P.idx]); if (!m) return;
    P.item = m;
    const go = url => {
      const target = this.active(), other = target === audioEl ? videoEl : audioEl;
      other.pause(); if (other.getAttribute('src')) { other.removeAttribute('src'); other.load(); }
      target.src = url;
      if (startAt) target.addEventListener('loadedmetadata', () => { try { target.currentTime = startAt; } catch {} }, { once: true });
      if (autoplay) target.play().catch(err => { if (err.name !== 'AbortError') console.warn(err); });
      this.updateUI(); this.setSession();
    };
    const u = mediaURLSync(m.id);
    if (u) go(u); else mediaURL(m.id).then(go).catch(e => toast('無法播放：' + e.message));
  },

  toggle() {
    const el = this.active();
    if (!el.getAttribute('src')) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  },

  next(auto = false) {
    if (!P.queue.length) return;
    let i;
    if (P.shuffle && P.queue.length > 1) {
      do { i = Math.floor(Math.random() * P.queue.length); } while (i === P.idx);
      P.history.push(P.idx);
    } else {
      i = P.idx + 1;
      if (i >= P.queue.length) {
        if (P.repeat === 1) i = 0;
        else { if (auto) { this.updateUI(); } else toast('已經是最後一個'); return; }
      }
    }
    P.idx = i; this.load(true);
  },
  prev() {
    const el = this.active();
    if (el.currentTime > 3) { el.currentTime = 0; return; }
    if (P.shuffle && P.history.length) P.idx = P.history.pop();
    else if (P.idx > 0) P.idx--;
    else if (P.repeat === 1) P.idx = P.queue.length - 1;
    else { el.currentTime = 0; return; }
    this.load(true);
  },

  /* 背景播放：把影片的聲音交給 <audio>，可以切到別的 App 或關螢幕繼續聽 */
  setBgVideo(on) {
    if (!P.item || P.item.type !== 'video' || P.bgVideo === on) return;
    const from = this.active(), t = from.currentTime, wasPlaying = !from.paused || on;
    P.bgVideo = on;
    const to = this.active(), url = mediaURLSync(P.item.id);
    from.pause();
    to.src = url;
    to.addEventListener('loadedmetadata', () => { try { to.currentTime = t; } catch {} }, { once: true });
    if (wasPlaying) to.play().catch(() => {});
    from.removeAttribute('src'); from.load();
    this.updateUI(); this.setSession();
    if (on) toast('背景播放已開啟：現在可以切到別的 App 或關掉螢幕', 3500);
  },

  /* 從背景音訊切回影片：影片先接上同一秒開始播，成功了才停掉音訊，所以不會中斷 */
  resumeVideo() {
    if (!P.bgVideo || P.item?.type !== 'video') return;
    P.autoBg = false;
    const wasPlaying = !audioEl.paused, url = mediaURLSync(P.item.id);
    const finish = () => {
      P.bgVideo = false;
      audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load();
      this.updateUI(); this.setSession();
    };
    videoEl.src = url;
    videoEl.addEventListener('loadedmetadata', () => {
      try { videoEl.currentTime = audioEl.currentTime; } catch {}
      if (!wasPlaying) return finish();
      videoEl.play().then(finish).catch(() => { videoEl.removeAttribute('src'); videoEl.load(); });
    }, { once: true });
  },
  pip() {
    if (!P.item || P.item.type !== 'video') return toast('子母畫面只適用於影片');
    // 一定要在按下的當下開啟（iPhone 規定），所以不能等待
    if (P.bgVideo) this.setBgVideo(false);
    if (videoEl.paused) videoEl.play().catch(() => {});
    try {
      if (document.pictureInPictureElement) return document.exitPictureInPicture();
      if (videoEl.webkitSupportsPresentationMode?.('picture-in-picture')) {
        videoEl.webkitSetPresentationMode(videoEl.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } else if (document.pictureInPictureEnabled) {
        videoEl.requestPictureInPicture().catch(() => toast('影片還在準備，請再按一次子母畫面'));
      } else toast('這個瀏覽器不支援子母畫面');
    } catch (e) { toast('影片還在準備，請再按一次子母畫面'); }
  },

  openFull() {
    this.keepPlaying();
    P.view = 'full';
    playerBox.classList.remove('hidden', 'mini'); playerBox.classList.add('full');
    videoEl.controls = true;
    document.body.style.overflow = 'hidden';
    Preview.stop(true);
    if (!history.state?.player) history.pushState({ player: 1 }, '');
    this.updateUI();
  },
  /* 在畫面切換的這段時間內，如果被系統暫停就自動接著播 */
  keepPlaying(ms = 1500) {
    if (P.item && !this.active().paused) P.guardUntil = Date.now() + ms;
  },
  minimize() {
    this.keepPlaying();
    P.view = 'mini';
    playerBox.classList.remove('hidden', 'full'); playerBox.classList.add('mini');
    videoEl.controls = false;
    document.body.style.overflow = '';
    if (history.state?.player) history.back();
    this.updateUI();
    requestAnimationFrame(() => Preview.check());
  },
  close() {
    videoEl.pause(); audioEl.pause();
    videoEl.removeAttribute('src'); videoEl.load(); audioEl.removeAttribute('src'); audioEl.load();
    P.item = null; P.view = 'hidden'; P.queue = []; P.bgVideo = false;
    playerBox.className = 'player hidden';
    document.body.style.overflow = '';
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    renderAudio();
  },

  updateUI() {
    const m = P.item; if (!m) return;
    const audioMode = m.type === 'audio' || P.bgVideo;
    playerBox.classList.toggle('audio-mode', audioMode);
    playerBox.classList.toggle('video-mode', !audioMode);
    playerBox.classList.toggle('bg-video', P.bgVideo && m.type === 'video');
    $('#artImg').src = thumbURL(m);
    $('#npTitle').textContent = m.title;
    $('#npSub').textContent = `${m.type === 'video' ? '影片' : '音樂'} · ${fmtTime(m.duration)} · ${fmtSize(m.size)}`;
    $('#miniTitle').textContent = m.title;
    $('#miniSub').textContent = P.bgVideo ? '背景播放中' : (m.type === 'video' ? '影片' : '音樂');
    const bg = $('#bgBtn');
    bg.hidden = !(m.type === 'video' && P.bgVideo);
    bg.classList.add('on');
    bg.lastChild.textContent = '回到影片畫面';
    $('#pipBtn').hidden = m.type !== 'video';
    $('#miniPip').hidden = m.type !== 'video';
    $('#bgHint').textContent = m.type === 'video'
      ? (P.bgVideo ? '正在背景播放聲音。按「回到影片畫面」繼續看。' : '直接離開 App 或鎖螢幕，聲音會自動繼續播；回來會自動接回影片。想邊看邊用別的 App，按「子母畫面」。')
      : '音樂可以直接背景播放，也能用鎖定畫面控制。';
    $('#shuffleBtn').classList.toggle('on', P.shuffle);
    const rb = $('#repeatBtn'); rb.classList.toggle('on', P.repeat > 0); rb.classList.toggle('one', P.repeat === 2);
    this.updatePlayIcons();
    // 接下來播放
    const box = $('#upNext');
    box.innerHTML = P.queue.map((id, i) => { const x = S.media.find(k => k.id === id); return x ? musicRow(x, i === P.idx).replace('class="mrow', `data-i="${i}" class="mrow`) : ''; }).join('');
    box.onclick = e => {
      const row = e.target.closest('.mrow'); if (!row) return;
      if (e.target.closest('[data-a="more"]')) return itemMenu(row.dataset.id);
      P.idx = +row.dataset.i; this.load(true);
    };
    if (S.page === 'audio') renderAudio();
  },
  updatePlayIcons() {
    const playing = !this.active().paused;
    $('#miniPlay').innerHTML = playing ? ICON.pause : ICON.play;
    $('#bigPlay').innerHTML = playing ? ICON.pause : ICON.play;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  },
  updateTime() {
    const el = this.active(), d = el.duration || P.item?.duration || 0;
    const pct = d ? el.currentTime / d : 0;
    $('#miniProgress').style.width = (pct * 100) + '%';
    if (!seeking) $('#seekBar').value = Math.round(pct * 1000);
    $('#curTime').textContent = fmtTime(el.currentTime);
    $('#durTime').textContent = fmtTime(d);
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(d) && d > 0) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(el.currentTime, d), playbackRate: el.playbackRate || 1 }); } catch {}
    }
  },

  /* 鎖定畫面 / 控制中心 / 耳機按鍵 */
  setSession() {
    if (!('mediaSession' in navigator) || !P.item) return;
    const m = P.item, art = thumbURL(m);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: m.title, artist: 'myTube', album: m.type === 'video' ? '影片' : '音樂',
        artwork: art.startsWith('data:image/svg') ? [] : [{ src: art, sizes: '512x512', type: 'image/jpeg' }],
      });
    } catch {}
    const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    set('play', () => this.active().play());
    set('pause', () => this.active().pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekbackward', d => { this.active().currentTime -= d?.seekOffset || 10; });
    set('seekforward', d => { this.active().currentTime += d?.seekOffset || 10; });
    set('seekto', d => { if (d?.seekTime != null) this.active().currentTime = d.seekTime; });
  },
};

let seeking = false;
for (const el of [videoEl, audioEl]) {
  el.addEventListener('play', () => { if (el === Player.active()) Player.updatePlayIcons(); });
  el.addEventListener('pause', () => {
    if (el !== Player.active()) return;
    if (!el.ended && P.guardUntil && Date.now() < P.guardUntil) { el.play().catch(() => {}); return; }
    P.lastPause = { t: Date.now(), el };
    Player.updatePlayIcons();
  });
  // 調音量時如果被暫停（iPhone 偶爾會），自動接著播
  el.addEventListener('volumechange', () => {
    if (el === Player.active() && el.paused && !el.ended && P.lastPause?.el === el && Date.now() - P.lastPause.t < 1000) el.play().catch(() => {});
    else Player.keepPlaying(1000);
  });
  el.addEventListener('timeupdate', () => { if (el === Player.active()) Player.updateTime(); });
  el.addEventListener('ended', () => {
    if (el !== Player.active()) return;
    if (P.repeat === 2) { el.currentTime = 0; el.play(); } else Player.next(true);
  });
  el.addEventListener('error', () => { if (el === Player.active() && el.getAttribute('src')) toast('這個檔案格式可能不被此裝置支援'); });
}
const seekBar = $('#seekBar');
seekBar.oninput = () => { seeking = true; const el = Player.active(); $('#curTime').textContent = fmtTime(seekBar.value / 1000 * (el.duration || 0)); };
seekBar.onchange = () => { const el = Player.active(); if (el.duration) el.currentTime = seekBar.value / 1000 * el.duration; seeking = false; };

$('#miniPlay').onclick = e => { e.stopPropagation(); Player.toggle(); };
$('#bigPlay').onclick = () => Player.toggle();
$('#miniNext').onclick = e => { e.stopPropagation(); Player.next(); };
$('#nextBtn').onclick = () => Player.next();
$('#prevBtn').onclick = () => Player.prev();
$('#miniClose').onclick = e => { e.stopPropagation(); Player.close(); };
$('#miniTap').onclick = () => Player.openFull();
$('#miniInfo').onclick = () => Player.openFull();
$('#minimizeBtn').onclick = () => Player.minimize();
$('#bgBtn').onclick = () => { P.autoBg = false; Player.setBgVideo(false); };
$('#pipBtn').onclick = () => Player.pip();
$('#miniPip').onclick = e => { e.stopPropagation(); Player.pip(); };
$('#shuffleBtn').onclick = () => { P.shuffle = !P.shuffle; Player.updateUI(); toast(P.shuffle ? '隨機播放：開' : '隨機播放：關'); };
$('#repeatBtn').onclick = () => { P.repeat = (P.repeat + 1) % 3; Player.updateUI(); toast(['循環：關', '循環：全部', '循環：單首'][P.repeat]); };
$('#addToPlBtn').onclick = () => P.item && playlistSheet(P.item);
$('#saveDevBtn').onclick = () => P.item && saveFlow(P.item);
addEventListener('popstate', () => { if (P.view === 'full') Player.minimize(); });

// 往下滑關閉 → 縮小（像 YouTube）
(() => {
  let y0 = null;
  const stage = $('#playerStage');
  let wasPlaying = false;
  stage.addEventListener('touchstart', e => { if (P.view === 'full') { y0 = e.touches[0].clientY; wasPlaying = P.item && !Player.active().paused; } }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (y0 != null && e.changedTouches[0].clientY - y0 > 90) {
      Player.minimize();
      // 往下滑時手指可能碰到影片的暫停鍵，原本在播就接著播
      setTimeout(() => { const el = Player.active(); if (wasPlaying && el.paused) el.play().catch(() => {}); }, 60);
    }
    y0 = null;
  }, { passive: true });
})();

// 離開 App 時：影片自動改成背景音訊繼續播放（除非正在子母畫面）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Preview.stop(true);
    const inPip = document.pictureInPictureElement || videoEl.webkitPresentationMode === 'picture-in-picture';
    if (P.item?.type === 'video' && !P.bgVideo && !videoEl.paused && !inPip && LS.get('autoBg') !== '0') {
      Player.setBgVideo(true); P.autoBg = true;
    }
  } else {
    if (P.bgVideo && P.autoBg) Player.resumeVideo();
    requestAnimationFrame(() => Preview.check());
  }
});

/* =========================================================
   搜尋
   ========================================================= */
const searchInput = $('#searchInput');
function openSearch() {
  $('#searchBar').hidden = false; document.body.classList.add('searching');
  if (S.page === 'download') showPage('video');
  searchInput.focus();
}
function closeSearch() {
  $('#searchBar').hidden = true; document.body.classList.remove('searching');
  searchInput.value = ''; S.query = ''; renderLibrary();
}
$('#searchBtn').onclick = () => ($('#searchBar').hidden ? openSearch() : closeSearch());
$('#searchBack').onclick = closeSearch;
$('#searchClear').onclick = () => { searchInput.value = ''; S.query = ''; renderLibrary(); searchInput.focus(); };
let searchTimer;
searchInput.oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.query = searchInput.value; renderLibrary(); window.scrollTo({ top: 0 }); }, 150);
};
searchInput.onkeydown = e => { if (e.key === 'Enter') searchInput.blur(); };

/* =========================================================
   PIN 密碼鎖（4 位數）
   ========================================================= */
const Lock = {
  KEY: 'pin_v2', AWAY_MS: 3 * 60 * 1000,
  entry: '', mode: 'unlock', first: null, hiddenAt: 0, pending: false, buffer: [],
  hash(pin) { let h = 2166136261; for (const c of 'myTube#' + pin) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); },
  has() { return !!LS.get(this.KEY); },
  isOpen() { return !$('#lockScreen').hidden; },
  open(mode) {
    this.mode = mode; this.entry = ''; this.first = null;
    const t = { setup: ['歡迎使用 myTube', '第一次使用，請設定這支手機專用的 4 位數 PIN 碼'],
      unlock: ['myTube 已上鎖', '請輸入 4 位數 PIN 碼'], set: ['設定 PIN 碼', '請輸入新的 4 位數密碼'],
      change: ['更改 PIN 碼', '請先輸入目前的密碼'], remove: ['關閉密碼鎖', '請輸入目前的密碼'] }[mode];
    $('#lockTitle').textContent = t[0]; this.desc(t[1]);
    $('#kpCancel').classList.toggle('hide', mode === 'unlock' || mode === 'setup');
    const fb = $('#forgotBtn'); fb.hidden = mode !== 'unlock'; fb.classList.remove('danger'); fb.textContent = '忘記密碼／重新設定'; this.resetArmed = false;
    const warn = $('#lockWarn');
    warn.hidden = !(mode === 'setup' && needsInstall());
    warn.innerHTML = '⚠️ 建議先按 Safari 的「分享」→「加入主畫面」，再從桌面的 myTube 打開來設定。<br>在 Safari 網頁裡和桌面 App 裡的資料是<b>分開</b>的，桌面 App 的資料才會長期保存。';
    document.activeElement?.blur?.();
    $('#lockScreen').hidden = false; this.dots();
  },
  close() { $('#lockScreen').hidden = true; this.entry = ''; this.updateBtn(); },
  desc(text, err) { const d = $('#lockDesc'); d.textContent = text; d.classList.toggle('err', !!err); },
  dots() { $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < this.entry.length)); },
  wrong(msg) {
    const d = $('#pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
    navigator.vibrate?.(200);
    this.entry = ''; this.dots(); this.desc(msg, true);
  },
  press(k) {
    if (k === 'cancel') return this.close();
    if (k === 'del') { if (this.pending) return; this.entry = this.entry.slice(0, -1); return this.dots(); }
    if (this.pending) { this.buffer.push(k); return; }   // 打很快時先記住，不會漏字
    this.entry += k; this.dots();
    if (this.entry.length === 4) {
      this.pending = true; this.buffer = [];
      setTimeout(() => {
        this.submit(); this.pending = false;
        const extra = this.buffer; this.buffer = [];
        if (this.isOpen()) extra.forEach(x => this.press(x));
      }, 120);
    }
  },
  submit() {
    const pin = this.entry, ok = this.hash(pin) === LS.get(this.KEY);
    if (this.mode === 'unlock') { if (ok) this.close(); else this.wrong('密碼錯誤，請再試一次'); return; }
    if (this.mode === 'remove') {
      if (!ok) return this.wrong('密碼錯誤');
      LS.del(this.KEY); this.close(); toast('已關閉密碼鎖'); return;
    }
    if (this.mode === 'change') {
      if (!ok) return this.wrong('密碼錯誤');
      this.mode = 'set'; this.entry = ''; this.dots();
      $('#lockTitle').textContent = '設定新的 PIN 碼'; this.desc('請輸入新的 4 位數密碼'); return;
    }
    if (this.mode === 'set' || this.mode === 'setup') {
      if (this.first === null) { this.first = pin; this.entry = ''; this.dots(); this.desc('請再輸入一次確認'); return; }
      if (pin !== this.first) { this.first = null; return this.wrong('兩次輸入不一樣，請重新設定'); }
      const wasSetup = this.mode === 'setup';
      LS.set(this.KEY, this.hash(pin)); this.close();
      requestPersist();
      toast(wasSetup ? '設定完成！這支手機的 myTube 已用你的密碼保護' : 'PIN 碼已更新', 3500);
    }
  },
  updateBtn() { $('#lockBtn').classList.toggle('locked-on', this.has()); },
};
$('#keypad').onclick = e => { const b = e.target.closest('button'); if (b) Lock.press(b.dataset.k); };
addEventListener('keydown', e => {
  if (!Lock.isOpen()) return;
  if (/^[0-9]$/.test(e.key)) Lock.press(e.key);
  else if (e.key === 'Backspace') Lock.press('del');
  else if (e.key === 'Escape' && Lock.mode !== 'unlock') Lock.press('cancel');
});
$('#lockBtn').onclick = () => {
  if (!Lock.has()) return openSheet(`<h4>密碼鎖</h4>
    <p class="hint" style="padding:0 20px">密碼鎖是選用的。設定 4 位數 PIN 碼後，打開 myTube 或離開超過 3 分鐘回來時，要輸入密碼才能看。</p>
    <button class="sheet-item" data-a="set">🔒 設定 PIN 碼</button>`, a => { if (a === 'set') Lock.open('set'); });
  openSheet(`<h4>密碼鎖（已開啟）</h4>
    <button class="sheet-item" data-a="now">🔒 立即上鎖</button>
    <button class="sheet-item" data-a="change">🔑 更改 PIN 碼</button>
    <button class="sheet-item danger" data-a="remove">🔓 關閉密碼鎖</button>`, a => {
    if (a === 'now') Lock.open('unlock');
    if (a === 'change') Lock.open('change');
    if (a === 'remove') Lock.open('remove');
  });
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Lock.hiddenAt = Date.now();
  else if (Lock.has() && !Lock.isOpen() && Lock.hiddenAt && Date.now() - Lock.hiddenAt > Lock.AWAY_MS) Lock.open('unlock');
});
// 忘記密碼：只能清除「這支手機」的 myTube 資料重新開始（別人的手機不受影響）
$('#forgotBtn').onclick = async () => {
  const fb = $('#forgotBtn');
  if (!Lock.resetArmed) {
    Lock.resetArmed = true; fb.classList.add('danger');
    fb.textContent = '再按一次：清除這支手機的所有 myTube 影片、音樂與設定';
    Lock.desc('重新設定會清除這支手機的 myTube 資料', true);
    setTimeout(() => { if (Lock.resetArmed) { Lock.resetArmed = false; fb.classList.remove('danger'); fb.textContent = '忘記密碼／重新設定'; } }, 6000);
    return;
  }
  fb.textContent = '清除中…';
  await new Promise(r => { const q = indexedDB.deleteDatabase('mytube'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 3000); });
  LS.clearAll();
  location.reload();
};
LS.del('pin'); // 舊版本留下的密碼不再使用
// 一打開：有設定 PIN 才要求輸入（在載入資料之前）
if (Lock.has()) Lock.open('unlock');   // 有設密碼才上鎖；沒設就直接進去
Lock.updateBtn();

/* =========================================================
   下載
   ========================================================= */
const DL = { active: 0, max: 3, queue: [] };
const serverInput = $('#serverInput');
const getServer = () => (serverInput.value || '').trim().replace(/\/+$/, '');
serverInput.value = LS.get('server') || '';
serverInput.onchange = () => { LS.set('server', getServer()); testServer(); };

async function testServer(silent) {
  const s = getServer(), st = $('#serverStatus');
  if (!s) { st.textContent = '尚未設定下載伺服器。'; return false; }
  try {
    const r = await fetch(s + '/api/health', { cache: 'no-store' });
    const j = await r.json();
    st.innerHTML = `<span class="st-done">✅ 已連線</span>（yt-dlp ${esc(j.ytdlp || '')}${j.ffmpeg ? '，ffmpeg OK' : '，⚠️ 找不到 ffmpeg，MP3 與高畫質合併會失敗'}）`;
    return true;
  } catch (e) {
    st.innerHTML = `<span class="st-err">❌ 連不到伺服器</span>：請確認電腦上的 server 有在執行，網址正確${location.protocol === 'https:' && s.startsWith('http:') ? '。注意：https 網頁不能連 http 伺服器，請用 Cloudflare Tunnel 的 https 網址' : ''}。`;
    if (!silent) toast('連不到下載伺服器');
    return false;
  }
}
$('#testServerBtn').onclick = () => { LS.set('server', getServer()); testServer(); };

$('#formatSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.fmt = b.dataset.fmt;
  $$('#formatSeg button').forEach(x => x.classList.toggle('active', x === b));
  LS.set('fmt', S.fmt);
  applyMode();
};
$('#pasteBtn').onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    const box = $('#urlInput');
    box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + t.trim();
  } catch { toast('無法讀取剪貼簿，請長按輸入框貼上'); }
};
$('#clearUrlBtn').onclick = () => { $('#urlInput').value = ''; };

function parseUrls(text) {
  const found = text.match(/https?:\/\/[^\s<>"']+/g) || [];
  return [...new Set(found.filter(u => /youtu\.?be|youtube\.com/i.test(u)))];
}

/* ---------- 不下載，直接看 ---------- */
function firstYt() {
  const urls = parseUrls($('#urlInput').value);
  if (!urls.length) { toast('請先貼上 YouTube 網址'); return null; }
  const id = (urls[0].match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || [])[1];
  if (!id) { toast('看不懂這個網址，請貼 YouTube 影片連結'); return null; }
  return { id, url: urls[0] };
}
function openInSafari(id) {
  const url = 'https://www.youtube.com/watch?v=' + id;
  // iPhone：用 x-safari- 強制用真正的 Safari 打開（App 內建的小瀏覽器跑不了 Vinegar）
  if (isIOS()) location.href = 'x-safari-' + url;
  else window.open(url, '_blank');
}
function watchHere(id) {
  if (P.item && !Player.active().paused) Player.active().pause();   // 避免兩個一起播
  Preview.stop(true);
  $('#ytFrame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  $('#ytWatch').hidden = false; $('#ytWatch').dataset.id = id;
  document.body.style.overflow = 'hidden';
}
function closeWatch() {
  $('#ytFrame').innerHTML = ''; $('#ytWatch').hidden = true;
  if (P.view !== 'full') document.body.style.overflow = '';
}
$('#watchHereBtn').onclick = () => { const v = firstYt(); if (v) watchHere(v.id); };
$('#watchSafariBtn').onclick = () => { const v = firstYt(); if (v) openInSafari(v.id); };
$('#ytClose').onclick = closeWatch;
$('#ytToSafari').onclick = () => { const id = $('#ytWatch').dataset.id; closeWatch(); openInSafari(id); };

/* ---------- 下載方式：手機直接下載（外部網站）/ 電腦伺服器 ---------- */
const DEFAULT_SITE = 'https://cobalt.meowing.de/';
const extSiteInput = $('#extSiteInput');
extSiteInput.value = LS.get('extSite') || DEFAULT_SITE;
extSiteInput.onchange = () => LS.set('extSite', extSiteInput.value.trim() || DEFAULT_SITE);
const apiListEl = $('#apiList'), apiKeyEl = $('#apiKey');
apiKeyEl.type = 'text';
apiListEl.value = LS.get('apiList') || '';
apiKeyEl.value = LS.get('apiKey') || '';
apiListEl.onchange = () => { LS.set('apiList', apiListEl.value.trim()); applyMode(); };
apiKeyEl.onchange = () => LS.set('apiKey', apiKeyEl.value.trim());
// 內建的預設下載服務（依序嘗試，前一個失敗就自動換下一個）。你自己填的會排在最前面。
const DEFAULT_APIS = [
  'https://cobalt-api.meowing.de/',
  'https://cobalt-backend.canine.tools/',
  'https://capi.3kh0.net/',
  'https://cobalt-alpha.wolfy.love/',
];
const normApi = x => x.trim().replace(/\/+$/, '') + '/';
const getApis = () => {
  const mine = (apiListEl.value || '').split(/\s+/).filter(x => /^https?:\/\//.test(x)).map(normApi);
  return [...new Set([...mine, ...DEFAULT_APIS])];
};
apiListEl.placeholder = '不用填也可以。內建：\n' + DEFAULT_APIS.join('\n') + '\n（你自己加的會優先使用）';
/* ---------- a-Shell 引導下載 ---------- */
const MT_URL = 'https://raw.githubusercontent.com/venus52mom-lab/News-learn/main/mytube/tools/mt.py';
const ASHELL_STORE = 'https://apps.apple.com/app/id1473805438';
const SETUP_CMD1 = 'python3 -m pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi';
const SETUP_CMD2 = 'curl -sLo mt.py ' + MT_URL;
function copyText(t) {
  // 在點擊當下同步複製（iPhone 規定）
  try { navigator.clipboard.writeText(t).catch(() => fallbackCopy(t)); } catch { fallbackCopy(t); }
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
}
function openAShell() { setTimeout(() => { location.href = 'ashell://'; }, 150); }
function ashellSetup(after) {
  const step = (n, title, body, btn, a) => `<div style="padding:10px 20px;border-bottom:1px solid var(--line)">
    <div style="font-weight:700;margin-bottom:4px">${n}. ${title}</div><div class="hint" style="margin:0 0 8px">${body}</div>
    <button class="pill-btn" data-a="${a}" data-keep>${btn}</button></div>`;
  openSheet(`<h4>第一次使用：設定 a-Shell（約 2 分鐘，只要做一次）</h4>
    ${step(1, '安裝 a-Shell', '免費 App，用你手機自己的網路下載 YouTube。', '前往 App Store', 'store')}
    ${step(2, '安裝下載工具', '按下面按鈕會<b>自動複製指令</b>並打開 a-Shell → 在 a-Shell <b>長按貼上</b> → 按 Enter，等它跑完（約 1 分鐘）。', '複製指令並打開 a-Shell', 'c1')}
    ${step(3, '下載 myTube 小程式', '回到這裡按下面按鈕 → 一樣在 a-Shell 貼上 → Enter。', '複製指令並打開 a-Shell', 'c2')}
    <button class="sheet-item" data-a="done">✅ 我都完成了，開始下載</button>`, a => {
    if (a === 'store') location.href = ASHELL_STORE;
    if (a === 'c1') { copyText(SETUP_CMD1); toast('已複製，到 a-Shell 貼上按 Enter'); openAShell(); }
    if (a === 'c2') { copyText(SETUP_CMD2); toast('已複製，到 a-Shell 貼上按 Enter'); openAShell(); }
    if (a === 'done') { LS.set('ashellReady', '1'); applyMode(); after?.(); }
  });
}
function ashellCommand(items) {
  const parts = ['python3 mt.py'];
  for (const h of items) parts.push((h.format === 'mp3' ? 'mp3 ' : 'mp4 ') + h.url);
  return parts.join(' ');
}
function runAShell(items) {
  copyText(ashellCommand(items));
  toast('指令已複製！到 a-Shell 長按貼上 → 按 Enter', 4000);
  openAShell();
}
S.mode = LS.get('dlmode') || 'ashell';
if (S.mode === 'api' && !LS.get('apiList')) S.mode = 'ashell';
function applyMode() {
  $$('#modeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === S.mode));
  $('#qualityRow').hidden = S.mode === 'external' || S.mode === 'ashell' || S.fmt !== 'mp4';
  $('#modeHint').innerHTML = S.mode === 'ashell'
    ? (LS.get('ashellReady') === '1'
      ? '按「開始下載」→ myTube 會<b>自動複製指令並打開 a-Shell</b> → 在 a-Shell <b>長按貼上、按 Enter</b> → 下載完回到這裡，按紀錄上的「<b>📥 匯入 myTube</b>」，到 a-Shell › myTube 資料夾選檔案（會自動分到影片／音樂）。可以一次貼很多個網址。<br><a href="#" id="redoSetup" style="color:#3ea6ff">重新設定 a-Shell</a>'
      : '用免費的 a-Shell App 下載，<b>用你自己手機的網路，比較不會被 YouTube 擋</b>。<br>第一次使用請先按「開始下載」，照著 3 個步驟設定（只要做一次）。')
    : S.mode === 'api'
    ? '直接在 myTube 裡下載，<b>不用電腦、不用設定</b>。可以一次貼很多個網址，下載完會自動出現在影片／音樂裡，馬上就能播。內建 ' + DEFAULT_APIS.length + ' 個下載服務，一個失敗會自動換下一個。'
    : S.mode === 'external'
    ? '按「開始下載」會<b>自動複製網址</b>並打開下載網站：把網址貼上 → 下載' + (S.fmt === 'mp3' ? '（請在網站選<b>音訊 audio</b>）' : '') + ' → 存到「檔案」App。<br>下載好後回到這裡，按紀錄上的「<b>匯入 myTube</b>」選那個檔案就能看。'
    : '用你電腦上的 server 下載，可以一次下載很多個，下載完會<b>自動</b>出現在影片/音樂裡。需要電腦開著（設定方式見 README）。';
  $('#startDlBtn').lastChild.textContent = S.mode === 'external' ? '開始下載（打開下載網站）' : S.mode === 'ashell' ? '開始下載（打開 a-Shell）' : '開始下載';
  const redo = $('#redoSetup'); if (redo) redo.onclick = e => { e.preventDefault(); ashellSetup(); };
}
$('#modeSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.mode = b.dataset.mode; LS.set('dlmode', S.mode); applyMode();
  if (S.mode === 'server' && !getServer()) { $('#settingsBox').open = true; toast('請在下面的設定填入伺服器網址'); }
};
function openExternal(h) {
  // 必須在點擊當下執行：先複製網址，再開新分頁
  try { navigator.clipboard.writeText(h.url).catch(() => {}); } catch {}
  const site = (LS.get('extSite') || DEFAULT_SITE).trim();
  const w = window.open(site, '_blank');
  if (!w) location.href = site;
  toast('網址已複製，到網站裡貼上就可以下載', 3500);
}
function importFor(h) {
  S.pendingImport = h.id;
  $(h.format === 'mp3' ? '#importAudio' : '#importVideo').click();
}

$('#startDlBtn').onclick = async () => {
  const urls = parseUrls($('#urlInput').value);
  if (!urls.length) return toast('請貼上 YouTube 網址');
  if (S.mode === 'ashell') {
    if (LS.get('ashellReady') !== '1') return ashellSetup();
    const items = urls.map(url => ({ id: uid(), url, mode: 'ashell', format: S.fmt, title: url, status: 'external', progress: 0, created: Date.now() }));
    for (const h of items.slice().reverse()) { S.history.unshift(h); DB.put('history', h); }
    $('#urlInput').value = '';
    renderHistory();
    runAShell(items);
    return;
  }
  if (S.mode === 'external') {
    const items = urls.map(url => ({ id: uid(), url, format: S.fmt, title: url, status: 'external', progress: 0, created: Date.now() }));
    for (const h of items.slice().reverse()) { S.history.unshift(h); DB.put('history', h); }
    $('#urlInput').value = '';
    renderHistory();
    openExternal(items[0]);
    if (items.length > 1) setTimeout(() => toast(`共 ${items.length} 個：第一個已複製，其他的在下面紀錄按「打開下載網站」`, 4500), 3600);
    return;
  }
  if (S.mode === 'server' && !getServer()) { $('#settingsBox').open = true; return toast('請先在設定填入下載伺服器網址'); }
  for (const url of urls) {
    const h = { id: uid(), url, mode: S.mode, format: S.fmt, quality: $('#qualitySel').value, title: url, status: 'queued', progress: 0, created: Date.now() };
    S.history.unshift(h); DB.put('history', h); DL.queue.push(h.id);
  }
  $('#urlInput').value = '';
  renderHistory(); pump();
  toast(`已加入 ${urls.length} 個下載`);
};

function pump() {
  while (DL.active < DL.max && DL.queue.length) {
    const id = DL.queue.shift(); DL.active++;
    runJob(id).finally(() => { DL.active--; pump(); });
  }
}
function setH(h, patch) {
  Object.assign(h, patch);
  const clean = { ...h }; delete clean._t;
  DB.put('history', clean).catch(() => {});
  drawHistoryItem(h);
}
async function errText(r) { try { const j = await r.json(); return j.detail || j.error || r.statusText; } catch { return r.status + ' ' + r.statusText; } }

async function fetchWithProgress(url, onProg) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await errText(r));
  const total = +r.headers.get('Content-Length') || +r.headers.get('Estimated-Content-Length') || 0;
  if (!r.body || !total) return r.blob();
  const reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length; onProg(Math.min(1, got / total));
  }
  return new Blob(chunks, { type: r.headers.get('Content-Type') || '' });
}

/* ---------- App 內下載（cobalt 格式 API，直接在手機上完成） ---------- */
const API_ERR = {
  'error.api.link.invalid': '網址格式不對', 'error.api.link.unsupported': '這個 API 不支援這個網址',
  'error.api.content.video.unavailable': '影片無法下載（可能是私人或地區限制）', 'error.api.content.video.age': '有年齡限制的影片無法下載',
  'error.api.content.video.live': '直播無法下載', 'error.api.content.too_long': '影片太長，這個 API 不接受',
  'error.api.rate_exceeded': '這個 API 使用太頻繁，請稍後再試', 'error.api.youtube.login': 'YouTube 擋住了這個 API（要求登入）',
  'error.api.youtube.token_expired': '這個 API 的 YouTube 設定過期了', 'error.api.fetch.fail': '這個 API 從 YouTube 抓取失敗',
  'error.api.fetch.critical': '這個 API 從 YouTube 抓取失敗', 'error.api.auth.jwt.missing': '這個 API 需要驗證，不能從 App 使用',
  'error.api.auth.key.missing': '這個 API 需要金鑰', 'error.api.auth.key.invalid': 'API 金鑰不正確',
};
function ytId(u) { const m = u.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/); return m ? m[1] : null; }
async function fetchTimeout(url, opts = {}, ms = 30000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
async function ytInfo(url) {
  const out = {};
  try {
    const r = await fetchTimeout('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), {}, 8000);
    if (r.ok) { const j = await r.json(); out.title = j.title; }
  } catch {}
  const id = ytId(url);
  if (id) try { const r = await fetchTimeout(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {}, 8000); if (r.ok) out.thumb = await r.blob(); } catch {}
  return out;
}
async function cobaltRequest(api, h) {
  const body = h.format === 'mp3'
    ? { url: h.url, downloadMode: 'audio', audioFormat: 'mp3', audioBitrate: '192', filenameStyle: 'basic' }
    : { url: h.url, downloadMode: 'auto', videoQuality: h.quality === 'best' ? '1080' : (h.quality || '720'), youtubeVideoCodec: 'h264', filenameStyle: 'basic' };
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const key = (LS.get('apiKey') || '').trim();
  if (key) headers.Authorization = /\s/.test(key) ? key : 'Api-Key ' + key;
  const send = async b => {
    const r = await fetchTimeout(api, { method: 'POST', headers, body: JSON.stringify(b) }, 45000);
    let j; try { j = await r.json(); } catch { throw new Error(`API 回應錯誤（${r.status}）`); }
    return j;
  };
  let j = await send({ ...body, localProcessing: 'disabled' });     // 新版 cobalt：請伺服器幫忙合併好
  if (j.status === 'error' && /invalid_body|invalid/.test(j.error?.code || '')) j = await send(body); // 舊版不認得這個參數
  if (j.status === 'tunnel' || j.status === 'redirect') return { url: j.url, filename: j.filename };
  if (j.status === 'picker' && j.picker?.length) {
    const it = j.picker.find(x => x.type === 'video') || j.picker[0];
    return { url: it.url, filename: j.filename };
  }
  if (j.status === 'local-processing') throw new Error('這個 API 需要手機自己轉檔，請換一個 API');
  const code = j.error?.code || j.text || 'unknown';
  throw new Error(API_ERR[code] || `下載失敗（${code}）`);
}
async function runApiJob(h) {
  const apis = getApis();
  if (!apis.length) throw new Error('還沒設定下載 API 網址');
  setH(h, { status: 'starting', progress: 0, error: null });
  const infoP = ytInfo(h.url);
  let lastErr, blob, filename;
  for (const api of apis) {
    try {
      const { url, filename: fn } = await cobaltRequest(api, h);
      setH(h, { status: 'transfer', progress: 0 });
      blob = await fetchWithProgress(url, p => {
        if (!h._t || Date.now() - h._t > 300) { h._t = Date.now(); setH(h, { progress: p }); }
      });
      if (!blob.size || blob.size < 2048) throw new Error('下載到的檔案是空的');
      filename = fn; break;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('API 沒有回應（逾時）') : (e.message === 'Failed to fetch' || e.message === 'Load failed' ? new Error('連不到這個 API，或它不允許從網頁下載') : e);
      console.warn(api, e);
      if (apis.length > 1) setH(h, { status: 'starting', error: `${new URL(api).host}：${lastErr.message}，換下一個…` });
    }
  }
  if (!blob) throw lastErr;
  const info = await infoP;
  const type = h.format === 'mp3' ? 'audio' : 'video';
  const ext = type === 'audio' ? 'mp3' : 'mp4';
  const fromFile = (filename || '').replace(/\.[^.]+$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const title = info.title || fromFile || h.url;
  const typed = blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: type === 'video' ? 'video/mp4' : 'audio/mpeg' });
  const m = await addMedia(typed, { type, title, source: 'download', thumb: info.thumb || null, filename: `${safeName(title)}.${ext}` });
  setH(h, { status: 'done', progress: 1, mediaId: m.id, size: blob.size, title, error: null, saved: false });
  if ($('#autoSaveChk').checked && await saveToDevice(m, false)) setH(h, { saved: true });
  toast(`✅ 下載完成：${title}`);
}

async function runJob(hid) {
  const h = S.history.find(x => x.id === hid); if (!h) return;
  if (h.mode === 'api') {
    try { await runApiJob(h); }
    catch (e) { console.error(e); setH(h, { status: 'error', error: e.message }); }
    return;
  }
  const server = getServer();
  try {
    setH(h, { status: 'starting', progress: 0, error: null });
    const r = await fetch(server + '/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: h.url, format: h.format, quality: h.quality }),
    });
    if (!r.ok) throw new Error(await errText(r));
    const { id: jobId } = await r.json();
    h.jobId = jobId;
    let s;
    for (;;) {
      await sleep(1000);
      const pr = await fetch(`${server}/api/jobs/${jobId}`, { cache: 'no-store' });
      if (!pr.ok) throw new Error(await errText(pr));
      s = await pr.json();
      if (s.title && h.title !== s.title) h.title = s.title;
      if (s.status === 'error') throw new Error(s.error || '下載失敗');
      if (s.status === 'done') break;
      setH(h, { status: s.status === 'processing' ? 'processing' : 'server', progress: s.progress || 0 });
    }
    setH(h, { status: 'transfer', progress: 0 });
    const blob = await fetchWithProgress(`${server}/api/jobs/${jobId}/file`, p => {
      if (!h._t || Date.now() - h._t > 300) { h._t = Date.now(); setH(h, { progress: p }); }
    });
    let thumb = null;
    try { const tr = await fetch(`${server}/api/jobs/${jobId}/thumb`); if (tr.ok) thumb = await tr.blob(); } catch {}
    const type = h.format === 'mp3' ? 'audio' : 'video';
    const typed = blob.type ? blob : new Blob([blob], { type: type === 'video' ? 'video/mp4' : 'audio/mpeg' });
    const m = await addMedia(typed, { type, title: s.title || h.title, source: 'download', thumb, filename: s.filename, duration: s.duration });
    if (thumb) h.thumbMedia = m.id;
    setH(h, { status: 'done', progress: 1, mediaId: m.id, size: blob.size, saved: false });
    fetch(`${server}/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
    if ($('#autoSaveChk').checked) {
      const ok = await saveToDevice(m, false);
      if (ok) setH(h, { saved: true });
    }
    toast(`✅ 下載完成：${m.title}`);
  } catch (e) {
    console.error(e);
    setH(h, { status: 'error', error: e.message === 'Failed to fetch' ? '連不到下載伺服器' : e.message });
  }
}

/* ---------------- 下載紀錄 ---------------- */
const STATUS = { api: '', external: '請在下載網站完成，再按「匯入 myTube」', imported: '已匯入', queued: '等待中', starting: '連線中…', server: '伺服器下載中', processing: '轉檔中…', transfer: '傳到手機中', done: '完成', error: '失敗' };
function historyHTML(h) {
  const m = h.mediaId && S.media.find(x => x.id === h.mediaId);
  const pct = Math.round((h.progress || 0) * 100);
  const busy = !['done', 'error', 'queued', 'external', 'imported'].includes(h.status);
  let st = STATUS[h.status] || h.status;
  if (h.status === 'external' && h.mode === 'ashell') st = '在 a-Shell 下載完後，按「匯入 myTube」';
  if (h.mode === 'api' && h.status === 'starting') st = '準備下載中…';
  if (h.mode === 'api' && h.status === 'transfer') st = '下載到手機中';
  if (busy && h.status !== 'starting' && h.status !== 'processing') st += ` ${pct}%`;
  return `<div class="hitem" data-id="${h.id}">
    <img class="hthumb" src="${m ? thumbURL(m) : placeholderArt({ title: h.url, type: h.format === 'mp3' ? 'audio' : 'video' })}" alt="">
    <div class="hbody">
      <div class="htitle">${esc(h.title)}</div>
      <div class="hsub"><span class="badge ${h.format}">${h.format.toUpperCase()}</span>
        <span class="${h.status === 'done' ? 'st-done' : h.status === 'error' ? 'st-err' : ''}">${esc(st)}</span>
        <span>${h.size ? fmtSize(h.size) + ' · ' : ''}${fmtAgo(h.created)}</span>
        ${h.status === 'done' && h.saved ? '<span>· 已存到裝置</span>' : ''}</div>
      ${h.error ? `<div class="hsub st-err">${esc(h.error)}</div>` : ''}
      ${busy ? `<div class="hprog"><div style="width:${h.status === 'starting' || h.status === 'processing' ? 100 : pct}%;${h.status === 'processing' ? 'opacity:.5' : ''}"></div></div>` : ''}
      <div class="hactions">
        ${m ? '<button data-a="play">▶ 播放</button><button data-a="save">📁 存到檔案</button>' : ''}
        ${h.status === 'error' ? '<button data-a="retry">↻ 重試</button>' : ''}
        ${h.status === 'external' ? (h.mode === 'ashell' ? '<button data-a="ash">📲 再開一次 a-Shell</button>' : '<button data-a="ext">🌐 打開下載網站</button>') + '<button data-a="imp">📥 匯入 myTube</button>' : ''}
        <button data-a="copy">複製網址</button>
        ${busy ? '' : '<button data-a="del">移除紀錄</button>'}
      </div>
    </div></div>`;
}
function renderHistory() {
  const box = $('#historyList');
  box.innerHTML = S.history.length ? S.history.map(historyHTML).join('') : '<div class="empty">還沒有下載紀錄</div>';
}
function drawHistoryItem(h) {
  const old = $(`#historyList .hitem[data-id="${h.id}"]`);
  if (!old) return renderHistory();
  old.outerHTML = historyHTML(h);
}
$('#historyList').onclick = async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const h = S.history.find(x => x.id === b.closest('.hitem').dataset.id); if (!h) return;
  const m = h.mediaId && S.media.find(x => x.id === h.mediaId);
  const a = b.dataset.a;
  if (a === 'play' && m) Player.playList([m], 0);
  if (a === 'save' && m) { const ok = await saveFlow(m); if (ok) setH(h, { saved: true }); }
  if (a === 'ext') { openExternal(h); return; }
  if (a === 'ash') { runAShell([h]); return; }
  if (a === 'imp') { importFor(h); return; }
  if (a === 'retry') { setH(h, { status: 'queued', error: null, progress: 0 }); DL.queue.push(h.id); pump(); }
  if (a === 'copy') { try { await navigator.clipboard.writeText(h.url); toast('已複製'); } catch { toast(h.url); } }
  if (a === 'del') { S.history = S.history.filter(x => x !== h); await DB.del('history', h.id); renderHistory(); }
};
$('#clearHistoryBtn').onclick = async () => {
  const keep = S.history.filter(h => !['done', 'error', 'queued', 'external', 'imported'].includes(h.status));
  for (const h of S.history) if (!keep.includes(h)) await DB.del('history', h.id);
  S.history = keep; renderHistory(); toast('已清除下載紀錄（已下載的影片/音樂仍保留）');
};

/* =========================================================
   存到裝置：myTube/影片、myTube/音樂
   ========================================================= */
async function getFile(m) {
  if (fileCache.has(m.id)) return fileCache.get(m.id);
  const b = await DB.get('blobs', m.id);
  const f = new File([b], fileName(m), { type: b.type || (m.type === 'video' ? 'video/mp4' : 'audio/mpeg') });
  fileCache.set(m.id, f);
  return f;
}
async function writeToFolder(m, file, gesture) {
  const dh = S.dirHandle; if (!dh) return false;
  let perm = await dh.queryPermission?.({ mode: 'readwrite' });
  if (perm !== 'granted' && gesture) perm = await dh.requestPermission?.({ mode: 'readwrite' });
  if (perm !== 'granted') return false;
  const root = await dh.getDirectoryHandle('myTube', { create: true });
  const sub = await root.getDirectoryHandle(m.type === 'video' ? '影片' : '音樂', { create: true });
  const fh = await sub.getFileHandle(file.name, { create: true });
  const w = await fh.createWritable(); await w.write(file); await w.close();
  toast(`已存到 myTube/${m.type === 'video' ? '影片' : '音樂'}/${file.name}`, 3500);
  return true;
}
function anchorDownload(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 120000);
}
// 自動儲存（下載完成時，沒有手指點擊）
async function saveToDevice(m, gesture) {
  const file = await getFile(m);
  try { if (await writeToFolder(m, file, gesture)) return true; } catch (e) { console.warn(e); }
  if (isIOS()) return false;                  // iPhone 一定要手按「存到檔案」
  anchorDownload(file); return true;          // Android / 電腦：存到「下載」資料夾
}
// 手按「存到檔案」
async function saveFlow(m) {
  const folder = m.type === 'video' ? '影片' : '音樂';
  if (S.dirHandle) { try { const f = await getFile(m); if (await writeToFolder(m, f, true)) return true; } catch (e) { console.warn(e); } }
  const ready = fileCache.has(m.id);
  const file = ready ? fileCache.get(m.id) : null;
  const doShare = f => {
    if (navigator.canShare?.({ files: [f] })) {
      navigator.share({ files: [f], title: f.name }).catch(e => { if (e.name !== 'AbortError') anchorDownload(f); });
    } else anchorDownload(f);
  };
  if (isMobile() && navigator.canShare) {
    if (ready) { doShare(file); return true; }
    // 檔案要先從 App 資料庫讀出來，再讓使用者點一次（iPhone 規定分享必須是點擊觸發）
    toast('準備檔案中…');
    const f = await getFile(m);
    openSheet(`<h4>${esc(f.name)}</h4>
      <p class="hint" style="padding:0 20px">${isIOS() ? `接著選「儲存到檔案」→ 開啟「我的 iPhone › myTube › ${folder}」資料夾 → 儲存。` : '選擇要存放的位置。'}</p>
      <button class="sheet-item" data-a="go">📁 存到檔案</button>`, a => { if (a === 'go') doShare(f); });
    return true;
  }
  anchorDownload(file || await getFile(m));
  return true;
}

/* 電腦（Chrome / Edge）可選資料夾，自動建立 myTube/影片、myTube/音樂 */
if ('showDirectoryPicker' in window) {
  $('#folderBox').hidden = false;
  $('#pickFolderBtn').onclick = async () => {
    try {
      const dh = await showDirectoryPicker({ id: 'mytube', mode: 'readwrite', startIn: 'downloads' });
      S.dirHandle = dh; await DB.put('kv', dh, 'dir');
      const root = await dh.getDirectoryHandle('myTube', { create: true });
      await root.getDirectoryHandle('影片', { create: true }); await root.getDirectoryHandle('音樂', { create: true });
      showFolder(); toast('已建立 myTube/影片 與 myTube/音樂');
    } catch (e) { if (e.name !== 'AbortError') toast('無法使用資料夾：' + e.message); }
  };
}
function showFolder() {
  $('#folderStatus').textContent = S.dirHandle ? `目前儲存位置：${S.dirHandle.name}/myTube/（影片、音樂）` : '尚未選擇，會存到瀏覽器的「下載」資料夾。';
}
if (isIOS()) {
  $('#iosSaveHint').innerHTML = '📱 <b>iPhone：</b>下載好的檔案會<b>自動保存在 myTube 裡</b>，直接在「影片」「音樂」分頁就能播放。要放進「檔案」App 時，按紀錄上的「存到檔案」→「儲存到檔案」→ 選 <b>myTube › 影片</b> 或 <b>myTube › 音樂</b>（第一次請先在「檔案」App 的「我的 iPhone」建立這幾個資料夾）。';
} else if (/Android/i.test(navigator.userAgent)) {
  $('#iosSaveHint').innerHTML = '📱 <b>Android：</b>檔案會保存在 myTube 裡，也會自動存一份到手機的「下載」資料夾，檔名就是影片標題。';
}

/* ---------- 長期保存 ---------- */
function isStandalone() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
function needsInstall() { return isIOS() && !isStandalone(); }
async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
async function refreshStorageInfo() {
  try {
    const e = await navigator.storage.estimate();
    const kept = await navigator.storage.persisted?.();
    $('#storageInfo').textContent = `myTube 已使用 ${fmtSize(e.usage) || '0 KB'}／可用約 ${fmtSize(e.quota)}` +
      (isStandalone() ? '・桌面 App 模式（資料長期保存）' : (isIOS() ? '・⚠️ 目前在 Safari 網頁裡，請加到主畫面' : (kept ? '・已開啟長期保存' : '')));
  } catch {}
}
if (needsInstall() && LS.get('bannerOff') !== '1') $('#installBanner').hidden = false;
$('#bannerClose').onclick = () => { $('#installBanner').hidden = true; LS.set('bannerOff', '1'); };

/* ---------------- 啟動 ---------------- */
(async function init() {
  try {
    const [media, pls, hist] = await Promise.all([DB.all('media'), DB.all('playlists'), DB.all('history')]);
    S.media = media || []; S.playlists = pls || [];
    S.history = (hist || []).sort((a, b) => b.created - a.created);
    for (const h of S.history) if (!['done', 'error', 'external', 'imported'].includes(h.status)) { h.status = 'error'; h.error = '下載中斷，請按重試'; DB.put('history', h); }
    S.dirHandle = (await DB.get('kv', 'dir').catch(() => null)) || null;
  } catch (e) { console.error(e); toast('無法開啟資料庫：' + e.message); }

  S.fmt = LS.get('fmt') || 'mp4';
  $$('#formatSeg button').forEach(b => b.classList.toggle('active', b.dataset.fmt === S.fmt));
  applyMode();
  $('#autoSaveChk').checked = LS.get('autoSave') !== '0';
  $('#autoSaveChk').onchange = e => LS.set('autoSave', e.target.checked ? '1' : '0');
  showFolder();
  renderLibrary(); renderHistory();
  showPage(LS.get('page') || 'video');

  // 如果網頁本身就是由下載伺服器提供，自動填入網址
  if (!getServer() && /^https?:$/.test(location.protocol)) {
    try { const r = await fetch(location.origin + '/api/health', { cache: 'no-store' }); if (r.ok) { serverInput.value = location.origin; LS.set('server', location.origin); } } catch {}
  }
  if (getServer()) testServer(true);

  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    navigator.serviceWorker?.register('sw.js').catch(() => {});
  }
})();

// 「複製」按鈕
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  const t = document.getElementById(b.dataset.copy)?.textContent || '';
  try { await navigator.clipboard.writeText(t); toast('已複製'); } catch { toast('請長按文字手動複製'); }
});
