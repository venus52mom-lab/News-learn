/* =========================================================
   myTube 照片工作室：照片一張一張接起來 → 轉場、文字、背景音樂
   匯出：MP4 短影片（WebCodecs 快速產生；不支援時用即時錄製）或 PPT（.pptx，含轉場與自動換頁）
   ========================================================= */
'use strict';

/* ---------------- 工作室下拉選單：影片音樂工作室／照片工作室 ---------------- */
const STMODES = { vm: '🎬 影片／音樂工作室', ph: '🖼️ 照片工作室', mix: '🎞️ 綜合工作室' };
const curMode = () => ({ ph: 'ph', mix: 'mix' }[LS.get('stmode')] || 'vm');
const HOME_HINT = {
  ph: '從手機照片匯入，一張一張接起來，加轉場、文字、背景音樂，做成<b>短影片</b>或 <b>PPT 簡報</b>。',
  mix: '<b>影片和照片</b>都可以放進來，排好順序、剪掉不要的部分，加轉場、文字和背景音樂，做成<b>短影片</b>。可以選音樂要蓋過影片聲音、小小聲，還是播影片時不放音樂。',
};
function applyStudioMode() {
  const m = curMode();
  $('#stVM').hidden = m !== 'vm';
  $('#phHome').hidden = m === 'vm';
  if (m !== 'vm') $('#phHomeHint').innerHTML = HOME_HINT[m];
  $('#stModeLbl').textContent = STMODES[m];
  $$('#stMenu [data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  if (m !== 'vm') renderPhHome();
}
function openStudioMenu(anchor) {
  const menu = $('#stMenu'), r = anchor.getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth;
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  setTimeout(() => document.addEventListener('click', closeStudioMenu, { once: true }), 0);
}
function closeStudioMenu() { $('#stMenu').hidden = true; }
$('#studioTab').onclick = e => { e.stopPropagation(); if ($('#stMenu').hidden) openStudioMenu(e.currentTarget); else closeStudioMenu(); };
$('#stModeBtn').onclick = e => { e.stopPropagation(); if ($('#stMenu').hidden) openStudioMenu(e.currentTarget); else closeStudioMenu(); };
$('#stMenu').onclick = e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  e.stopPropagation(); closeStudioMenu();
  LS.set('stmode', b.dataset.m);
  if (S.page !== 'studio') showPage('studio');
  applyStudioMode();
};

/* ---------------- 資料 ---------------- */
const PH = { list: [], p: null, imgs: new Map(), play: null, t: 0, music: null, musicURL: null, busy: false };
const RES = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [1080, 1080] };
const TRANS = {
  none: '無（直接切換）', fade: '淡入淡出', black: '黑場過渡', slide: '向左滑入', push: '推移',
  zoom: '放大進入', wipe: '由左擦過', random: '隨機（每次不同）',
};
const COLORS = { '#ffffff': '白', '#111111': '黑', '#ffd400': '黃', '#ff3b30': '紅', '#2f80ff': '藍' };
const FPS = 30;
const projKey = id => 'phproj_' + id;
const photoKey = (pid, sid) => `ph_${pid}_${sid}`;
const musicKey = pid => 'phm_' + pid;
const outKey = pid => 'phout_' + pid;   // 最後一次匯出的檔案（存檔失敗時可以再存一次）
const fmtS = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

async function loadProjects() {
  PH.list = (await DB.allPrefix('kv', 'phproj_')).sort((a, b) => b.updated - a.updated);
}
let saveT = 0;
function saveProj(now) {
  const p = PH.p; if (!p) return;
  p.updated = Date.now();
  clearTimeout(saveT);
  const go = () => DB.put('kv', p, projKey(p.id)).catch(e => toast('儲存失敗：' + e.message));
  if (now) return go();
  saveT = setTimeout(go, 400);
}
function totalDur(p) { return p.slides.reduce((a, s) => a + s.d, 0); }
function clipCount(p) {
  const v = p.slides.filter(s => s.kind === 'video').length, ph = p.slides.length - v;
  return [ph && `${ph} 張照片`, v && `${v} 段影片`].filter(Boolean).join('、') || '0 張';
}

