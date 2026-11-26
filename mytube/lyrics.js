/* =========================================================
   myTube 歌詞：播放音樂時自動上網找歌詞（LRCLIB → 換個歌名再找 → lyrics.ovh），
   唱到哪一行就放大發亮；不是中文的歌詞自動翻成中文；找不到就不顯示（可以自己載入或貼上）
   ========================================================= */
'use strict';

const LY = { id: null, rec: null, lines: [], cur: -1, raf: 0, showTrans: LS.get('lyrTrans') !== '0', big: false, req: 0 };
const lyrKey = id => 'lyr_' + id;
const lyBox = $('#lyrics'), lyList = $('#lyList');

/* ---------- 歌名整理：YouTube 標題常有「(Official MV)」「【中字】」之類 ---------- */
function cleanTitle(t) {
  return String(t || '')
    .replace(/\.(mp3|m4a|aac|wav|flac|mp4|mov|webm)$/i, '')
    .replace(/[\[【(（「『][^\]】)）」』]*(official|mv|m\/v|lyric|lyrics|audio|video|hd|hq|4k|動態歌詞|歌詞|中字|字幕|完整版|官方|高音質|live|ver\.?|version|visualizer|music)[^\]】)）」』]*[\]】)）」』]/gi, '')
    .replace(/\b(official\s*(music\s*)?(video|audio|mv)|lyrics?\s*video|music\s*video|mv)\b/gi, '')
    .replace(/[|｜].*$/, '')
    .replace(/\s+(ft\.?|feat\.?)\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ').trim();
}
// 回傳幾種「歌手／歌名」的猜法
function guesses(title) {
  const c = cleanTitle(title);
  const out = [];
  const m = c.split(/\s+[-–—－~]\s+|\s*[-–—－]\s*(?=\S)/);
  if (m.length >= 2) {
    out.push({ artist: m[0].trim(), track: m.slice(1).join(' ').trim() });
    out.push({ artist: m.slice(1).join(' ').trim(), track: m[0].trim() });
  }
  const q = c.replace(/[-–—－~]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return { list: out, q, clean: c };
}

/* ---------- 歌詞來源 ---------- */
async function getJSON(url, ms = 9000) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) return null; return await r.json(); }
  catch { return null; } finally { clearTimeout(to); }
}
const LRC = 'https://lrclib.net/api';
function pickBest(arr, dur) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const score = x => (x.syncedLyrics ? 0 : 30) + (dur && x.duration ? Math.abs(x.duration - dur) : 15) + (x.instrumental ? 99 : 0);
  const ok = arr.filter(x => (x.syncedLyrics || x.plainLyrics) && (!dur || !x.duration || Math.abs(x.duration - dur) < 25));
  return (ok.length ? ok : []).sort((a, b) => score(a) - score(b))[0] || null;
}
async function findLyrics(title, dur, manualQ) {
  const g = manualQ ? { list: [], q: manualQ, clean: manualQ } : guesses(title);
  const tries = [];
  // ① LRCLIB：歌手＋歌名＋長度（最準）
  for (const x of g.list) if (dur) tries.push(async () => {
    const j = await getJSON(`${LRC}/get?artist_name=${encodeURIComponent(x.artist)}&track_name=${encodeURIComponent(x.track)}&duration=${Math.round(dur)}`);
    return j && (j.syncedLyrics || j.plainLyrics) && !j.instrumental ? j : null;
  });
  // ② LRCLIB：用整個歌名搜尋
  tries.push(async () => pickBest(await getJSON(`${LRC}/search?q=${encodeURIComponent(g.q)}`), dur));
  for (const x of g.list) tries.push(async () => pickBest(await getJSON(`${LRC}/search?track_name=${encodeURIComponent(x.track)}&artist_name=${encodeURIComponent(x.artist)}`), dur));
  // ③ LRCLIB：只用歌名（去掉歌手）
  for (const x of g.list) tries.push(async () => pickBest(await getJSON(`${LRC}/search?track_name=${encodeURIComponent(x.track)}`), dur));
  for (const t of tries) {
    const j = await t();
    if (j) return { src: 'LRCLIB', synced: j.syncedLyrics || '', plain: j.plainLyrics || '', name: `${j.artistName || ''} - ${j.trackName || ''}` };
  }
  // ④ lyrics.ovh（沒有時間軸，只有文字）
  for (const x of g.list) {
    const j = await getJSON(`https://api.lyrics.ovh/v1/${encodeURIComponent(x.artist)}/${encodeURIComponent(x.track)}`);
    if (j?.lyrics && j.lyrics.trim().length > 20) return { src: 'lyrics.ovh', synced: '', plain: j.lyrics, name: `${x.artist} - ${x.track}` };
  }
  return null;
}

