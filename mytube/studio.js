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
// 剪輯過的：有剪輯紀錄、剪輯另存的新檔、或被剪輯覆蓋過的
const isEdited = m => !!(m.edit?.segs?.length || m.source === 'edit' || m.cutAt);
function editBadge(m) {
  const b = [];
  if (m.edit?.segs?.length) b.push(`✂️ 記錄 ${m.edit.segs.length} 段`);
  if (m.source === 'edit') b.push('✂️ 剪輯檔');
  else if (m.cutAt) b.push('✂️ 已剪輯覆蓋');
  return b.map(t => ` · <span class="badge-edit">${t}</span>`).join('');
}
function renderStudio() {
  const box = $('#studioList'); if (!box) return;
  let list = S.media.filter(m => !m.stHidden).sort((a, b) => b.created - a.created);
  if (ST.filter === 'video' || ST.filter === 'audio') list = list.filter(m => m.type === ST.filter);
  if (ST.filter === 'edit') list = list.filter(isEdited);
  if (!list.length) {
    box.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg><div>${ST.filter === 'edit' ? '還沒有剪輯過的檔案<br><small>（只存到「檔案」App 的剪輯檔不會出現在這裡）</small>' : (S.media.length ? '工作室清單是空的<br><small>到「影片」或「音樂」，按檔案旁的「⋮」→「➕ 加回工作室清單」</small>' : '還沒有影片或音樂<br>先到「影片」「音樂」匯入或下載')}</div></div>`;
    return;
  }
  box.innerHTML = list.map(m => `<div class="swipe" data-id="${m.id}">
    <button class="swipe-del" data-a="del" aria-label="移除"><i><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg></i><span>移除</span></button>
    <div class="mrow">
    <img class="mart" src="${thumbURL(m)}" alt="">
    <div class="mtext"><div class="mtitle">${esc(m.title)}</div>
      <div class="msub">${m.type === 'video' ? '🎬 影片' : '🎵 音樂'} · ${fmtTime(m.duration)}${editBadge(m)}</div></div>
    <button class="more-btn" data-a="cut" aria-label="剪輯"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg></button>
  </div></div>`).join('');
  box.onclick = e => {
    const w = e.target.closest('.swipe'); if (!w) return;
    if (e.target.closest('.swipe-del')) return askDelete(w.dataset.id);
    if (Swipe.justMoved) return;
    if (Swipe.open) { Swipe.close(); return; }       // 有打開刪除鈕時，點一下先收起來
    openStudio(w.dataset.id);
  };
}
/* 往左滑出現「刪除」 */
const kindName = m => m.type === 'video' ? '影片' : '音樂';
const SW_W = 88;
const Swipe = {
  open: null, justMoved: false,
  set(row, x, anim) { row.style.transition = anim ? 'transform .2s' : 'none'; row.style.transform = x ? `translateX(${x}px)` : ''; },
  close() { if (this.open) { this.set(this.open, 0, true); this.open = null; } },
};
(() => {
  const box = $('#studioList'); if (!box) return;
  let row = null, sx = 0, sy = 0, base = 0, dx = 0, mode = null;
  box.addEventListener('pointerdown', e => {
    const r = e.target.closest('.swipe .mrow'); if (!r || e.target.closest('.swipe-del')) return;
    row = r; sx = e.clientX; sy = e.clientY; base = Swipe.open === r ? -SW_W : 0; dx = 0; mode = null;
  });
  box.addEventListener('pointermove', e => {
    if (!row) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!mode) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; mode = Math.abs(mx) > Math.abs(my) ? 'h' : 'v'; if (mode === 'h' && Swipe.open && Swipe.open !== row) Swipe.close(); }
    if (mode !== 'h') return;
    dx = Math.max(-SW_W - 30, Math.min(0, base + mx));
    Swipe.set(row, dx, false);
  });
  const end = () => {
    if (!row) return;
    if (mode === 'h') {
      const openIt = dx < -SW_W / 2;
      Swipe.set(row, openIt ? -SW_W : 0, true);
      Swipe.open = openIt ? row : (Swipe.open === row ? null : Swipe.open);
      Swipe.justMoved = true; setTimeout(() => { Swipe.justMoved = false; }, 350);
    }
    row = null; mode = null;
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
})();
// 往左滑 → 垃圾桶：只從工作室清單移除，影片／音樂本身還在（可以在「⋮」選單加回來）
async function askDelete(id) {
  const m = S.media.find(x => x.id === id); if (!m) return;
  const w = $(`#studioList .swipe[data-id="${id}"]`);
  if (w) { w.style.transition = 'opacity .2s, max-height .25s'; w.style.maxHeight = w.offsetHeight + 'px'; requestAnimationFrame(() => { w.style.opacity = 0; w.style.maxHeight = '0px'; }); }
  Swipe.open = null;
  m.stHidden = true; await DB.put('media', m);
  setTimeout(renderStudio, 260);
  toast(`已從工作室移除「${m.title}」。${kindName(m)}還在，要加回來：到「${kindName(m)}」按「⋮」→「➕ 加回工作室清單」`, 4500);
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
  const cur = JSON.stringify(ST.segs.map(({ a, b }) => ({ a, b })));
  const saved = JSON.stringify(ST.m?.edit?.segs || []) === cur || (ST.cutFor === ST.m?.id && ST.cutSegs === cur);
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
    <button class="sheet-item" data-a="new">💾 另存新檔到手機「檔案」App…（自己取名、自己選資料夾）</button>
    <button class="sheet-item danger" data-a="over">⚠️ 覆蓋 myTube 裡的這個檔案（手機「檔案」App 裡的原始檔不會改變）</button>`}
    <p class="hint" style="padding:0 20px">${m.type === 'video' ? '影片剪成新檔時，每段的開頭會對齊到最近的關鍵畫面，可能比你設的起點早幾秒（為了快速、不降畫質；用「只記錄剪輯」播放則完全精準）。' : '音樂剪成新檔會很精準。'}第一次剪成檔案需要下載剪輯工具（約 30MB）。</p>`, a => {
    if (a === 'rec') saveRecord();
    if (a === 'new') newFileSheet();
    if (a === 'over') overwriteSheet();
  });
}
// 另存新檔：① 取檔名 ② 選存到哪裡（預設：手機「檔案」App，由 iPhone 畫面選資料夾）
function newFileSheet() {
  const m = ST.m;
  const pls = S.playlists.filter(p => p.type === m.type);
  const ext = extOf(m, { type: m.mime || '' });
  openSheet(`<h4>💾 另存新檔</h4>
    <p class="hint" style="padding:0 20px;margin:0"><b>① 檔名</b>（點一下就可以改成你要的名字）</p>
    <div class="sheet-input"><input id="stNewName" value="${esc(m.title + '（剪輯）')}" placeholder="輸入檔名"><span class="st-ext">.${esc(ext)}</span></div>
    <p class="hint" style="padding:6px 20px 0;margin:0"><b>② 存到哪裡</b>（可以兩個都選）</p>
    <label class="sheet-item"><input type="checkbox" id="stToFiles" checked> 📁 手機「檔案」App（剪好後會跳出 iPhone 的「儲存到檔案」畫面，由你選資料夾）</label>
    <label class="sheet-item"><input type="checkbox" id="stToApp"> 📱 也存一份在 myTube 的「${kindName(m)}」</label>
    ${pls.length ? `<div class="sheet-input" id="stPlRow" style="opacity:.4"><select id="stPl" class="st-select" disabled><option value="">不加入播放清單</option>${pls.map(p => `<option value="${p.id}">加入播放清單：${esc(p.name)}</option>`).join('')}</select></div>` : ''}
    <button class="sheet-item" data-a="go" data-keep>✂️ 開始剪輯</button>
    <button class="sheet-item" data-a="no">取消</button>`, a => {
    if (a !== 'go') return;
    const name = $('#stNewName').value.trim().replace(/\.[a-z0-9]{2,4}$/i, '');
    const toApp = $('#stToApp').checked, toFiles = $('#stToFiles').checked;
    if (!name) return toast('請先輸入檔名');
    if (!toApp && !toFiles) return toast('請至少選一個存放位置');
    const pl = toApp ? S.playlists.find(p => p.id === $('#stPl')?.value) : null;
    $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true;
    renderCut({ mode: 'new', name, toApp, toFiles, pl });
  });
  const inp = $('#stNewName'); inp.onfocus = () => inp.select();
  const app = $('#stToApp'), row = $('#stPlRow');
  if (row) app.onchange = () => { row.style.opacity = app.checked ? 1 : .4; $('#stPl').disabled = !app.checked; };
}
// 覆蓋：只能覆蓋 myTube 裡的那份（網頁 App 沒辦法改 iPhone「檔案」App 裡的檔案）
function overwriteSheet() {
  const m = ST.m;
  openSheet(`<h4>⚠️ 覆蓋 myTube 裡的「${esc(m.title)}」？</h4>
    <p class="hint" style="padding:0 20px">
      ✅ 會被覆蓋：<b>myTube 裡的這一份</b>（換成剪好的版本，不能復原）。<br><br>
      ❌ 不會被改到：<b>你 iPhone「檔案」App 裡原本的檔案</b>。網頁 App 沒辦法修改手機裡的檔案，這是 iPhone 的安全限制，所以原始檔會保持原樣。<br><br>
      想把剪好的版本放進「檔案」App，請改用「💾 另存新檔」，自己取名、選資料夾。</p>
    <button class="sheet-item danger" data-a="y">⚠️ 覆蓋 myTube 裡的這一份</button>
    <button class="sheet-item" data-a="new">💾 改用另存新檔到「檔案」App</button>
    <button class="sheet-item" data-a="n">取消</button>`, a => {
    if (a === 'y') renderCut({ mode: 'over' });
    if (a === 'new') newFileSheet();
  });
}
// 存到「檔案」App：電腦用「另存」視窗；手機用分享選單（iPhone 選「儲存到檔案」→ 選資料夾）
async function saveToFiles(file) {
  if (window.showSaveFilePicker && !isMobile()) {
    try {
      const ext = file.name.split('.').pop();
      const h = await showSaveFilePicker({ suggestedName: file.name, types: [{ description: file.type || ext, accept: { [file.type || 'application/octet-stream']: ['.' + ext] } }] });
      const w = await h.createWritable(); await w.write(file); await w.close();
      toast('✅ 已儲存「' + h.name + '」', 3000); return 'saved';
    } catch (e) { if (e.name === 'AbortError') return 'cancel'; console.warn(e); }
  }
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancel'; console.warn(e); }
  }
  anchorDownload(file); return 'download';
}
function filesSheet(file) {
  const ext = file.name.split('.').pop(), base = file.name.slice(0, -(ext.length + 1));
  const how = isIOS()
    ? '按下面的按鈕 → 選「<b>儲存到檔案</b>」→ 選你要放的資料夾（例如「我的 iPhone › myTube › ' + kindName(ST.m) + '」）→ 按右上角「<b>儲存</b>」。'
    : '按下面的按鈕，選擇要存放的資料夾。';
  openSheet(`<h4>📁 存到手機「檔案」App</h4>
    <p class="hint" style="padding:0 20px;margin:0"><b>檔名</b>（存之前還可以再改）</p>
    <div class="sheet-input"><input id="stFileName" value="${esc(base)}" placeholder="輸入檔名"><span class="st-ext">.${esc(ext)}</span></div>
    <p class="hint" style="padding:0 20px">${how}（${(file.size / 1048576).toFixed(1)}MB）</p>
    <button class="sheet-item" data-a="go" data-keep>📁 選資料夾並儲存</button>
    <button class="sheet-item" data-a="done">完成</button>`, a => {
    if (a !== 'go') return;
    const nm = safeName($('#stFileName').value.trim().replace(/\.[a-z0-9]{2,4}$/i, '') || base) + '.' + ext;
    const f = nm === file.name ? file : new File([file], nm, { type: file.type });
    saveToFiles(f).then(r => { if (r === 'cancel') toast('已取消，可以再按一次'); else if (r === 'shared') toast('✅ 已存「' + nm + '」', 3000); });
  });
  const inp = $('#stFileName'); inp.onfocus = () => inp.select();
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
async function renderCut(opts) {
  const m = ST.m, segs = ST.segs.map(({ a, b }) => ({ a, b }));
  ST.el.pause();
  const sh = openSheet(`<h4>✂️ 剪輯中，請不要離開</h4><p class="hint" style="padding:0 20px" id="cutProg">準備中…</p>`);
  const prog = t => { const el = $('#cutProg'); if (el) el.textContent = t; };
  try {
    const out = await cutBlob(m, segs, prog);
    if (!out.size) throw new Error('剪出來的檔案是空的');
    const ext = extOf(m, out), type = out.type || (m.type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    let file = null, msg = '';
    if (opts.mode === 'over') {
      {
        prog('覆蓋 myTube 裡的檔案…');
        if (P.item?.id === m.id) Player.close();
        await DB.put('blobs', out, m.id);
        if (urlCache.has(m.id)) { URL.revokeObjectURL(urlCache.get(m.id)); urlCache.delete(m.id); }
        fileCache.delete(m.id);
        m.size = out.size; m.mime = out.type;
        if (m.type === 'video') { const pv = await probeVideo(out); m.duration = pv.duration || m.duration; if (pv.thumb) { m.thumb = pv.thumb; thumbCache.delete(m.id); } }
        else m.duration = (await probeAudio(out)) || m.duration;
        delete m.edit; delete P.editPref[m.id]; m.cutAt = Date.now();
        await DB.put('media', m);
        renderLibrary(m.type);
        msg = '✅ 已覆蓋 myTube 裡的檔案（「檔案」App 的原始檔沒有改變）';
      }
    } else {
      const fname = `${safeName(opts.name)}.${ext}`;
      if (opts.toApp) {
        prog('存到 myTube…');
        const nm = await addMedia(out, { type: m.type, title: opts.name, source: 'edit', filename: fname });
        if (opts.pl) await togglePlaylistItem(opts.pl, nm.id);
        msg = `✅ 已存成「${nm.title}」，在${kindName(m)}${opts.pl ? `的「${opts.pl.name}」` : ''}裡`;
      }
      if (opts.toFiles) file = new File([out], fname, { type });
    }
    sh.close();
    ST.cutFor = m.id; ST.cutSegs = JSON.stringify(segs);   // 剪好存檔了，離開時不用再問
    if (opts.mode === 'over') await openStudio(m.id);
    if (msg) toast(msg, 3500);
    if (file) filesSheet(file);
  } catch (e) {
    console.error(e);
    sh.close();
    openSheet(`<h4>剪輯失敗</h4><p class="hint" style="padding:0 20px">${esc(e.message || String(e))}<br><br>可以改用「📝 只記錄剪輯」，不用實際剪檔也能播剪輯版。</p><button class="sheet-item" data-a="rec">📝 改成只記錄剪輯</button><button class="sheet-item" data-a="ok">關閉</button>`, a => { if (a === 'rec') saveRecord(); });
  }
}

renderStudio();