/* ---------------- 首頁：作品清單 ---------------- */
const kindOf = p => p.kind || 'photo';
async function renderPhHome() {
  await loadProjects();
  const want = curMode() === 'mix' ? 'mix' : 'photo';
  const list = PH.list.filter(p => kindOf(p) === want);
  const box = $('#phList');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg><div>還沒有作品<br><small>按「＋ 新增作品」從手機${want === 'mix' ? '影片和照片' : '照片'}開始</small></div></div>`;
    return;
  }
  box.innerHTML = list.map(p => `<div class="mrow" data-id="${p.id}">
    <img class="mart" src="${p.slides[0]?.thumb || ''}" alt="" style="background:#222;object-fit:cover">
    <div class="mtext"><div class="mtitle">${esc(p.name)}</div>
      <div class="msub">${p.target === 'ppt' ? '📊 PPT' : '🎬 短影片'} · ${clipCount(p)} · ${fmtS(totalDur(p))}</div></div>
    <button class="more-btn" data-a="more">${ICON.more}</button></div>`).join('');
}
$('#phList').onclick = e => {
  const r = e.target.closest('.mrow'); if (!r) return;
  const p = PH.list.find(x => x.id === r.dataset.id); if (!p) return;
  if (e.target.closest('[data-a=more]')) return projMenu(p);
  openEditor(p);
};
function projMenu(p) {
  openSheet(`<h4>${esc(p.name)}</h4>
    <button class="sheet-item" data-a="open">✏️ 編輯</button>
    <button class="sheet-item" data-a="ren">🔤 重新命名</button>
    <button class="sheet-item danger" data-a="del">🗑 刪除作品</button>`, a => {
    if (a === 'open') openEditor(p);
    if (a === 'ren') promptSheet('作品名稱', p.name, async n => { p.name = n.trim() || p.name; p.updated = Date.now(); await DB.put('kv', p, projKey(p.id)); renderPhHome(); });
    if (a === 'del') openSheet(`<h4>刪除「${esc(p.name)}」？</h4><p class="hint" style="padding:0 20px">作品和裡面匯入的照片副本會刪除（手機「照片」App 裡的原始照片不會被刪）。</p>
      <button class="sheet-item danger" data-a="y">刪除</button><button class="sheet-item" data-a="n">取消</button>`, async x => {
      if (x !== 'y') return;
      await DB.delPrefix('blobs', `ph_${p.id}_`); await DB.del('blobs', musicKey(p.id)); await DB.del('blobs', outKey(p.id)); await DB.del('kv', projKey(p.id));
      renderPhHome(); toast('已刪除');
    });
  });
}
$('#phNew').onclick = () => {
  const n = PH.list.length + 1;
  if (curMode() === 'mix') {
    openSheet(`<h4>＋ 新增綜合作品</h4>
      <p class="hint" style="padding:0 20px;margin:0"><b>作品名稱</b></p>
      <div class="sheet-input"><input id="phNewName" value="我的影片 ${n}"></div>
      <button class="sheet-item" data-a="mix">🎞️ 選影片和照片（可以一次選很多個）</button>
      <p class="hint" style="padding:0 20px">之後還可以再加，也可以從 myTube 的影片裡選。</p>`, a => {
      if (a !== 'mix') return;
      const p = {
        id: uid(), kind: 'mix', name: ($('#phNewName').value || '').trim() || `我的影片 ${n}`, target: 'video',
        ratio: '9:16', fit: 'contain', dur: 3, trans: 'fade', tdur: 0.6, kb: true, amix: 'duck',
        music: null, slides: [], created: Date.now(), updated: Date.now(),
      };
      $('#phFile').accept = 'image/*,video/*';
      $('#phFile').click();
      openEditor(p, true);
    });
    return;
  }
  openSheet(`<h4>＋ 新增作品</h4>
    <p class="hint" style="padding:0 20px;margin:0"><b>① 作品名稱</b></p>
    <div class="sheet-input"><input id="phNewName" value="我的作品 ${n}"></div>
    <p class="hint" style="padding:6px 20px 0;margin:0"><b>② 要做成什麼？</b>（之後也可以改）</p>
    <button class="sheet-item" data-a="video">🎬 短影片（MP4，可以加背景音樂）</button>
    <button class="sheet-item" data-a="ppt">📊 PPT 簡報（.pptx，可以輸入文字、之後還能在 PowerPoint／Keynote 修改）</button>
    <p class="hint" style="padding:0 20px">選好後會打開手機照片，選要用的照片（可以一次選很多張）。</p>`, a => {
    if (a !== 'video' && a !== 'ppt') return;
    const p = {
      id: uid(), name: ($('#phNewName').value || '').trim() || `我的作品 ${n}`, target: a,
      ratio: a === 'ppt' ? '16:9' : '9:16', fit: 'contain', dur: 3, trans: 'fade', tdur: 0.8, kb: a !== 'ppt',
      music: null, slides: [], created: Date.now(), updated: Date.now(),
    };
    $('#phFile').accept = 'image/*';
    $('#phFile').click();             // iPhone 規定：要在點擊當下打開照片選擇
    openEditor(p, true);
  });
};

/* ---------------- 編輯畫面 ---------------- */
const cv = $('#phCanvas'), cx = cv.getContext('2d');
async function openEditor(p, isNew) {
  if (P.item && !audioEl.paused) audioEl.pause();
  PH.p = p; PH.t = 0; clearImgs(); stopPreview();
  if (kindOf(p) === 'mix') { p.target = 'video'; p.amix = p.amix || 'duck'; }
  $('#phFile').accept = kindOf(p) === 'mix' ? 'image/*,video/*' : 'image/*';
  if (isNew) saveProj(true);
  $('#phTitle').textContent = p.name;
  $('#phEditor').hidden = false; document.body.style.overflow = 'hidden';
  if (!history.state?.phed) history.pushState({ phed: 1 }, '');
  await loadMusic();
  syncControls(); renderSlides(); drawAt(0);
}
function closeEditor(fromPop) {
  if ($('#phEditor').hidden) return;
  stopPreview(); saveProj(true);
  $('#phEditor').hidden = true; document.body.style.overflow = '';
  if (PH.musicURL) { URL.revokeObjectURL(PH.musicURL); PH.musicURL = null; }
  clearImgs();
  if (!fromPop && history.state?.phed) history.back();
  renderPhHome();
}
$('#phBack').onclick = () => closeEditor();
addEventListener('popstate', () => { if (!$('#phEditor').hidden && !history.state?.phed) closeEditor(true); });

function segSet(id, v) { $$(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset.v === v)); }
function syncControls() {
  const p = PH.p;
  segSet('phTarget', p.target); segSet('phRatio', p.ratio); segSet('phFit', p.fit);
  $('#phDur').textContent = p.dur.toFixed(1) + ' 秒';
  $('#phTDur').textContent = p.tdur.toFixed(1) + ' 秒';
  $('#phTrans').innerHTML = Object.entries(TRANS).map(([k, v]) => `<option value="${k}"${k === p.trans ? ' selected' : ''}>${v}</option>`).join('');
  $('#phKB').checked = !!p.kb;
  const mix = kindOf(p) === 'mix';
  $('#phTargetRow').hidden = mix;
  $('#phAmixRow').hidden = !mix; $('#phAmixNote').hidden = !mix;
  $('#phAmix').value = p.amix || 'duck';
  $('#phLibVid').hidden = !mix;
  $('#phAdd').textContent = mix ? '＋ 加入影片／照片' : '＋ 從照片加入';
  $('#phMusicRow').hidden = p.target === 'ppt';
  $('#phPptNote').hidden = p.target !== 'ppt';
  $('#phMusicName').textContent = p.music ? '🎵 ' + p.music.name : '沒有';
  $('#phMusicDel').hidden = !p.music;
  $('#phExport').textContent = p.target === 'ppt' ? '匯出 PPT' : '匯出影片';
  const [w, h] = RES[p.ratio]; cv.width = w; cv.height = h;
  updTime();
}
const onSeg = (id, key, after) => $('#' + id).onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  PH.p[key] = b.dataset.v; saveProj(); syncControls(); after?.(); drawAt(PH.t);
};
onSeg('phTarget', 'target', () => { if (PH.p.target === 'ppt' && PH.p.ratio === '9:16') { /* 保留使用者的比例 */ } });
onSeg('phRatio', 'ratio'); onSeg('phFit', 'fit');
$('#phAmix').onchange = e => { PH.p.amix = e.target.value; saveProj(); };
$('#phTrans').onchange = e => { PH.p.trans = e.target.value; saveProj(); drawAt(PH.t); };
$('#phKB').onchange = e => { PH.p.kb = e.target.checked; saveProj(); drawAt(PH.t); };
$$('.ph-step').forEach(st => st.onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const p = PH.p, d = +b.dataset.d;
  if (st.dataset.k === 'dur') p.dur = clamp(Math.round((p.dur + d) * 10) / 10, 0.5, 30);
  else p.tdur = clamp(Math.round((p.tdur + d) * 10) / 10, 0.2, 3);
  saveProj(); syncControls();
});
$('#phDurAll').onclick = () => { PH.p.slides.forEach(s => { if (s.kind !== 'video') s.d = PH.p.dur; }); saveProj(); renderSlides(); updTime(); toast(`每張照片都改成 ${PH.p.dur} 秒`); };

/* ---------------- 照片清單 ---------------- */
function renderSlides() {
  const p = PH.p;
  $('#phCount').textContent = `${clipCount(p)} · 共 ${fmtS(totalDur(p))}`;
  $('#phSlides').innerHTML = p.slides.length ? p.slides.map((s, i) => `<div class="ph-slide" data-i="${i}">
    <img src="${s.thumb}" alt="" data-a="go">
    <div class="ph-sl-mid"><b>${s.kind === 'video' ? `🎬 第 ${i + 1} 段 <button class="mini-btn" data-a="trim">✂️ ${fmtS(s.in)}–${fmtS(s.out)}</button>` : `第 ${i + 1} 張`}</b>${s.text?.title || s.text?.body ? `<small>📝 ${esc((s.text.title || s.text.body).slice(0, 14))}</small>` : ''}
      <div class="ph-step sm"><button data-a="dm">−</button><b>${s.d.toFixed(1)}秒</b><button data-a="dp">＋</button></div></div>
    <div class="ph-sl-btns"><button data-a="txt" class="${s.text ? 'on' : ''}">✏️</button><button data-a="up">↑</button><button data-a="down">↓</button><button data-a="rm">✕</button></div>
  </div>`).join('')
  : `<p class="hint" style="text-align:center;padding:20px">還沒有${kindOf(p) === 'mix' ? '影片或照片，按「＋ 加入影片／照片」' : '照片，按「＋ 從照片加入」'}</p>`;
}
$('#phSlides').onclick = e => {
  const b = e.target.closest('[data-a]'); const row = e.target.closest('.ph-slide'); if (!b || !row) return;
  const p = PH.p, i = +row.dataset.i, s = p.slides[i], a = b.dataset.a;
  if (a === 'go') { stopPreview(); drawAt(slideStart(i) + 0.01); return; }
  if ((a === 'dm' || a === 'dp') && s.kind === 'video') { s.out = clamp(Math.round((s.out + (a === 'dp' ? 0.5 : -0.5)) * 10) / 10, s.in + 0.5, s.len); s.d = +(s.out - s.in).toFixed(2); }
  else if (a === 'dm' || a === 'dp') s.d = clamp(Math.round((s.d + (a === 'dp' ? 0.5 : -0.5)) * 10) / 10, 0.5, 30);
  if (a === 'trim') return trimSheet(i);
  if (a === 'up' && i > 0) [p.slides[i - 1], p.slides[i]] = [p.slides[i], p.slides[i - 1]];
  if (a === 'down' && i < p.slides.length - 1) [p.slides[i + 1], p.slides[i]] = [p.slides[i], p.slides[i + 1]];
  if (a === 'rm') { if (!s.lib) DB.del('blobs', photoKey(p.id, s.id)); dropImg(s.id); p.slides.splice(i, 1); }
  if (a === 'txt') return textSheet(i);
  saveProj(); renderSlides(); updTime(); drawAt(Math.min(PH.t, totalDur(p)));
};
$('#phAdd').onclick = () => $('#phFile').click();
$('#phFile').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length || !PH.p) return;
  const p = PH.p; let ok = 0;
  for (let k = 0; k < files.length; k++) {
    toast(`加入照片 ${k + 1} / ${files.length}…`, 60000);
    try {
      let s;
      if (/^video\//.test(files[k].type) || /\.(mov|mp4|m4v|webm)$/i.test(files[k].name)) {
        if (kindOf(p) !== 'mix') { toast('照片工作室只能放照片；要放影片請用「綜合工作室」', 3500); continue; }
        s = await videoSlide(files[k]);
        await DB.put('blobs', files[k], photoKey(p.id, s.id));
      } else {
        const { blob, thumb, w, h } = await shrinkPhoto(files[k]);
        s = { id: uid(), d: p.dur, thumb, w, h, text: null };
        await DB.put('blobs', blob, photoKey(p.id, s.id));
      }
      p.slides.push(s); ok++;
      if (ok === 1 || k === files.length - 1) { renderSlides(); updTime(); }
    } catch (err) { console.warn(err); }
  }
  saveProj(true); renderSlides(); updTime(); drawAt(PH.t);
  if (ok) toast(ok === files.length ? `✅ 加入 ${ok} 個` : `加入 ${ok} 個，${files.length - ok} 個沒有加入`, 2500);
};
const blobToDataURL = b => new Promise(r => { if (!b) return r(''); const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(''); fr.readAsDataURL(b); });
async function videoSlide(blob, lib) {
  const pv = await probeVideo(blob);
  const len = pv.duration || 0;
  if (!len) throw new Error('讀不到這個影片');
  return { id: uid(), kind: 'video', lib: lib || undefined, len: +len.toFixed(2), in: 0, out: +len.toFixed(2), d: +len.toFixed(2), thumb: await blobToDataURL(pv.thumb), text: null };
}
$('#phLibVid').onclick = () => {
  const list = S.media.filter(m => m.type === 'video');
  if (!list.length) return toast('myTube 的「影片」裡還沒有影片');
  openSheet(`<h4>從 myTube 影片選</h4>${list.map(m => `<button class="sheet-item" data-a="${m.id}">🎬 ${esc(m.title)} <small style="color:var(--text2)">${fmtTime(m.duration)}</small></button>`).join('')}`, async id => {
    const m = list.find(x => x.id === id); if (!m) return;
    toast('讀取影片…', 30000);
    try {
      const b = await DB.get('blobs', m.id);
      const s = await videoSlide(b, m.id);
      PH.p.slides.push(s); saveProj(true); renderSlides(); updTime(); drawAt(PH.t);
      toast('✅ 已加入「' + m.title + '」');
    } catch (e) { toast('加入失敗：' + e.message); }
  });
};
// 影片剪掉頭尾：用播放器找到位置，按「設為開始／設為結束」
function trimSheet(i) {
  const p = PH.p, s = p.slides[i];
  let a = s.in, b = s.out, url = '';
  openSheet(`<h4>✂️ 第 ${i + 1} 段：只用影片的哪一段？</h4>
    <video id="phTrimV" playsinline controls muted style="width:calc(100% - 32px);margin:0 16px;max-height:34vh;background:#000;border-radius:10px"></video>
    <p class="hint" style="padding:0 20px;text-align:center" id="phTrimLbl"></p>
    <div class="row" style="gap:8px;padding:0 16px;justify-content:center"><button class="pill-btn" data-a="in" data-keep>⏮ 設為開始</button><button class="pill-btn" data-a="out" data-keep>設為結束 ⏭</button></div>
    <button class="sheet-item" data-a="ok">✅ 儲存</button>
    <button class="sheet-item" data-a="reset" data-keep>↺ 用整段影片</button>
    <button class="sheet-item" data-a="no">取消</button>`, act => {
    const v = $('#phTrimV');
    if (act === 'in') { a = Math.min(v.currentTime, b - 0.5); lbl(); }
    if (act === 'out') { b = Math.max(v.currentTime, a + 0.5); lbl(); }
    if (act === 'reset') { a = 0; b = s.len; lbl(); }
    if (act === 'ok') { s.in = +Math.max(0, a).toFixed(2); s.out = +Math.min(b, s.len).toFixed(2); s.d = +(s.out - s.in).toFixed(2); saveProj(); renderSlides(); updTime(); stopPreview(); drawAt(slideStart(i) + 0.01); }
    if (act === 'ok' || act === 'no') { v?.pause(); URL.revokeObjectURL(url); }
  });
  const lbl = () => { $('#phTrimLbl').textContent = `開始 ${fmtS(a)}　結束 ${fmtS(b)}　（共 ${(b - a).toFixed(1)} 秒）`; };
  lbl();
  slideBlob(p, s).then(bl => { if (!bl) return; url = URL.createObjectURL(bl); const v = $('#phTrimV'); if (v) { v.src = url; v.currentTime = a; } });
}
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  const MAX = 1920, k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('轉換失敗')), 'image/jpeg', 0.9));
  const tk = 200 / Math.max(w, h), t = document.createElement('canvas');
  t.width = Math.round(w * tk); t.height = Math.round(h * tk);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  bmp.close?.();
  return { blob, thumb: t.toDataURL('image/jpeg', 0.75), w, h };
}

/* 文字（像 PPT 一樣：標題＋內文，位置、大小、顏色、底色） */
function textSheet(i) {
  const s = PH.p.slides[i], t = s.text || { title: '', body: '', pos: 'bottom', size: 'm', color: '#ffffff', band: true };
  const seg = (name, opts, v) => `<div class="seg small" data-n="${name}">${Object.entries(opts).map(([k, l]) => `<button data-v="${k}" class="${k === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h4>✏️ 第 ${i + 1} 張的文字</h4>
    <div class="sheet-input"><input id="phTxtTitle" value="${esc(t.title)}" placeholder="標題（可以空白）"></div>
    <div class="sheet-input"><textarea id="phTxtBody" rows="3" placeholder="內文（可以換行，可以空白）">${esc(t.body)}</textarea></div>
    <div class="ph-tx"><span>位置</span>${seg('pos', { top: '上', middle: '中', bottom: '下' }, t.pos)}</div>
    <div class="ph-tx"><span>大小</span>${seg('size', { s: '小', m: '中', l: '大' }, t.size)}</div>
    <div class="ph-tx"><span>顏色</span><div class="ph-colors">${Object.entries(COLORS).map(([c, l]) => `<button data-c="${c}" class="${c === t.color ? 'on' : ''}" style="background:${c}" aria-label="${l}"></button>`).join('')}</div></div>
    <label class="sheet-item"><input type="checkbox" id="phTxtBand" ${t.band ? 'checked' : ''}> 文字加半透明底色（比較好讀）</label>
    <button class="sheet-item" data-a="ok">✅ 儲存文字</button>
    ${s.text ? '<button class="sheet-item danger" data-a="clr">🗑 清除這張的文字</button>' : ''}
    <button class="sheet-item" data-a="no">取消</button>`, a => {
    if (a === 'ok') {
      const nt = { title: $('#phTxtTitle').value.trim(), body: $('#phTxtBody').value.trim(), pos: cur.pos, size: cur.size, color: cur.color, band: $('#phTxtBand').checked };
      s.text = nt.title || nt.body ? nt : null;
    }
    if (a === 'clr') s.text = null;
    if (a === 'ok' || a === 'clr') { saveProj(); renderSlides(); stopPreview(); drawAt(slideStart(i) + Math.min(s.d * 0.5, 1)); }
  });
  const cur = { pos: t.pos, size: t.size, color: t.color };
  $$('#sheet .seg[data-n]').forEach(g => g.onclick = e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); cur[g.dataset.n] = b.dataset.v; $$('button', g).forEach(x => x.classList.toggle('active', x === b)); });
  $('#sheet .ph-colors').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; e.stopPropagation(); cur.color = b.dataset.c; $$('#sheet .ph-colors button').forEach(x => x.classList.toggle('on', x === b)); };
}

