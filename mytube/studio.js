/* =========================================================
   myTube 工作室：把影片／音樂剪成好幾段（A→B、C→D、E→F…）再合在一起
   存法：只記錄剪輯（不改原檔）／另存新檔／覆蓋原檔
   ========================================================= */
'use strict';

const ST = { m: null, segs: [], inAt: null, el: $('#stMedia'), filter: 'all', preview: false, pIdx: 0, sel: -1 };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const segLabel = i => LETTERS[(i * 2) % 26] + LETTERS[(i * 2 + 1) % 26];
const fmtT = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), x = s - m * 60; return `${m}:${x.toFixed(1).padStart(4, '0')}`; };

/* ---------------- 選檔清單 ---------------- */
function renderStudio() {
  const box = $('#studioList'); if (!box) return;
  let list = S.media.slice().sort((a, b) => b.created - a.created);
  if (ST.filter === 'video' || ST.filter === 'audio') list = list.filter(m => m.type === ST.filter);
  if (ST.filter === 'edit') list = list.filter(m => m.edit?.segs?.length);
  if (!list.length) {
    box.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg><div>${ST.filter === 'edit' ? '還沒有剪輯過的檔案' : '還沒有影片或音樂<br>先到「影片」「音樂」匯入或下載'}</div></div>`;
    return;
  }
  box.innerHTML = list.map(m => `<div class="mrow" data-id="${m.id}">
    <img class="mart" src="${thumbURL(m)}" alt="">
    <div class="mtext"><div class="mtitle">${esc(m.title)}</div>
      <div class="msub">${m.type === 'video' ? '🎬 影片' : '🎵 音樂'} · ${fmtTime(m.duration)}${m.edit?.segs?.length ? ` · <span class="badge-edit">✂️ ${m.edit.segs.length} 段</span>` : ''}</div></div>
    <button class="more-btn" data-a="cut" aria-label="剪輯"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg></button>
  </div>`).join('');
  box.onclick = e => { const r = e.target.closest('.mrow'); if (r) openStudio(r.dataset.id); };
}
window.renderStudio = renderStudio;
$('#studioChips').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  ST.filter = c.dataset.f;
  $$('#studioChips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderStudio();
};

/* ---------------- 剪輯畫面 ---------------- */
async function openStudio(id) {
  const m = S.media.find(x => x.id === id); if (!m) return;
  if (P.item && !audioEl.paused) audioEl.pause();   // 先停掉正在播的
  if (typeof TTS !== 'undefined' && TTS.on) TTS.stop();
  ST.m = m; ST.segs = (m.edit?.segs || []).map(g => ({ ...g })); ST.inAt = null; ST.preview = false; ST.sel = -1;
  $('#stTitle').textContent = m.title;
  $('#stArt').hidden = m.type === 'video';
  $('#stArt').src = thumbURL(m);
  ST.el.hidden = false;
  ST.el.src = await mediaURL(m.id);
  ST.el.currentTime = 0;
  $('#studio').hidden = false; document.body.style.overflow = 'hidden';
  if (!history.state?.studio) history.pushState({ studio: 1 }, '');
  drawSegs(); drawTime(); updPlay();
}
function closeStudio(fromPop) {
  if ($('#studio').hidden) return;
  ST.el.pause(); ST.el.removeAttribute('src'); ST.el.load();
  $('#studio').hidden = true; document.body.style.overflow = '';
  if (!fromPop && history.state?.studio) history.back();
  renderStudio();
}
addEventListener('popstate', () => { if (!$('#studio').hidden) closeStudio(true); });
$('#stBack').onclick = () => {
  const saved = JSON.stringify(ST.m?.edit?.segs || []) === JSON.stringify(ST.segs.map(({ a, b }) => ({ a, b })));
  if (saved || !ST.segs.length) return closeStudio();
  openSheet(`<h4>還沒存檔，要離開嗎？</h4>
    <button class="sheet-item" data-a="save">💾 先存檔</button>
    <button class="sheet-item danger" data-a="leave">不存，直接離開</button>`, a => { if (a === 'save') saveSheet(); if (a === 'leave') closeStudio(); });
};

const dur = () => ST.el.duration || ST.m?.duration || 0;
function drawTime() {
  const d = dur(), t = ST.el.currentTime || 0;
  $('#stNow').textContent = fmtT(t);
  $('#stDur').textContent = '/ ' + fmtT(d);
  $('#stHead').style.left = d ? (t / d * 100) + '%' : '0';
  const mk = $('#stMarkA');
  if (ST.inAt != null && d) { mk.style.display = 'block'; mk.style.left = (ST.inAt / d * 100) + '%'; } else mk.style.display = 'none';
  // 正在播哪一段
  const cur = ST.segs.findIndex(g => t >= g.a && t < g.b);
  $$('#stSegs .st-seg').forEach((x, i) => x.classList.toggle('on', i === cur));
  $$('#stList .st-row').forEach((x, i) => x.classList.toggle('on', i === cur));
}
function drawSegs() {
  const d = dur();
  $('#stSegs').innerHTML = d ? ST.segs.map((g, i) =>
    `<div class="st-seg" style="left:${g.a / d * 100}%;width:${Math.max(0.6, (g.b - g.a) / d * 100)}%">${segLabel(i)}</div>`).join('') : '';
  $('#stList').innerHTML = ST.segs.map((g, i) => `<div class="st-row" data-i="${i}">
    <span class="lbl">${i + 1}</span>
    <div class="tm" data-a="edit">${segLabel(i)[0]} ${fmtT(g.a)} → ${segLabel(i)[1]} ${fmtT(g.b)}<small>長度 ${fmtT(g.b - g.a)} ・點這裡修改</small></div>
    <button data-a="play" aria-label="播放這段">▶</button>
    <button data-a="up" aria-label="往前" ${i ? '' : 'disabled'}>↑</button>
    <button data-a="down" aria-label="往後" ${i < ST.segs.length - 1 ? '' : 'disabled'}>↓</button>
    <button data-a="del" aria-label="刪除">✕</button>
  </div>`).join('');
  const total = ST.segs.reduce((a, g) => a + (g.b - g.a), 0);
  $('#stTotal').textContent = ST.segs.length ? `${ST.segs.length} 段，剪輯後共 ${fmtT(total)}` : '還沒有片段';
  $('#stPending').textContent = ST.inAt != null
    ? `起點已設在 ${fmtT(ST.inAt)}，播到結尾按「設終點」。`
    : '播到想要的地方，按「設起點」，再播到結尾按「設終點」，就會加入一段。可以加很多段。';
  drawTime();
}
function updPlay() { $('#stPlay').innerHTML = ST.el.paused ? ICON.play : ICON.pause; }
ST.el.addEventListener('timeupdate', () => { drawTime(); previewTick(); });
ST.el.addEventListener('loadedmetadata', drawSegs);
ST.el.addEventListener('play', updPlay);
ST.el.addEventListener('pause', updPlay);
ST.el.addEventListener('seeked', drawTime);
$('#stPlay').onclick = () => { ST.preview = false; ST.el.paused ? ST.el.play().catch(() => {}) : ST.el.pause(); };
$$('.st-b').forEach(b => b.onclick = () => { ST.el.currentTime = Math.max(0, Math.min(dur(), ST.el.currentTime + +b.dataset.d)); drawTime(); });

// 時間軸：點或拖都可以跳
(() => {
  const tl = $('#stTl');
  let down = false;
  const go = x => { const r = tl.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (x - r.left) / r.width)); ST.el.currentTime = f * dur(); drawTime(); };
  tl.addEventListener('pointerdown', e => { down = true; tl.setPointerCapture(e.pointerId); go(e.clientX); });
  tl.addEventListener('pointermove', e => { if (down) go(e.clientX); });
  tl.addEventListener('pointerup', () => { down = false; });
  tl.addEventListener('pointercancel', () => { down = false; });
})();

$('#stIn').onclick = () => { ST.inAt = ST.el.currentTime; drawSegs(); toast(`起點：${fmtT(ST.inAt)}`); };
$('#stOut').onclick = () => {
  const t = ST.el.currentTime;
  if (ST.inAt == null) return toast('請先按「設起點」');
  if (t - ST.inAt < 0.3) return toast('終點要在起點後面，請再播一下');
  ST.segs.push({ a: +ST.inAt.toFixed(2), b: +t.toFixed(2) });
  ST.inAt = null; ST.el.pause(); drawSegs();
  toast(`✅ 加入第 ${ST.segs.length} 段：${fmtT(ST.segs.at(-1).a)} → ${fmtT(t)}`);
};
$('#stList').onclick = e => {
  const row = e.target.closest('.st-row'), b = e.target.closest('[data-a]'); if (!row || !b) return;
  const i = +row.dataset.i, g = ST.segs[i];
  if (b.dataset.a === 'play') { ST.preview = { only: i }; ST.el.currentTime = g.a; ST.el.play().catch(() => {}); }
  if (b.dataset.a === 'up' && i > 0) { [ST.segs[i - 1], ST.segs[i]] = [ST.segs[i], ST.segs[i - 1]]; drawSegs(); }
  if (b.dataset.a === 'down' && i < ST.segs.length - 1) { [ST.segs[i + 1], ST.segs[i]] = [ST.segs[i], ST.segs[i + 1]]; drawSegs(); }
  if (b.dataset.a === 'del') { ST.segs.splice(i, 1); drawSegs(); toast('已刪除這段'); }
  if (b.dataset.a === 'edit') {
    const now = ST.el.currentTime;
    openSheet(`<h4>修改第 ${i + 1} 段（${fmtT(g.a)} → ${fmtT(g.b)}）</h4>
      <p class="hint" style="padding:0 20px">目前播放位置：${fmtT(now)}</p>
      <button class="sheet-item" data-a="a">⟦ 起點改成目前位置</button>
      <button class="sheet-item" data-a="b">終點改成目前位置 ⟧</button>
      <button class="sheet-item" data-a="ga">⏮ 跳到這段的起點</button>
      <button class="sheet-item" data-a="gb">⏭ 跳到這段的終點</button>`, a => {
      if (a === 'a') { if (now >= g.b - 0.3) return toast('起點要在終點前面'); g.a = +now.toFixed(2); drawSegs(); }
      if (a === 'b') { if (now <= g.a + 0.3) return toast('終點要在起點後面'); g.b = +now.toFixed(2); drawSegs(); }
      if (a === 'ga') { ST.el.currentTime = g.a; }
      if (a === 'gb') { ST.el.currentTime = Math.max(g.a, g.b - 2); }
    });
  }
};
// 預覽：照順序把每一段播一次
$('#stPreview').onclick = () => {
  if (!ST.segs.length) return toast('還沒有片段');
  ST.preview = { all: true }; ST.pIdx = 0;
  ST.el.currentTime = ST.segs[0].a; ST.el.play().catch(() => {});
};
function previewTick() {
  const pv = ST.preview; if (!pv || ST.el.paused) return;
  const t = ST.el.currentTime;
  if (pv.only != null) { if (t >= ST.segs[pv.only].b) { ST.el.pause(); ST.preview = false; } return; }
  const g = ST.segs[ST.pIdx]; if (!g) { ST.el.pause(); ST.preview = false; return; }
  if (t >= g.b - 0.05) {
    ST.pIdx++;
    if (ST.segs[ST.pIdx]) ST.el.currentTime = ST.segs[ST.pIdx].a;
    else { ST.el.pause(); ST.preview = false; toast('預覽結束'); }
  }
}

/* ---------------- 存檔 ---------------- */
const MAX_CUT_MB = 600;
$('#stSave').onclick = () => saveSheet();
function saveSheet() {
  const m = ST.m; if (!m) return;
  if (!ST.segs.length) {
    if (m.edit) return openSheet(`<h4>沒有片段</h4><button class="sheet-item danger" data-a="clr">🗑 清除這個檔案的剪輯紀錄</button><button class="sheet-item" data-a="no">取消</button>`, a => { if (a === 'clr') saveRecord(true); });
    return toast('還沒有片段，先設起點和終點');
  }
  const big = m.size > MAX_CUT_MB * 1024 * 1024;
  openSheet(`<h4>剪輯好了，要怎麼存？</h4>
    <button class="sheet-item" data-a="rec">📝 只記錄剪輯（不改原檔，播放時可以選剪輯版或原始檔）</button>
    ${big ? `<p class="hint" style="padding:0 20px">檔案超過 ${MAX_CUT_MB}MB，手機上沒辦法實際剪成新檔，只能記錄剪輯。</p>` : `
    <button class="sheet-item" data-a="new">💾 另存成新檔（原始檔保留）</button>
    <button class="sheet-item danger" data-a="over">⚠️ 覆蓋原始檔案（不能復原）</button>`}
    <p class="hint" style="padding:0 20px">${m.type === 'video' ? '影片剪成新檔時，每段的開頭會對齊到最近的關鍵畫面，可能比你設的起點早幾秒（為了快速、不降畫質；用「只記錄剪輯」播放則完全精準）。' : '音樂剪成新檔會很精準。'}第一次剪成檔案需要下載剪輯工具（約 30MB）。</p>`, a => {
    if (a === 'rec') saveRecord();
    if (a === 'new') renderCut(false);
    if (a === 'over') openSheet(`<h4>確定要覆蓋「${esc(m.title)}」？</h4><p class="hint" style="padding:0 20px">原始檔案會被剪輯後的版本取代，不能復原。</p><button class="sheet-item danger" data-a="y">覆蓋</button><button class="sheet-item" data-a="n">取消</button>`, x => { if (x === 'y') renderCut(true); });
  });
}
async function saveRecord(clear) {
  const m = ST.m;
  if (clear) { delete m.edit; delete P.editPref[m.id]; }
  else m.edit = { segs: ST.segs.map(({ a, b }) => ({ a, b })), at: Date.now() };
  await DB.put('media', m);
  renderLibrary(m.type);
  toast(clear ? '已清除剪輯紀錄' : '✅ 已記錄剪輯。之後在影片／音樂播放時，可以選剪輯版或原始檔', 3500);
  if (clear) closeStudio();
}

/* ---------------- 實際剪成檔案（ffmpeg，在手機上執行） ---------------- */
const FF = { ff: null, loading: null };
async function loadFF(onProg) {
  if (FF.ff) return FF.ff;
  if (FF.loading) return FF.loading;
  FF.loading = (async () => {
    await loadScript('vendor/ffmpeg/ffmpeg.js');
    await loadScript('vendor/ffmpeg/util.js');
    const bases = ['https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd', 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'];
    let err;
    for (const base of bases) {
      try {
        const ff = new FFmpegWASM.FFmpeg();
        const coreURL = await FFmpegUtil.toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await FFmpegUtil.toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', true, e => onProg?.(e));
        await ff.load({ coreURL, wasmURL });
        FF.ff = ff; return ff;
      } catch (e) { err = e; console.warn('ffmpeg load', base, e); }
    }
    FF.loading = null;
    throw new Error('下載剪輯工具失敗，請確認網路' + (err ? `（${err.message || err}）` : ''));
  })();
  return FF.loading;
}
function extOf(m, blob) {
  const fromName = (m.filename || '').match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const t = (blob.type || m.mime || '').toLowerCase();
  if (t.includes('mpeg') && m.type === 'audio') return 'mp3';
  if (t.includes('quicktime')) return 'mov';
  if (t.includes('webm')) return 'webm';
  if (t.includes('aac') || t.includes('m4a') || (t.includes('mp4') && m.type === 'audio')) return 'm4a';
  if (t.includes('wav')) return 'wav';
  return m.type === 'audio' ? 'mp3' : 'mp4';
}
async function cutBlob(m, segs, prog) {
  const ff = await loadFF(e => prog(`下載剪輯工具… ${e.total ? Math.round(e.received / e.total * 100) + '%' : ''}`));
  const blob = await DB.get('blobs', m.id);
  const ext = extOf(m, blob), inName = 'in.' + ext;
  prog('讀取檔案…');
  await ff.writeFile(inName, new Uint8Array(await blob.arrayBuffer()));
  const maps = m.type === 'audio' ? ['-map', '0:a:0'] : ['-map', '0:v:0?', '-map', '0:a:0?'];
  const parts = [];
  try {
    for (let i = 0; i < segs.length; i++) {
      prog(`剪第 ${i + 1} / ${segs.length} 段…`);
      const out = `p${i}.${ext}`, g = segs[i];
      const code = await ff.exec(['-ss', g.a.toFixed(3), '-i', inName, '-t', (g.b - g.a).toFixed(3), ...maps, '-c', 'copy', '-avoid_negative_ts', 'make_zero', out]);
      if (code !== 0) throw new Error(`第 ${i + 1} 段剪輯失敗`);
      parts.push(out);
    }
    let outName = parts[0];
    if (parts.length > 1) {
      prog('把所有片段合在一起…');
      await ff.writeFile('list.txt', parts.map(p => `file '${p}'`).join('\n'));
      outName = 'out.' + ext;
      const code = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', outName]);
      if (code !== 0) throw new Error('合併片段失敗');
    }
    const data = await ff.readFile(outName);
    return new Blob([data.buffer], { type: blob.type || (m.type === 'audio' ? 'audio/mpeg' : 'video/mp4') });
  } finally {
    for (const f of [inName, 'list.txt', 'out.' + ext, ...parts]) { try { await ff.deleteFile(f); } catch {} }
  }
}
async function renderCut(overwrite) {
  const m = ST.m, segs = ST.segs.map(({ a, b }) => ({ a, b }));
  ST.el.pause();
  const sh = openSheet(`<h4>✂️ 剪輯中，請不要離開</h4><p class="hint" style="padding:0 20px" id="cutProg">準備中…</p>`);
  const prog = t => { const el = $('#cutProg'); if (el) el.textContent = t; };
  try {
    const out = await cutBlob(m, segs, prog);
    if (!out.size) throw new Error('剪出來的檔案是空的');
    if (overwrite) {
      prog('覆蓋原始檔案…');
      if (P.item?.id === m.id) Player.close();
      await DB.put('blobs', out, m.id);
      if (urlCache.has(m.id)) { URL.revokeObjectURL(urlCache.get(m.id)); urlCache.delete(m.id); }
      fileCache.delete(m.id);
      m.size = out.size; m.mime = out.type;
      if (m.type === 'video') { const pv = await probeVideo(out); m.duration = pv.duration || m.duration; if (pv.thumb) { m.thumb = pv.thumb; thumbCache.delete(m.id); } }
      else m.duration = (await probeAudio(out)) || m.duration;
      delete m.edit; delete P.editPref[m.id];
      await DB.put('media', m);
      renderLibrary(m.type);
      sh.close(); toast('✅ 已覆蓋原始檔案', 3000);
      openStudio(m.id);
    } else {
      prog('存成新檔…');
      const ext = extOf(m, out);
      const nm = await addMedia(out, { type: m.type, title: m.title + '（剪輯）', source: 'edit', filename: `${safeName(m.title)}（剪輯）.${ext}` });
      sh.close(); toast(`✅ 已另存新檔「${nm.title}」，在${m.type === 'video' ? '影片' : '音樂'}裡`, 3500);
    }
  } catch (e) {
    console.error(e);
    sh.close();
    openSheet(`<h4>剪輯失敗</h4><p class="hint" style="padding:0 20px">${esc(e.message || String(e))}<br><br>可以改用「📝 只記錄剪輯」，不用實際剪檔也能播剪輯版。</p><button class="sheet-item" data-a="rec">📝 改成只記錄剪輯</button><button class="sheet-item" data-a="ok">關閉</button>`, a => { if (a === 'rec') saveRecord(); });
  }
}

renderStudio();