/* ---------- 解析 ---------- */
function parseLRC(txt) {
  const out = []; let offset = 0;
  for (const raw of String(txt).split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i); if (off) { offset = +off[1] / 1000; continue; }
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const t of tags) out.push({ t: +t[1] * 60 + parseFloat(t[2].replace(':', '.')) - offset, text });
  }
  return out.sort((a, b) => a.t - b.t);
}
function toLines(rec, dur) {
  if (rec.synced) { const l = parseLRC(rec.synced); if (l.length) return { lines: l, timed: true }; }
  const plain = String(rec.plain || '').split(/\r?\n/).map(s => s.trim());
  const l = plain.filter((s, i) => s || (i && plain[i - 1]));      // 留一個空行當段落
  if (!l.length) return { lines: [], timed: false };
  // 沒有時間軸：照歌的長度平均分配（大概的位置）
  const D = dur || 180, start = D * 0.06, span = D * 0.88;
  return { lines: l.map((text, i) => ({ t: start + span * i / l.length, text })), timed: false };
}

/* ---------- 翻譯成中文（中文的行不翻） ---------- */
const isChinese = s => /[一-鿿]/.test(s) && !/[ぁ-ゖァ-ヺ가-힯]/.test(s);
async function translateLyrics(rec, lines) {
  if (rec.trans && rec.trans.length === lines.length) return rec.trans;
  const need = lines.map((l, i) => [i, l.text]).filter(([, t]) => t && /\p{L}/u.test(t) && !isChinese(t));
  if (!need.length) return null;
  const out = new Array(lines.length).fill('');
  for (let k = 0; k < need.length; k += 40) {
    const part = need.slice(k, k + 40);
    try {
      const r = await translateLines(part.map(x => x[1]), 'zh-TW');
      const arr = r?.lines || r || [];
      part.forEach(([i], j) => { out[i] = arr[j] || ''; });
    } catch (e) { console.warn('lyrics translate', e); return null; }
  }
  rec.trans = out;
  DB.put('kv', rec, lyrKey(LY.id)).catch(() => {});
  return out;
}

/* ---------- 顯示 ---------- */
function render() {
  const tr = LY.showTrans ? LY.rec?.trans : null;
  lyList.innerHTML = LY.lines.map((l, i) => `<div class="ly-line${l.text ? '' : ' gap'}" data-i="${i}"><div class="ly-o">${esc(l.text) || '&nbsp;'}</div>${tr && tr[i] ? `<div class="ly-t">${esc(tr[i])}</div>` : ''}</div>`).join('');
  $('#lyNote').textContent = LY.timed ? `歌詞來源：${LY.rec.src}` : `歌詞來源：${LY.rec.src}（沒有時間軸，位置是估的）`;
  $('#lyTrans').classList.toggle('on', LY.showTrans);
  $('#lyTrans').hidden = !LY.rec?.trans;
  LY.cur = -1; tick(true);
}
function tick(force) {
  if (!LY.lines.length || lyBox.hidden) return;
  const t = audioEl.currentTime + 0.25;
  let i = -1;
  for (let k = 0; k < LY.lines.length; k++) { if (LY.lines[k].t <= t) i = k; else break; }
  if (i === LY.cur && !force) return;
  LY.cur = i;
  const els = lyList.children;
  for (let k = 0; k < els.length; k++) els[k].classList.toggle('cur', k === i);
  const el = els[Math.max(0, i)];
  if (el && !LY.userScroll) {
    const top = el.offsetTop - lyList.clientHeight / 2 + el.offsetHeight / 2;
    lyList.scrollTo({ top, behavior: force ? 'auto' : 'smooth' });
  }
}
function loop() { tick(); LY.raf = requestAnimationFrame(loop); }
function startLoop() { cancelAnimationFrame(LY.raf); if (!lyBox.hidden && LY.lines.length) LY.raf = requestAnimationFrame(loop); }
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(LY.raf); else startLoop(); });
// 自己捲動時先不要自動跳，3 秒後恢復
lyList.addEventListener('touchstart', () => { LY.userScroll = true; clearTimeout(LY.us); }, { passive: true });
lyList.addEventListener('touchend', () => { clearTimeout(LY.us); LY.us = setTimeout(() => { LY.userScroll = false; tick(true); }, 3000); }, { passive: true });
// 點一行歌詞：跳到那裡唱
lyList.onclick = e => {
  const r = e.target.closest('.ly-line'); if (!r) return;
  const l = LY.lines[+r.dataset.i]; if (!l || !LY.timed) return;
  audioEl.currentTime = Math.max(0, l.t - 0.05); if (audioEl.paused) audioEl.play().catch(() => {});
  LY.userScroll = false; tick(true);
};