/* ---------------- 背景音樂 ---------------- */
async function musicBlob(p) {
  if (!p.music) return null;
  return p.music.kind === 'lib' ? DB.get('blobs', p.music.mediaId) : DB.get('blobs', musicKey(p.id));
}
async function loadMusic() {
  if (PH.musicURL) { URL.revokeObjectURL(PH.musicURL); PH.musicURL = null; }
  const b = await musicBlob(PH.p).catch(() => null);
  if (PH.p.music && !b) { PH.p.music = null; saveProj(); }
  PH.musicURL = b ? URL.createObjectURL(b) : null;
  if (!PH.music) { PH.music = new Audio(); PH.music.preload = 'auto'; PH.music.loop = true; }
  if (PH.musicURL) PH.music.src = PH.musicURL; else PH.music.removeAttribute('src');
}
$('#phMusicFile').onclick = () => $('#phMusicInput').click();
$('#phMusicInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  await DB.put('blobs', f, musicKey(PH.p.id));
  PH.p.music = { kind: 'file', name: f.name.replace(/\.[^.]+$/, ''), ext: (f.name.match(/\.([a-z0-9]{2,4})$/i)?.[1] || 'mp3').toLowerCase() };
  saveProj(); await loadMusic(); syncControls(); toast('✅ 已加入背景音樂');
};
$('#phMusicLib').onclick = () => {
  const list = S.media.filter(m => m.type === 'audio');
  if (!list.length) return toast('myTube 的「音樂」裡還沒有歌');
  openSheet(`<h4>選背景音樂</h4>${list.map(m => `<button class="sheet-item" data-a="${m.id}">🎵 ${esc(m.title)} <small style="color:var(--text2)">${fmtTime(m.duration)}</small></button>`).join('')}`, async id => {
    const m = list.find(x => x.id === id); if (!m) return;
    PH.p.music = { kind: 'lib', mediaId: m.id, name: m.title, ext: (m.filename?.match(/\.([a-z0-9]{2,4})$/i)?.[1] || (m.mime?.includes('mp4') ? 'm4a' : 'mp3')).toLowerCase() };
    await DB.del('blobs', musicKey(PH.p.id));
    saveProj(); await loadMusic(); syncControls(); toast('✅ 已加入背景音樂');
  });
};
$('#phMusicDel').onclick = async () => { PH.p.music = null; await DB.del('blobs', musicKey(PH.p.id)); saveProj(); await loadMusic(); syncControls(); };

/* ---------------- 畫面繪製（預覽和匯出共用） ---------------- */
function slideStart(i) { let t = 0; for (let k = 0; k < i; k++) t += PH.p.slides[k].d; return t; }
function transAt(p, i) {          // 第 i 張 → 第 i+1 張用哪種轉場
  if (p.trans !== 'random') return p.trans;
  const keys = ['fade', 'black', 'slide', 'push', 'zoom', 'wipe'];
  let h = 7; for (const c of p.slides[i].id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return keys[h % keys.length];
}
function transLen(p, i) {
  if (p.trans === 'none' || i >= p.slides.length - 1) return 0;
  return Math.min(p.tdur, p.slides[i].d / 2, p.slides[i + 1].d / 2);
}
// 給某個時間點，回傳要畫哪幾張
function frameInfo(p, t) {
  let st = 0;
  for (let i = 0; i < p.slides.length; i++) {
    const d = p.slides[i].d;
    if (t < st + d || i === p.slides.length - 1) {
      const lt = t - st, T = transLen(p, i);
      if (T && lt > d - T) return { i, lt, j: i + 1, pr: (lt - (d - T)) / T, kind: transAt(p, i), ltj: lt - d };
      return { i, lt };
    }
    st += d;
  }
  return null;
}
const slideBlob = (p, s) => DB.get('blobs', s.lib || photoKey(p.id, s.id));
function dropImg(id) {
  const v = PH.imgs.get(id); if (!v) return;
  v.bmp?.close?.();
  if (v.vid) { v.vid.pause(); v.vid.removeAttribute('src'); v.vid.load(); URL.revokeObjectURL(v.url); }
  PH.imgs.delete(id);
}
function clearImgs() { for (const k of [...PH.imgs.keys()]) dropImg(k); }
async function getImg(p, s) {
  if (PH.imgs.has(s.id)) { const r = PH.imgs.get(s.id); await r.p; return r; }
  const rec = { bmp: null, bg: null, p: null, vid: null };
  PH.imgs.set(s.id, rec);
  rec.p = (async () => {
    const b = await slideBlob(p, s);
    if (!b) return;
    if (s.kind === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
      rec.url = URL.createObjectURL(b); v.src = rec.url;
      await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); });
      v.currentTime = s.in;
      await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
      rec.vid = v;
      rec.bg = document.createElement('canvas'); rec.bg.width = 40; rec.bg.height = Math.max(2, Math.round(40 * (v.videoHeight || 9) / (v.videoWidth || 16)));
      return;
    }
    rec.bmp = await createImageBitmap(b);
    const bg = document.createElement('canvas'), k = 40 / Math.max(rec.bmp.width, rec.bmp.height);
    bg.width = Math.max(2, Math.round(rec.bmp.width * k)); bg.height = Math.max(2, Math.round(rec.bmp.height * k));
    bg.getContext('2d').drawImage(rec.bmp, 0, 0, bg.width, bg.height);
    rec.bg = bg;
  })();
  // 只留最近幾張在記憶體，避免照片很多時 iPhone 記憶體不夠
  if (PH.imgs.size > 6) for (const [k, v] of PH.imgs) { if (PH.imgs.size <= 6) break; if (k !== s.id && (v.bmp || v.vid) && !PH.keep?.has(k)) dropImg(k); }
  await rec.p;
  return rec;
}
function imgNow(s) { const r = PH.imgs.get(s.id); return r && (r.bmp || r.vid) ? r : null; }
async function ensureFor(p, f, exact) {
  if (!f) return;
  PH.keep = new Set([p.slides[f.i].id, f.j != null && p.slides[f.j].id].filter(Boolean));
  const A = await getImg(p, p.slides[f.i]);
  const B = f.j != null ? await getImg(p, p.slides[f.j]) : null;
  if (exact) {          // 匯出／暫停時：把影片轉到正確的那一格
    if (A?.vid) await seekVid(A.vid, p.slides[f.i].in + f.lt);
    if (B?.vid) await seekVid(B.vid, p.slides[f.j].in + Math.max(0, f.ltj));
  }
  const n = p.slides[f.i + 1]; if (n && !PH.imgs.has(n.id)) getImg(p, n);   // 預先讀下一張
}
function seekVid(v, t) {
  t = clamp(t, 0, Math.max(0, (v.duration || t + 1) - 0.04));
  if (Math.abs(v.currentTime - t) < 0.002 && v.readyState >= 2) return Promise.resolve();
  if (!v.paused) v.pause();
  return new Promise(r => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); r(); };
    const to = setTimeout(done, 3000);
    v.addEventListener('seeked', done); v.currentTime = t;
  });
}
// 預覽播放時：讓目前這段影片跟著時間播
function liveSync(p, f) {
  const act = new Map();
  if (f) { act.set(p.slides[f.i].id, { s: p.slides[f.i], lt: f.lt, main: true }); if (f.j != null) act.set(p.slides[f.j].id, { s: p.slides[f.j], lt: 0, main: false }); }
  let videoOn = false;
  for (const [id, r] of PH.imgs) {
    if (!r.vid) continue;
    const a = act.get(id), v = r.vid;
    if (!a || !a.main) { if (!v.paused) v.pause(); if (a && Math.abs(v.currentTime - a.s.in) > 0.05) v.currentTime = a.s.in; continue; }
    videoOn = true;
    const target = a.s.in + a.lt;
    const wantSound = !(PH.musicURL && p.amix === 'cover');
    if (v.muted === wantSound) v.muted = !wantSound;
    if (v.paused) { v.currentTime = target; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
    else if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
  }
  if (PH.music && PH.musicURL) PH.music.volume = !videoOn || p.amix === 'cover' ? 1 : p.amix === 'duck' ? 0.25 : 0;
}
function pauseVids() { for (const r of PH.imgs.values()) r.vid?.pause(); }
function coverRect(iw, ih, W, H) { const k = Math.max(W / iw, H / ih); return [(W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k]; }
function containRect(iw, ih, W, H) { const k = Math.min(W / iw, H / ih); return [(W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k]; }
function drawPhoto(c, p, s, lt, W, H) {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  const r = imgNow(s); if (!r) return;
  const bmp = r.vid || r.bmp, bg = r.bg;
  const iw = r.vid ? r.vid.videoWidth : bmp.width, ih = r.vid ? r.vid.videoHeight : bmp.height;
  if (r.vid) { if (!iw) return; try { bg.getContext('2d').drawImage(r.vid, 0, 0, bg.width, bg.height); } catch {} }
  if (p.fit === 'contain') {
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low';
    c.drawImage(bg, ...coverRect(bg.width, bg.height, W * 1.1, H * 1.1).map((v, k) => k < 2 ? v - (k ? H : W) * 0.05 : v));
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, H); c.restore();
  }
  const z = p.kb && !r.vid ? 1 + 0.08 * clamp(lt / s.d, 0, 1) : 1;
  c.save(); c.imageSmoothingQuality = 'high';
  c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2);
  c.drawImage(bmp, ...(p.fit === 'contain' ? containRect : coverRect)(iw, ih, W, H));
  c.restore();
}
function wrapLines(c, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    // 中日文一個字一個字斷；英文以單字斷
    const toks = para.match(/[　-鿿가-힯＀-￯]|[^\s　-鿿가-힯＀-￯]+|\s+/g) || [''];
    for (const tk of toks) {
      const test = line + tk;
      if (c.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = tk.trimStart(); }
      else line = test;
    }
    out.push(line.trimEnd());
  }
  return out;
}
const FONT = '-apple-system, "PingFang TC", "Heiti TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const TSIZE = { s: 0.055, m: 0.07, l: 0.09 };
function drawText(c, t, W, H) {
  if (!t || (!t.title && !t.body)) return;
  const base = Math.min(W, H), ts = base * TSIZE[t.size || 'm'], bs = ts * 0.62, maxW = W * 0.84;
  c.save(); c.textAlign = 'center'; c.textBaseline = 'top';
  c.font = `700 ${ts}px ${FONT}`; const tl = t.title ? wrapLines(c, t.title, maxW) : [];
  c.font = `500 ${bs}px ${FONT}`; const bl = t.body ? wrapLines(c, t.body, maxW) : [];
  const gap = tl.length && bl.length ? ts * 0.35 : 0;
  const hgt = tl.length * ts * 1.22 + gap + bl.length * bs * 1.35;
  const pad = base * 0.03;
  let y = t.pos === 'top' ? H * 0.07 : t.pos === 'middle' ? (H - hgt) / 2 : H * 0.93 - hgt;
  if (t.band) {
    let w = 0; c.font = `700 ${ts}px ${FONT}`; tl.forEach(l => w = Math.max(w, c.measureText(l).width));
    c.font = `500 ${bs}px ${FONT}`; bl.forEach(l => w = Math.max(w, c.measureText(l).width));
    const dark = t.color === '#111111';
    c.fillStyle = dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.5)';
    const bx = (W - w) / 2 - pad * 1.4, bw = w + pad * 2.8, by = y - pad, bh = hgt + pad * 1.6, rr = pad;
    c.beginPath(); c.moveTo(bx + rr, by); c.arcTo(bx + bw, by, bx + bw, by + bh, rr); c.arcTo(bx + bw, by + bh, bx, by + bh, rr); c.arcTo(bx, by + bh, bx, by, rr); c.arcTo(bx, by, bx + bw, by, rr); c.fill();
  } else { c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = base * 0.012; c.shadowOffsetY = base * 0.003; }
  c.fillStyle = t.color || '#fff';
  c.font = `700 ${ts}px ${FONT}`; tl.forEach(l => { c.fillText(l, W / 2, y); y += ts * 1.22; });
  y += gap;
  c.font = `500 ${bs}px ${FONT}`; bl.forEach(l => { c.fillText(l, W / 2, y); y += bs * 1.35; });
  c.restore();
}
function drawSlide(c, p, k, lt, W, H) { const s = p.slides[k]; drawPhoto(c, p, s, lt, W, H); drawText(c, s.text, W, H); }
function drawFrame(c, p, t, W, H) {
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  if (!p.slides.length) return;
  const f = frameInfo(p, t); if (!f) return;
  if (f.j == null) { drawSlide(c, p, f.i, f.lt, W, H); return; }
  const e = ease(f.pr), A = () => drawSlide(c, p, f.i, f.lt, W, H), B = () => drawSlide(c, p, f.j, Math.max(0, f.ltj), W, H);
  const layer = (fn, alpha, tx = 0, sc = 1, clipW) => {
    c.save(); c.globalAlpha = alpha;
    if (clipW != null) { c.beginPath(); c.rect(0, 0, clipW, H); c.clip(); }
    c.translate(tx + W / 2, H / 2); c.scale(sc, sc); c.translate(-W / 2, -H / 2);
    fn(); c.restore();
  };
  switch (f.kind) {
    case 'fade': A(); layer(B, e); break;
    case 'black':
      if (f.pr < .5) { A(); c.fillStyle = `rgba(0,0,0,${f.pr * 2})`; c.fillRect(0, 0, W, H); }
      else { B(); c.fillStyle = `rgba(0,0,0,${(1 - f.pr) * 2})`; c.fillRect(0, 0, W, H); }
      break;
    case 'slide': A(); layer(B, 1, W * (1 - e)); break;
    case 'push': layer(A, 1, -W * e); layer(B, 1, W * (1 - e)); break;
    case 'zoom': A(); layer(B, e, 0, 1.3 - 0.3 * e); break;
    case 'wipe': A(); layer(B, 1, 0, 1, W * e); break;
    default: (f.pr < .5 ? A : B)();
  }
}