function showLyrics(on) {
  lyBox.hidden = !on;
  $('#playerStage').classList.toggle('has-lyrics', on);
  $('#lyBtn').classList.toggle('on', on);
  if (on) startLoop(); else { cancelAnimationFrame(LY.raf); setBig(false); }
}
function setBig(on) {
  LY.big = on; lyBox.classList.toggle('big', on);
  // 大字報：移到最外層才能蓋滿整個螢幕；縮小時放回播放器裡
  if (on && lyBox.parentNode !== document.body) document.body.appendChild(lyBox);
  if (!on && lyBox.parentNode === document.body) $('#playerStage').insertBefore(lyBox, $('#miniTap'));
  $('#lyBig').textContent = on ? '縮小' : '⛶ 大字報';
  LY.cur = -1; setTimeout(() => tick(true), 50);
}
$('#lyBig').onclick = e => { e.stopPropagation(); setBig(!LY.big); };
$('#lyTrans').onclick = e => { e.stopPropagation(); LY.showTrans = !LY.showTrans; LS.set('lyrTrans', LY.showTrans ? '1' : '0'); render(); };
$('#lyMore').onclick = e => { e.stopPropagation(); lyricsMenu(); };
$('#lyBtn').onclick = () => {
  if (!P.item) return;
  if (LY.lines.length) return showLyrics(lyBox.hidden);
  lyricsMenu();
};

async function applyRec(m, rec) {
  LY.rec = rec;
  const { lines, timed } = toLines(rec, m.duration);
  LY.lines = lines; LY.timed = timed;
  $('#lyBtn').classList.toggle('dim', !lines.length);
  if (!lines.length) { showLyrics(false); return; }
  render();
  showLyrics(m.type === 'audio' || !lyBox.hidden);
  if (LY.showTrans || !rec.trans) {
    const tr = await translateLyrics(rec, lines).catch(() => null);
    if (tr && LY.id === m.id) render();
  }
}
async function loadLyrics(m, opts = {}) {
  const req = ++LY.req;
  LY.id = m.id; LY.lines = []; LY.rec = null; lyList.innerHTML = '';
  showLyrics(false); $('#lyBtn').classList.add('dim');
  let rec = opts.force ? null : await DB.get('kv', lyrKey(m.id)).catch(() => null);
  if (rec?.none && !opts.force && Date.now() - rec.at < 7 * 864e5) return;     // 一週內找過找不到，就先不再找
  if (!rec || rec.none) {
    if (!navigator.onLine) return;
    if (opts.force) toast('搜尋歌詞中…', 20000);
    const found = await findLyrics(m.title || m.filename, m.duration, opts.q).catch(() => null);
    if (req !== LY.req) return;
    rec = found ? { ...found, at: Date.now() } : { none: true, at: Date.now() };
    await DB.put('kv', rec, lyrKey(m.id)).catch(() => {});
    if (opts.force) toast(found ? `✅ 找到歌詞（${found.src}）` : '找不到這首歌的歌詞，可以自己載入或貼上', 3500);
  }
  if (rec.none || req !== LY.req) return;
  applyRec(m, rec);
}