/* ---------------- 預覽播放 ---------------- */
async function drawAt(t) {
  const p = PH.p; if (!p) return;
  PH.t = clamp(t, 0, totalDur(p));
  const f = frameInfo(p, PH.t);
  drawFrame(cx, p, PH.t, cv.width, cv.height);
  await ensureFor(p, f, !PH.play);
  if (!PH.play) drawFrame(cx, p, PH.t, cv.width, cv.height);
  updTime();
}
function updTime() {
  const p = PH.p; if (!p) return;
  const tot = totalDur(p);
  $('#phTime').textContent = `${fmtS(PH.t)} / ${fmtS(tot)}`;
  if (!PH.seeking) $('#phSeek').value = tot ? Math.round(PH.t / tot * 1000) : 0;
  $('#phPlay').innerHTML = PH.play ? ICON.pause : ICON.play;
}
function startPreview() {
  const p = PH.p; if (!p?.slides.length) return toast('先加入照片');
  if (PH.t >= totalDur(p) - 0.05) PH.t = 0;
  const t0 = performance.now() - PH.t * 1000;
  if (PH.musicURL && p.target !== 'ppt') {
    try { const d = PH.music.duration; PH.music.currentTime = d ? PH.t % d : PH.t; } catch {}
    PH.music.play().catch(() => {});
  }
  const tick = () => {
    if (!PH.play) return;
    const t = (performance.now() - t0) / 1000, tot = totalDur(p);
    if (t >= tot) { stopPreview(); PH.t = tot; drawFrame(cx, p, tot - 0.001, cv.width, cv.height); updTime(); return; }
    PH.t = t;
    const f = frameInfo(p, t);
    ensureFor(p, f);
    liveSync(p, f);
    drawFrame(cx, p, t, cv.width, cv.height);
    updTime();
    PH.play = requestAnimationFrame(tick);
  };
  PH.play = requestAnimationFrame(tick);
  updTime();
}
function stopPreview() {
  if (PH.play) cancelAnimationFrame(PH.play);
  PH.play = null;
  PH.music?.pause(); pauseVids();
  if ($('#phPlay')) updTime();
}
$('#phPlay').onclick = () => PH.play ? stopPreview() : startPreview();
cv.onclick = () => $('#phPlay').click();
tapSeek($('#phSeek'));
$('#phSeek').oninput = e => { PH.seeking = true; const was = !!PH.play; stopPreview(); PH.resume = PH.resume || was; drawAt(+e.target.value / 1000 * totalDur(PH.p)); };
$('#phSeek').onchange = () => { PH.seeking = false; if (PH.resume) { PH.resume = false; startPreview(); } };

/* ---------------- 匯出 ---------------- */
$('#phExport').onclick = () => {
  const p = PH.p; if (!p) return;
  if (!p.slides.length) return toast('先加入照片');
  stopPreview();
  let fmt = p.target === 'ppt' && kindOf(p) !== 'mix' ? 'pptx' : 'mp4';
  openSheet(`<h4>📤 匯出「${esc(p.name)}」</h4>
    ${p.lastOut ? `<button class="sheet-item" data-a="last">📁 再存一次上次做好的「${esc(p.lastOut.name)}」（不用重做）</button>` : ''}
    <p class="hint" style="padding:0 20px;margin:0"><b>① 格式</b></p>
    <div style="padding:0 18px${kindOf(p) === 'mix' ? ';display:none' : ''}"><div class="seg small" id="phFmt"><button data-v="mp4" class="${fmt === 'mp4' ? 'active' : ''}">🎬 MP4 影片</button><button data-v="pptx" class="${fmt === 'pptx' ? 'active' : ''}">📊 PPT 簡報</button></div></div>
    <p class="hint" style="padding:6px 20px 0;margin:0"><b>② 檔名</b>（點一下就能改）</p>
    <div class="sheet-input"><input id="phOutName" value="${esc(p.name)}"><span class="st-ext" id="phOutExt">.${fmt}</span></div>
    <p class="hint" style="padding:6px 20px 0;margin:0"><b>③ 存到哪裡</b></p>
    <label class="sheet-item"><input type="checkbox" id="phToFiles" checked> 📁 手機「檔案」App（做好後會跳出 iPhone 的「儲存到檔案」畫面，由你選資料夾）</label>
    <label class="sheet-item" id="phToAppRow"${fmt === 'pptx' ? ' hidden' : ''}><input type="checkbox" id="phToApp"> 📱 也存一份在 myTube 的「影片」</label>
    <button class="sheet-item" data-a="go" data-keep>📤 開始匯出</button>
    <button class="sheet-item" data-a="no">取消</button>`, a => {
    if (a === 'last') {
      DB.get('blobs', outKey(p.id)).then(f => f ? phFilesSheet(f instanceof File ? f : new File([f], p.lastOut.name, { type: f.type })) : toast('找不到上次的檔案，請重新匯出'));
      return;
    }
    if (a !== 'go') return;
    const name = $('#phOutName').value.trim().replace(/\.(mp4|pptx)$/i, '');
    const toFiles = $('#phToFiles').checked, toApp = fmt === 'mp4' && $('#phToApp').checked;
    if (!name) return toast('請先輸入檔名');
    if (!toFiles && !toApp) return toast('請至少選一個存放位置');
    $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true;
    runExport({ fmt, name, toFiles, toApp });
  });
  const inp = $('#phOutName'); inp.onfocus = () => inp.select();
  $('#phFmt').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
    fmt = b.dataset.v; $$('#phFmt button').forEach(x => x.classList.toggle('active', x === b));
    $('#phOutExt').textContent = '.' + fmt; $('#phToAppRow').hidden = fmt === 'pptx';
  };
};
async function runExport(o) {
  const p = PH.p;
  PH.busy = true;
  const sh = openSheet(`<h4>📤 匯出中，請不要離開這個畫面</h4><p class="hint" style="padding:0 20px" id="phProg">準備中…</p><div class="ph-bar"><i id="phBar"></i></div>`);
  $('#sheetBackdrop').onclick = null;
  const prog = (t, f) => { const el = $('#phProg'); if (el) el.textContent = t; if (f != null && $('#phBar')) $('#phBar').style.width = Math.round(f * 100) + '%'; };
  try {
    let blob, ext = o.fmt, note = '';
    if (o.fmt === 'pptx') blob = await exportPPT(p, prog);
    else ({ blob, ext, note } = await exportVideo(p, prog));
    const fname = `${safeName(o.name)}.${ext}`;
    let msg = '';
    if (o.toApp) {
      prog('存到 myTube…');
      await addMedia(blob, { type: 'video', title: o.name, source: 'photo', filename: fname });
      msg = `✅ 已存成「${o.name}」，在「影片」裡`;
    }
    try { await DB.put('blobs', new File([blob], fname, { type: blob.type }), outKey(p.id)); p.lastOut = { name: fname, size: blob.size, at: Date.now() }; saveProj(true); } catch (e) { console.warn(e); }
    sh.close();
    if (msg || note) toast([msg, note].filter(Boolean).join('　'), 4500);
    if (o.toFiles) phFilesSheet(new File([blob], fname, { type: blob.type }), true);
  } catch (e) {
    console.error(e); sh.close();
    openSheet(`<h4>匯出失敗</h4><p class="hint" style="padding:0 20px">${esc(e.message || String(e))}</p><button class="sheet-item" data-a="ok">關閉</button>`);
  } finally { PH.busy = false; }
}
function phFilesSheet(file, fresh) {
  const ext = file.name.split('.').pop(), base = file.name.slice(0, -(ext.length + 1));
  openSheet(`<h4>${fresh ? '✅ 做好了！最後一步：存到手機' : '📁 存到手機「檔案」App'}</h4>
    <p class="hint" style="padding:0 20px;margin:0"><b>檔名</b>（存之前還可以再改）</p>
    <div class="sheet-input"><input id="phFileName" value="${esc(base)}"><span class="st-ext">.${esc(ext)}</span></div>
    <button class="sheet-item ph-big" data-a="go" data-keep>📁 按這裡選資料夾並儲存</button>
    <p class="hint" style="padding:0 20px">${isIOS() ? '會跳出 iPhone 的分享選單 → 往下滑選「<b>儲存到檔案</b>」→ 選資料夾 → 按右上角「<b>儲存</b>」。<br>（iPhone 規定一定要你自己按一下才能存，所以多這一步。）' : '按上面的按鈕，選擇要存放的資料夾。'}<br>檔案大小：${(file.size / 1048576).toFixed(1)}MB</p>
    <p class="hint" id="phSaveState" style="padding:0 20px;font-weight:700"></p>
    <button class="sheet-item" data-a="done">${fresh ? '先不要存（之後可以在「匯出」再存一次）' : '關閉'}</button>`, a => {
    if (a !== 'go') return;
    const nm = safeName($('#phFileName').value.trim().replace(new RegExp('\\.' + ext + '$', 'i'), '') || base) + '.' + ext;
    const f = nm === file.name ? file : new File([file], nm, { type: file.type });
    const st = t => { const el = $('#phSaveState'); if (el) el.textContent = t; else { $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; toast(t, 4500); } };
    const go = () => saveToFiles(f).then(r => {
      if (r === 'cancel') st('你按了取消，還沒存。可以再按一次上面的按鈕。');
      else if (r === 'shared') st('✅ 已交給 iPhone。如果你有選「儲存到檔案」並按「儲存」，檔案就在你選的資料夾裡。');
      else if (r === 'saved') st('✅ 已儲存');
      else if (r === 'download') st('已開始下載。');
      else if (r === 'error') saveFailSheet(f, go);
    });
    go();
  });
  const inp = $('#phFileName'); inp.onfocus = () => inp.select();
}