/* ---------- 選單：重新搜尋／改歌名搜尋／從檔案載入／貼上／移除 ---------- */
function lyricsMenu() {
  const m = P.item; if (!m) return;
  const has = LY.lines.length > 0;
  openSheet(`<h4>📝 歌詞：${esc(m.title)}</h4>
    ${has ? `<p class="hint" style="padding:0 20px">目前的歌詞：${esc(LY.rec?.name || LY.rec?.src || '')}</p>` : '<p class="hint" style="padding:0 20px">這首歌還沒有歌詞。</p>'}
    ${has ? `<button class="sheet-item" data-a="toggle">${lyBox.hidden ? '👁 顯示歌詞' : '🙈 隱藏歌詞'}</button>` : ''}
    <button class="sheet-item" data-a="again">🔄 重新上網找歌詞</button>
    <button class="sheet-item" data-a="q">🔎 輸入歌名／歌手再找（找錯或找不到時）</button>
    <button class="sheet-item" data-a="file">📂 從手機檔案載入歌詞（.lrc／.txt）</button>
    <button class="sheet-item" data-a="paste">📋 貼上歌詞</button>
    ${has ? '<button class="sheet-item danger" data-a="del">🗑 移除這首歌的歌詞</button>' : ''}
    <button class="sheet-item" data-a="no">關閉</button>`, a => {
    if (a === 'toggle') showLyrics(lyBox.hidden);
    if (a === 'again') loadLyrics(m, { force: true });
    if (a === 'q') promptSheet('輸入歌名（可以加歌手，例如：周杰倫 晴天）', guesses(m.title).clean, q => { if (q.trim()) loadLyrics(m, { force: true, q: q.trim() }); });
    if (a === 'file') { const i = $('#lyFile'); i.value = ''; i.click(); }
    if (a === 'paste') pasteSheet(m);
    if (a === 'del') { DB.put('kv', { none: true, at: Date.now() + 3650 * 864e5 }, lyrKey(m.id)); LY.lines = []; showLyrics(false); $('#lyBtn').classList.add('dim'); toast('已移除歌詞'); }
  });
}
function pasteSheet(m) {
  openSheet(`<h4>📋 貼上歌詞</h4>
    <p class="hint" style="padding:0 20px">一行一句。如果是有時間的歌詞（像 <code>[00:12.30]第一句</code>），會跟著歌唱到哪亮到哪。</p>
    <div class="sheet-input"><textarea id="lyPaste" rows="8" placeholder="在這裡貼上歌詞"></textarea></div>
    <button class="sheet-item" data-a="ok">✅ 使用這份歌詞</button>
    <button class="sheet-item" data-a="no">取消</button>`, a => {
    if (a !== 'ok') return;
    useText(m, $('#lyPaste').value, '自己貼上的');
  });
}
async function useText(m, txt, src) {
  txt = String(txt || '').replace(/^﻿/, '');
  if (!txt.trim()) return toast('沒有歌詞內容');
  const timed = /\[\d{1,3}:\d{1,2}/.test(txt);
  const rec = { src, synced: timed ? txt : '', plain: timed ? '' : txt, name: src, at: Date.now() };
  await DB.put('kv', rec, lyrKey(m.id));
  if (P.item?.id === m.id) { LY.id = m.id; applyRec(m, rec); showLyrics(true); }
  toast('✅ 已載入歌詞');
}
$('#lyFile').onchange = async e => {
  const f = e.target.files[0]; if (!f || !P.item) return;
  let txt = await f.text();
  if (/�/.test(txt)) { try { txt = new TextDecoder('big5').decode(await f.arrayBuffer()); } catch {} }   // 舊的中文歌詞檔常是 Big5
  useText(P.item, txt, f.name);
};

/* ---------- 換歌時自動找歌詞 ---------- */
let lastId = null;
audioEl.addEventListener('loadstart', () => {
  const m = P.item; if (!m || m.id === lastId) return;
  lastId = m.id;
  $('#lyBtn').hidden = false;
  loadLyrics(m);
});
audioEl.addEventListener('seeked', () => tick(true));
$('#lyPlay').onclick = e => { e.stopPropagation(); $('#bigPlay').click(); };
lyBox.addEventListener('click', e => e.stopPropagation());       // 點歌詞不要觸發播放器的其他動作
lyBox.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
// 播放器縮小或關掉時，自動離開大字報
new MutationObserver(() => { if (LY.big && !playerBox.classList.contains('full')) setBig(false); }).observe(playerBox, { attributes: true, attributeFilter: ['class'] });