/* --- MP4：WebCodecs（比即時快、畫面穩定），不支援就用即時錄製 --- */
async function exportVideo(p, prog) {
  const [W, H] = RES[p.ratio], tot = totalDur(p);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  let video;
  if (typeof VideoEncoder !== 'undefined') {
    try { video = await encodeWebCodecs(p, c, ctx, W, H, tot, prog); }
    catch (e) { console.warn('webcodecs', e); video = null; }
  }
  if (!video) {
    if (kindOf(p) === 'mix') throw new Error('這台裝置不支援做有影片的作品（需要 iOS 16.4 以上），請更新 iOS 後再試');
    return recordRealtime(p, c, ctx, W, H, tot, prog);
  }
  if (kindOf(p) === 'mix') {
    try { return { blob: await mixAudio(p, video, tot, prog), ext: 'mp4' }; }
    catch (e) { console.warn(e); return { blob: video, ext: 'mp4', note: '⚠️ 聲音合成失敗，先匯出沒有聲音的版本（' + (e.message || e) + '）' }; }
  }
  const mb = await musicBlob(p).catch(() => null);
  if (!mb) return { blob: video, ext: 'mp4' };
  try { return { blob: await addMusic(video, mb, p.music.ext || 'mp3', tot, prog), ext: 'mp4' }; }
  catch (e) { console.warn(e); return { blob: video, ext: 'mp4', note: '⚠️ 背景音樂合成失敗，先匯出沒有音樂的版本' }; }
}
async function encodeWebCodecs(p, c, ctx, W, H, tot, prog) {
  await loadScript('vendor/photo/mp4-muxer.js');
  let cfg = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
    const t = { codec, width: W, height: H, bitrate: 5_000_000, framerate: FPS };
    try { const r = await VideoEncoder.isConfigSupported(t); if (r.supported) { cfg = t; break; } } catch {}
  }
  if (!cfg) throw new Error('這台裝置不支援影片編碼');
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let err = null;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { err = e; } });
  enc.configure({ ...cfg, avc: { format: 'avc' } });
  const N = Math.max(1, Math.round(tot * FPS));
  for (let f = 0; f < N; f++) {
    if (err) throw err;
    const t = Math.min(f / FPS, tot - 0.001);
    await ensureFor(p, frameInfo(p, t), true);
    drawFrame(ctx, p, t, W, H);
    const fr = new VideoFrame(c, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(fr, { keyFrame: f % (FPS * 2) === 0 });
    fr.close();
    while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5));
    if (f % 10 === 0) { prog(`產生影片畫面 ${Math.round(f / N * 100)}%`, f / N * 0.85); await new Promise(r => setTimeout(r, 0)); }
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
async function addMusic(video, music, ext, tot, prog) {
  const ff = await loadFF(e => prog(`下載合成工具… ${e.total ? Math.round(e.received / e.total * 100) + '%' : ''}`, 0.88));
  prog('加入背景音樂…', 0.92);
  const an = 'bgm.' + (ext || 'mp3');
  await ff.writeFile('pv.mp4', new Uint8Array(await video.arrayBuffer()));
  await ff.writeFile(an, new Uint8Array(await music.arrayBuffer()));
  try {
    const fadeAt = Math.max(0, tot - 2).toFixed(2);
    const code = await ff.exec(['-i', 'pv.mp4', '-stream_loop', '-1', '-i', an, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-af', `afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeAt}:d=2`, '-t', tot.toFixed(3), '-movflags', '+faststart', 'pout.mp4']);
    if (code !== 0) throw new Error('合成背景音樂失敗');
    const out = await ff.readFile('pout.mp4');
    prog('完成', 1);
    return new Blob([out.buffer], { type: 'video/mp4' });
  } finally { for (const f of ['pv.mp4', an, 'pout.mp4']) { try { await ff.deleteFile(f); } catch {} } }
}
// 綜合作品的聲音：影片原聲（照剪的段落、放在對的時間）＋背景音樂（依設定蓋過／小聲／影片時不放）
async function mixAudio(p, video, tot, prog) {
  const mb = await musicBlob(p).catch(() => null);
  const clips = []; let st = 0;
  p.slides.forEach(s => { if (s.kind === 'video') clips.push({ s, start: st }); st += s.d; });
  const useVid = clips.length && !(mb && p.amix === 'cover');
  if (!mb && !useVid) return video;
  const ff = await loadFF(e => prog(`下載合成工具… ${e.total ? Math.round(e.received / e.total * 100) + '%' : ''}`, 0.87));
  prog('合成聲音…', 0.9);
  const files = ['pv.mp4'], args = ['-i', 'pv.mp4'];
  await ff.writeFile('pv.mp4', new Uint8Array(await video.arrayBuffer()));
  const logs = []; const onLog = ({ message }) => logs.push(message);
  const parts = [], labels = [];
  let n = 1;
  try {
    if (useVid) {
      const srcIdx = new Map();
      for (const c of clips) {
        const key = c.s.lib || c.s.id;
        if (!srcIdx.has(key)) {
          const b = await slideBlob(p, c.s); if (!b) { srcIdx.set(key, -1); continue; }
          const nm = `src${n}.${(b.name?.match(/\.([a-z0-9]{2,4})$/i)?.[1] || 'mp4').toLowerCase()}`;
          await ff.writeFile(nm, new Uint8Array(await b.arrayBuffer())); files.push(nm);
          logs.length = 0; ff.on('log', onLog);
          try { await ff.exec(['-hide_banner', '-i', nm]); } catch {}
          ff.off('log', onLog);
          const hasA = logs.some(l => /Stream .*Audio:/.test(l));
          if (hasA) { args.push('-i', nm); srcIdx.set(key, n); n++; } else srcIdx.set(key, -1);
        }
        const idx = srcIdx.get(key); if (idx == null || idx < 0) continue;
        const ms = Math.round(c.start * 1000), k = labels.length;
        parts.push(`[${idx}:a]atrim=start=${c.s.in}:end=${c.s.out},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms}[c${k}]`);
        labels.push(`[c${k}]`);
      }
    }
    if (mb) {
      const mn = 'bgm.' + (p.music.ext || 'mp3');
      await ff.writeFile(mn, new Uint8Array(await mb.arrayBuffer())); files.push(mn);
      args.push('-stream_loop', '-1', '-i', mn);
      const iv = clips.map(c => `between(t,${c.start.toFixed(2)},${(c.start + c.s.d).toFixed(2)})`).join('+') || '0';
      const vol = p.amix === 'cover' || !clips.length ? '1' : `if(gt(${iv},0),${p.amix === 'duck' ? '0.22' : '0'},1)`;
      parts.push(`[${n}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${tot.toFixed(3)},volume='${vol}':eval=frame,afade=t=in:st=0:d=0.5[mus]`);
      labels.push('[mus]');
    }
    if (!labels.length) return video;
    const fadeAt = Math.max(0, tot - 1.5).toFixed(2);
    const tail = `apad,atrim=0:${tot.toFixed(3)},afade=t=out:st=${fadeAt}:d=1.5[aout]`;
    const run = async mixer => {
      const fc = [...parts, labels.length > 1 ? `${labels.join('')}${mixer},${tail}` : `${labels[0]}${tail}`].join(';');
      try { await ff.deleteFile('mout.mp4'); } catch {}
      return ff.exec([...args, '-filter_complex', fc, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', tot.toFixed(3), '-movflags', '+faststart', 'mout.mp4']);
    };
    let code = await run(`amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0`);
    if (code !== 0) code = await run(`amix=inputs=${labels.length}:duration=longest:dropout_transition=0,volume=${labels.length}`);
    if (code !== 0) throw new Error('ffmpeg 合成失敗');
    const out = await ff.readFile('mout.mp4'); files.push('mout.mp4');
    prog('完成', 1);
    return new Blob([out.buffer], { type: 'video/mp4' });
  } finally { for (const f of files) { try { await ff.deleteFile(f); } catch {} } }
}
// 備用：用螢幕即時錄下來（較舊的 iPhone）。影片多長就要等多久。
async function recordRealtime(p, c, ctx, W, H, tot, prog) {
  if (!c.captureStream || typeof MediaRecorder === 'undefined') throw new Error('這台裝置的瀏覽器不支援匯出影片，請更新 iOS 後再試');
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
  const stream = c.captureStream(FPS);
  let ac, au;
  const mb = await musicBlob(p).catch(() => null);
  if (mb) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    au = new Audio(URL.createObjectURL(mb)); au.loop = true;
    const src = ac.createMediaElementSource(au), dst = ac.createMediaStreamDestination(), g = ac.createGain();
    src.connect(g); g.connect(dst);
    dst.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    PH.fadeGain = g;
  }
  for (const s of p.slides.slice(0, 2)) await getImg(p, s);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  drawFrame(ctx, p, 0, W, H);
  rec.start(500); if (au) { await ac.resume(); au.play().catch(() => {}); }
  const t0 = performance.now();
  await new Promise(res => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= tot) return res();
      ensureFor(p, frameInfo(p, t));
      drawFrame(ctx, p, t, W, H);
      if (PH.fadeGain && t > tot - 2) PH.fadeGain.gain.value = Math.max(0, (tot - t) / 2);
      prog(`錄製中（影片多長就要等多久）${Math.round(t / tot * 100)}%`, t / tot);
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop(); au?.pause(); await done; ac?.close(); PH.fadeGain = null;
  const type = rec.mimeType || mime || 'video/webm';
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

/* --- PPT：每張一頁，照片做背景、文字是可以修改的文字框，加上轉場和自動換頁秒數 --- */
const PPT_SIZE = { '16:9': [10, 5.625], '9:16': [5.625, 10], '1:1': [7.5, 7.5] };
const PPT_TRANS = { fade: '<p:fade/>', black: '<p:fade thruBlk="1"/>', slide: '<p:cover dir="l"/>', push: '<p:push dir="l"/>', zoom: '<p:zoom/>', wipe: '<p:wipe dir="r"/>' };
async function exportPPT(p, prog) {
  prog('載入 PPT 工具…', 0.02);
  await loadScript('vendor/photo/jszip.min.js');
  await loadScript('vendor/photo/pptxgen.min.js');
  const [Wi, Hi] = PPT_SIZE[p.ratio], [W, H] = RES[p.ratio];
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MYTUBE', width: Wi, height: Hi });
  pptx.layout = 'MYTUBE'; pptx.title = p.name; pptx.author = 'myTube';
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  const noKB = { ...p, kb: false };
  for (let i = 0; i < p.slides.length; i++) {
    prog(`製作第 ${i + 1} / ${p.slides.length} 頁…`, 0.05 + i / p.slides.length * 0.8);
    const s = p.slides[i];
    await getImg(p, s);
    drawPhoto(ctx, noKB, s, 0, W, H);
    const sl = pptx.addSlide();
    sl.background = { color: '000000' };
    sl.addImage({ data: c.toDataURL('image/jpeg', 0.88), x: 0, y: 0, w: Wi, h: Hi });
    const t = s.text;
    if (t && (t.title || t.body)) {
      const base = Math.min(Wi, Hi) * 72, ts = Math.round(base * TSIZE[t.size || 'm'] * 0.95), bs = Math.round(ts * 0.62);
      const runs = [];
      if (t.title) runs.push({ text: t.title, options: { bold: true, fontSize: ts, breakLine: !!t.body } });
      if (t.body) runs.push({ text: t.body, options: { fontSize: bs } });
      const cpl = Math.max(4, (Wi * 0.84 * 72) / ts), cplB = Math.max(4, (Wi * 0.84 * 72) / bs);
      const tl = t.title ? t.title.split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / cpl)), 0) : 0;
      const bl = t.body ? t.body.split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / cplB)), 0) : 0;
      const h = Math.min(Hi * 0.9, (tl * ts * 1.25 + bl * bs * 1.35) / 72 + 0.25);
      const y = t.pos === 'top' ? Hi * 0.05 : t.pos === 'middle' ? (Hi - h) / 2 : Hi * 0.95 - h;
      const dark = t.color === '#111111';
      sl.addText(runs, {
        x: Wi * 0.06, y, w: Wi * 0.88, h, align: 'center', valign: 'middle', margin: 6,
        color: (t.color || '#ffffff').slice(1).toUpperCase(), fontFace: 'Microsoft JhengHei',
        ...(t.band ? { fill: { color: dark ? 'FFFFFF' : '000000', transparency: dark ? 28 : 50 }, rectRadius: 0.08 } : { shadow: { type: 'outer', color: '000000', opacity: 0.6, blur: 4, offset: 1, angle: 90 } }),
      });
    }
  }
  prog('打包 PPT…', 0.88);
  const raw = await pptx.write({ outputType: 'blob' });
  // 加上轉場和「自動換頁秒數」（pptxgenjs 本身不支援，直接寫進投影片設定）
  const zip = await JSZip.loadAsync(raw);
  for (let i = 0; i < p.slides.length; i++) {
    const f = `ppt/slides/slide${i + 1}.xml`, file = zip.file(f); if (!file) continue;
    let xml = await file.async('string');
    const kind = i > 0 ? transAt(p, i - 1) : (p.trans === 'random' ? 'fade' : p.trans);   // 轉場屬於「進入這一頁」
    const T = i > 0 ? transLen(p, i - 1) : 0;
    const spd = T < 0.6 ? 'fast' : T < 1.2 ? 'med' : 'slow';
    const fx = i > 0 && p.trans !== 'none' ? (PPT_TRANS[kind] || '') : '';
    const tr = `<p:transition spd="${spd}" advClick="1" advTm="${Math.round(p.slides[i].d * 1000)}">${fx}</p:transition>`;
    xml = xml.replace(/<p:transition[\s\S]*?(<\/p:transition>|\/>)/, '');
    xml = xml.includes('</p:clrMapOvr>') ? xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + tr) : xml.replace('</p:sld>', tr + '</p:sld>');
    zip.file(f, xml);
  }
  prog('完成', 1);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

applyStudioMode();
