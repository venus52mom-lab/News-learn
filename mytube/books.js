/* =========================================================
   myTube 電子書：匯入（PDF / Word / EPUB / TXT / 網址 / 貼上）
   逐句翻譯 / 全部翻譯（13 種語言）、朗讀（可背景播放）
   ========================================================= */
'use strict';

const LANGS = [
  ['zh-TW', '繁體中文（國語）'], ['zh-CN', '簡體中文'], ['en', 'English 英文'], ['ja', '日本語 日文'],
  ['ko', '한국어 韓文'], ['de', 'Deutsch 德文'], ['fr', 'Français 法文'], ['es', 'Español 西班牙文'],
  ['it', 'Italiano 義大利文'], ['pt', 'Português 葡萄牙文'], ['ru', 'Русский 俄文'],
  ['th', 'ไทย 泰文'], ['vi', 'Tiếng Việt 越南文'],
];
const CDN = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};
const B = {
  books: [],            // 書（已存的 + 這次暫時開的）
  trans: new Map(),     // 翻譯快取：書id|語言|段落 → [每句翻譯]
  book: null,           // 正在看的書
  sents: [],            // 目前這本書：每段的句子
  rendered: 0,          // 已畫出幾段
  lang: LS.get('bookLang') || 'zh-TW',
  mode: LS.get('bookMode') || 'sent',
  read: LS.get('bookRead') || 'both',
  rate: +(LS.get('bookRate') || 1),
  font: +(LS.get('bookFont') || 18),
  userScrollAt: 0,
};
const serverReady = () => !!getServer() && LS.get('serverOk') === '1';

/* ---------------- 工具 ---------------- */
const scriptP = {};
function loadScript(src) {
  return scriptP[src] || (scriptP[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete scriptP[src]; rej(new Error('載入讀檔工具失敗，請確認有網路')); };
    document.head.appendChild(s);
  }));
}
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
// PDF 常把中文字存成長得一樣的「部首符號」（例如 ⽅→方、⼈→人），翻譯和朗讀會出錯，這裡換回正常的字
// 中日韓文字＋全形標點（「」、。等）：換行接起來時不要多加空格
const CJKP = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;
function fixCJK(t) { return (t || '').replace(/[\u2F00-\u2FDF\u2E80-\u2EFF\uF900-\uFAFF]/g, c => c.normalize('NFKC')); }
function joinLines(lines) {
  let out = '';
  for (const l0 of lines) {
    const l = l0.trim(); if (!l) continue;
    if (!out) { out = l; continue; }
    if (out.endsWith('-') && /[a-z]$/i.test(out.slice(-2, -1))) { out = out.slice(0, -1) + l; continue; }   // 斷字連回去
    out += (CJKP.test(out.slice(-1)) && CJKP.test(l[0])) ? l : ' ' + l;
  }
  return out;
}
// 把一大段文字切成段落
function toParas(text) {
  text = fixCJK(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n');
  let blocks = text.split(/\n\s*\n+/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim());
    if (lines.length <= 1) { out.push(joinLines(lines)); continue; }
    // 沒有空行分段（PDF 常見）：標題自成一段；一行以句號結尾、而且比一般行短，就是段落結尾
    const lens = lines.map(l => l.trim().length);
    const maxLen = Math.max(...lens);
    const typical = [...lens].sort((a, b) => a - b)[Math.floor(lens.length * 0.75)] || maxLen;
    let cur = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      const isHeading = l.length < 40 && l.length < typical * 0.6 && !/[.!?。！？,，;；:：、]$/.test(l) && (i + 1 < lines.length) && !/^[a-z]/.test(lines[i + 1].trim()) && !cur.length;
      if (isHeading) { if (cur.length) out.push(joinLines(cur)); out.push(l); cur = []; continue; }
      cur.push(l);
      const endsSentence = /[.!?。！？」』”"]\s*$/.test(l);
      if (endsSentence && (l.length < maxLen * 0.85 || lines.length < 12)) { out.push(joinLines(cur)); cur = []; }
    }
    if (cur.length) out.push(joinLines(cur));
  }
  return out.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p && !/^[\s\d\-–—_*#=.·•|/]+$/.test(p));
}
const segs = {};
function splitSentences(p, lang) {
  let arr;
  try {
    if (window.Intl?.Segmenter) {
      const seg = segs[lang] || (segs[lang] = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' }));
      arr = [...seg.segment(p)].map(x => x.segment.trim()).filter(Boolean);
    }
  } catch {}
  if (!arr) arr = (p.match(/[^。！？!?.]+[。！？!?.]+["」』”’)]*\s*|[^。！？!?.]+$/g) || [p]).map(s => s.trim()).filter(Boolean);
  // 太長的句子再切（朗讀和翻譯比較穩）
  const res = [];
  for (const s of arr) {
    if (s.length <= 320) { res.push(s); continue; }
    let rest = s;
    while (rest.length > 320) {
      let cut = Math.max(rest.lastIndexOf('，', 300), rest.lastIndexOf(', ', 300), rest.lastIndexOf('；', 300), rest.lastIndexOf('; ', 300), rest.lastIndexOf(' ', 300));
      if (cut < 80) cut = 300;
      res.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1);
    }
    if (rest.trim()) res.push(rest.trim());
  }
  return res.length ? res : [p];
}
function guessLang(t) {
  t = (t || '').slice(0, 2000);
  if ((t.match(/[\u3041-\u3096\u30a1-\u30fa]/g) || []).length >= 3) return 'ja';   // 至少 3 個假名才算日文（「・」「ー」不算）
  if (/[가-힯]/.test(t)) return 'ko';
  if (/[฀-๿]/.test(t)) return 'th';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  if (/[一-鿿]/.test(t)) return /[们这个说为时来对国还没发经过动进]/.test(t) ? 'zh-CN' : 'zh-TW';
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return 'vi';
  if (/[äöüß]/i.test(t) && /\b(der|die|und|das|nicht|ist)\b/i.test(t)) return 'de';
  if (/[ñ¿¡]/.test(t) || /\b(el|los|las|que|para|una)\b/i.test(t) && /\b(es|está|por)\b/i.test(t)) return 'es';
  if (/[àâçéèêëîïôûùüÿœ]/i.test(t) && /\b(le|la|les|et|est|une|des)\b/i.test(t)) return 'fr';
  if (/[ãõç]/i.test(t) && /\b(não|uma|para|com|que)\b/i.test(t)) return 'pt';
  if (/\b(il|che|della|sono|una|per|non)\b/i.test(t) && /[àèéìòù]/i.test(t)) return 'it';
  return 'en';
}
const langName = c => (LANGS.find(l => l[0] === c) || [c, c])[1];

/* ---------------- 讀檔 ---------------- */
async function readPDF(buf) {
  await loadScript(CDN.pdf);
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  const base = CDN.pdf.slice(0, CDN.pdf.lastIndexOf('/') + 1);
  // cMap：很多中文／日文 PDF 需要它才讀得出字
  const pdf = await pdfjsLib.getDocument({ data: buf, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/' }).promise;
  // 一行一行讀出來，記下每行的字體大小和位置（用來判斷標題和段落）
  const rows = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 5 === 0) toast(`讀取 PDF ${i}/${pdf.numPages} 頁…`, 60000);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let row = null;
    const push = () => { if (row && row.text.trim()) rows.push(row); row = null; };
    for (const it of tc.items) {
      const t = it.transform || [0, 0, 0, 0, 0, row ? row.y : 0];
      const y = Math.round(t[5]), size = Math.abs(t[3]) || Math.abs(t[0]) || (row ? row.size : 0);
      if (row && Math.abs(y - row.y) > 2 && it.str.trim()) push();
      if (!row) row = { text: '', y, size: 0, page: i };
      row.text += it.str;
      if (it.str.trim()) row.size = Math.max(row.size, size);
      if (it.hasEOL) push();
    }
    push();
  }
  // 拿掉頁碼（例如「12」「12 / 77」「- 12 -」「第 12 頁」）
  const isPageNo = l => /^\s*[-–—]?\s*(第\s*)?\d{1,4}\s*(頁|\/\s*\d{1,4})?\s*[-–—]?\s*$/.test(l);
  const body = rows.filter(r => !isPageNo(r.text));
  const median = a => { const b = a.filter(x => x > 0).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const medSize = median(body.map(r => r.size));
  const gaps = []; for (let k = 1; k < body.length; k++) if (body[k].page === body[k - 1].page) gaps.push(body[k - 1].y - body[k].y);
  const medGap = median(gaps.filter(g => g > 0));
  // 字比較大 → 標題（自成一段）；行距比較大 → 新的段落；換頁不切段（跨頁的段落會接起來）
  let text = '', prevHead = false;
  body.forEach((r, k) => {
    const head = medSize && r.size > medSize * 1.15;
    const prev = body[k - 1];
    const bigGap = prev && prev.page === r.page && medGap && (prev.y - r.y) > medGap * 1.45;
    if (head) text += (prevHead ? ' ' : '\n\n') + r.text.trim();
    else text += (prevHead || bigGap ? '\n\n' : '\n') + r.text;
    prevHead = head;
  });
  text = fixCJK(text);
  if (text.replace(/\s/g, '').length < 20) throw new Error('這個 PDF 是掃描的圖片，裡面沒有文字，沒辦法讀取');
  return { title: (await pdf.getMetadata().catch(() => ({})))?.info?.Title || '', paras: toParas(text) };
}
async function readDOCX(buf) {
  await loadScript(CDN.mammoth);
  const r = await mammoth.extractRawText({ arrayBuffer: buf });
  return { paras: toParas(r.value) };
}
function htmlToParas(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,svg,iframe').forEach(e => e.remove());
  const root = doc.querySelector('article') || doc.querySelector('main') || doc.body || doc.documentElement;
  const blocks = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre')]
    .filter(e => !e.querySelector('p,li,blockquote'))
    .map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.length > 1);
  return { title: (doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || '').trim(), paras: blocks.length ? blocks : toParas(root.textContent || '') };
}
async function readEPUB(buf) {
  await loadScript(CDN.jszip);
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('這不是正常的 EPUB 檔');
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
  const items = {}; opf.querySelectorAll('manifest > item').forEach(i => { items[i.getAttribute('id')] = i.getAttribute('href'); });
  const title = opf.querySelector('metadata > title, metadata > *|title')?.textContent || '';
  const paras = [];
  const spine = [...opf.querySelectorAll('spine > itemref')].map(r => items[r.getAttribute('idref')]).filter(Boolean);
  for (const href of spine) {
    const f = zip.file(base + decodeURIComponent(href)) || zip.file(decodeURIComponent(href));
    if (!f) continue;
    paras.push(...htmlToParas(await f.async('string')).paras);
  }
  return { title, paras };
}
async function readFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return readPDF(buf);
  if (name.endsWith('.docx')) return readDOCX(buf);
  if (name.endsWith('.epub')) return readEPUB(buf);
  if (name.endsWith('.doc')) throw new Error('舊版 Word（.doc）網頁讀不了，請用 Word 或 Pages 另存成 .docx 或 PDF 再匯入');
  const text = new TextDecoder().decode(buf);
  if (name.endsWith('.html') || name.endsWith('.htm')) return htmlToParas(text);
  return { paras: toParas(text) };
}

/* ---------------- 網址 ---------------- */
async function readURL(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const isDoc = /\.(pdf|docx|epub|txt)(\?|#|$)/i.test(url);
  const fromBytes = async (r, ctype) => {
    const blob = await r.blob();
    const name = (url.split(/[?#]/)[0].split('/').pop() || 'book') + (ctype.includes('pdf') && !/\.pdf/i.test(url) ? '.pdf' : '');
    return readFile(new File([blob], name, { type: ctype }));
  };
  const handle = async r => {
    const ctype = r.headers.get('Content-Type') || '';
    if (isDoc || /pdf|epub|officedocument|octet-stream/.test(ctype)) return fromBytes(r, ctype);
    if (ctype.includes('json')) return r.json();
    const text = await r.text();
    return /<html|<body|<p[ >]/i.test(text) ? htmlToParas(text) : { paras: toParas(text) };
  };
  const errs = [];
  // 1) 直接讀（有些網站允許）
  try { const r = await fetch(url, { mode: 'cors' }); if (r.ok) { const b = await handle(r); if (b.paras?.length) return b; } } catch (e) { errs.push(e); }
  // 2) 自己的伺服器
  if (serverReady()) {
    try {
      const r = await sFetch('/api/fetch?url=' + encodeURIComponent(url) + (isDoc ? '&raw=1' : ''));
      if (r.ok) { const b = await handle(r); if (b.paras?.length) return b; } else errs.push(new Error(await errText(r)));
    } catch (e) { errs.push(e); }
  }
  // 3) 公開的網頁閱讀服務
  if (!isDoc) {
    try {
      const r = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'text/plain' } });
      if (r.ok) {
        const t = await r.text();
        const title = (t.match(/^Title:\s*(.+)$/m) || [])[1] || '';
        const body = t.includes('Markdown Content:') ? t.split('Markdown Content:').slice(1).join('') : t;
        const clean = body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#+\s*/gm, '').replace(/[*_`>]{1,3}/g, '');
        const paras = toParas(clean);
        if (paras.length) return { title, paras };
      }
    } catch (e) { errs.push(e); }
  }
  throw new Error('這個網站不讓別的網頁讀取內容。請打開那個網頁，全選複製文字，用「貼上文字」匯入。');
}

/* ---------------- 新增書 ---------------- */
async function addBook(data, meta) {
  const paras = (data.paras || []).filter(Boolean);
  if (!paras.length) throw new Error('沒有讀到任何文字');
  const book = {
    id: 'bk' + uid(), title: (data.title || meta.title || '未命名').trim().slice(0, 120),
    source: meta.source, created: Date.now(), paras, srcLang: guessLang(paras.slice(0, 30).join(' ')),
    pos: { p: 0, s: 0 }, saved: false, chars: paras.reduce((a, p) => a + p.length, 0),
  };
  B.books.unshift(book);
  openSheet(`<h4>${esc(book.title)}</h4>
    <p class="hint" style="padding:0 20px">讀到 ${paras.length} 段、約 ${book.chars.toLocaleString()} 字（${esc(langName(book.srcLang))}）。要存到手機嗎？</p>
    <button class="sheet-item" data-a="save">💾 存到手機（下次還在，翻譯也會存，離線可聽）</button>
    <button class="sheet-item" data-a="temp">👀 只看這次（不存）</button>`, async a => {
    if (a === 'save') await saveBook(book, true);
    renderBooks(); openReader(book.id);
  });
  renderBooks();
  return book;
}
async function saveBook(book, on) {
  book.saved = on;
  if (on) {
    try {
      await DB.put('books', book);
      for (const [k, v] of B.trans) if (k.startsWith(book.id + '|')) await DB.put('trans', { k, v });
      navigator.storage?.persist?.();
      toast('已存到手機');
    } catch (e) { book.saved = false; toast('存檔失敗：' + e.message); }
  } else {
    await DB.del('books', book.id); await DB.delPrefix('trans', book.id + '|');
    toast('已從手機移除（這次還可以繼續看）');
  }
  renderBooks();
}
async function deleteBook(book) {
  if (TTS.book === book) TTS.stop();
  B.books = B.books.filter(b => b !== book);
  for (const k of [...B.trans.keys()]) if (k.startsWith(book.id + '|')) B.trans.delete(k);
  if (book.saved) { await DB.del('books', book.id); await DB.delPrefix('trans', book.id + '|'); }
  await DB.delPrefix('blobs', `tts_${book.id}_`).catch(() => {}); await DB.del('kv', packKey(book)).catch(() => {});
  renderBooks(); toast('已刪除');
}
async function importWith(fn, meta) {
  toast('讀取中…', 60000);
  try { const data = await fn(); await addBook(data, meta); toast('讀取完成', 1500); }
  catch (e) { console.error(e); toast(e.message || String(e), 5000); }
}
$('#bookFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) importWith(() => readFile(f), { title: f.name.replace(/\.[^.]+$/, ''), source: 'file' });
};
$('#bookUrlBtn').onclick = () => promptSheet('貼上電子書或文章的網址', '', url => {
  url = url.trim(); if (!url) return;
  importWith(() => readURL(url), { title: url.replace(/^https?:\/\//, '').slice(0, 60), source: url });
});
$('#bookPasteBtn').onclick = () => {
  openSheet(`<h4>貼上電子書內容</h4>
    <div class="sheet-input"><input id="pasteTitle" placeholder="書名（可不填）"></div>
    <div style="padding:0 18px"><textarea id="pasteText" rows="8" placeholder="把整本或整章的文字貼在這裡" style="width:100%"></textarea></div>
    <div class="sheet-input"><button class="pill-btn ghost" data-a="clip" data-keep>📋 從剪貼簿貼上</button><button class="pill-btn" data-a="ok">完成</button></div>`, async a => {
    if (a === 'clip') { try { $('#pasteText').value = await navigator.clipboard.readText(); } catch { toast('請長按輸入框貼上'); } return; }
    if (a === 'ok') {
      const text = $('#pasteText').value, title = $('#pasteTitle').value.trim();
      if (!text.trim()) return toast('沒有內容');
      importWith(async () => ({ title, paras: toParas(text) }), { title: title || text.trim().slice(0, 20), source: 'paste' });
    }
  });
};

/* ---------------- 書單 ---------------- */
function renderBooks() {
  const box = $('#bookList');
  if (!B.books.length) {
    box.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"/></svg><div>還沒有電子書<br>按上面的按鈕匯入</div></div>`;
    return;
  }
  box.innerHTML = B.books.map(b => {
    const pct = b.paras.length > 1 ? Math.round(b.pos.p / (b.paras.length - 1) * 100) : 0;
    return `<div class="book-row" data-id="${b.id}">
      <div class="book-cover" style="background:${coverColor(b.title)}">${esc(b.title.trim()[0] || '書')}</div>
      <div class="mtext" data-a="open">
        <div class="mtitle">${TTS.on && TTS.book === b ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}${esc(b.title)}</div>
        <div class="msub">${b.saved ? '💾 已存' : '⏳ 暫時（未存）'} · ${b.paras.length} 段 · 讀到 ${pct}%</div>
        <div class="hprog"><div style="width:${pct}%"></div></div>
      </div>
      <button class="more-btn" data-a="more">${ICON.more}</button>
    </div>`;
  }).join('');
  box.onclick = e => {
    const row = e.target.closest('.book-row'); if (!row) return;
    const b = B.books.find(x => x.id === row.dataset.id); if (!b) return;
    if (e.target.closest('[data-a="more"]')) return bookMenu(b);
    openReader(b.id);
  };
}
function coverColor(t) { let h = 0; for (const c of t || 'x') h = (h * 31 + c.charCodeAt(0)) % 360; return `linear-gradient(135deg,hsl(${h},60%,50%),hsl(${(h + 40) % 360},60%,32%))`; }
function bookMenu(b) {
  openSheet(`<h4>${esc(b.title)}</h4>
    <button class="sheet-item" data-a="open">📖 打開</button>
    <button class="sheet-item" data-a="save">${b.saved ? '📤 從手機移除（不刪這次的）' : '💾 存到手機'}</button>
    <button class="sheet-item" data-a="all">🌐 整本翻譯好存起來（沒網路也能「看」${esc(langName(B.lang))}翻譯，不含聲音）</button>
    <button class="sheet-item" data-a="offline">🎧 下載朗讀聲音（沒網路也能「聽」，鎖螢幕繼續唸；需要翻譯會自動先翻）</button>
    <button class="sheet-item" data-a="test">🔈 測試朗讀聲音</button>
    <button class="sheet-item" data-a="rename">✏️ 重新命名</button>
    <button class="sheet-item danger" data-a="del">🗑️ 刪除</button>`, async a => {
    if (a === 'test') return soundTest();
    if (a === 'offline') return offlineSheet(b);
    if (a === 'open') openReader(b.id);
    if (a === 'save') saveBook(b, !b.saved);
    if (a === 'all') translateAll(b);
    if (a === 'rename') promptSheet('重新命名', b.title, async n => { b.title = n.trim() || b.title; if (b.saved) await DB.put('books', b); renderBooks(); if (B.book === b) $('#rdTitle').textContent = b.title; });
    if (a === 'del') openSheet(`<h4>確定刪除「${esc(b.title)}」？</h4><button class="sheet-item danger" data-a="y">刪除</button><button class="sheet-item" data-a="n">取消</button>`, x => { if (x === 'y') deleteBook(b); });
  });
}

/* ---------------- 翻譯 ---------------- */
/* 翻譯穩定性：同時最多 2 個請求（避免被 Google 限流）、失敗自動重試、多個管道輪流 */
const TQ = { active: 0, max: 2, waiters: [] };
async function tLimit(fn) {
  while (TQ.active >= TQ.max) await new Promise(r => TQ.waiters.push(r));
  TQ.active++;
  try { return await fn(); } finally { TQ.active--; const w = TQ.waiters.shift(); if (w) w(); }
}
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await sleep([1200, 3500, 7000][i] || 7000); }
  }
  throw last;
}
async function gtx(lines, tl) {
  const r = await fetchTimeout(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`, {
    method: 'POST', body: new URLSearchParams({ q: lines.join('\n') }),
  }, 15000);
  if (!r.ok) throw new Error('翻譯服務回應 ' + r.status);
  const j = await r.json();
  const text = (j[0] || []).map(x => x && x[0] || '').join('');
  const out = text.split('\n');
  if (out.length !== lines.length) throw Object.assign(new Error('行數不符'), { mismatch: true, src: j[2] });
  return { lines: out, src: j[2] };
}
// Google 第二個管道：一次送多句（每句分開），不會有行數對不上的問題
async function gtx2(lines, tl) {
  const out = []; let src;
  for (let i = 0; i < lines.length;) {
    const group = []; let len = 0;
    while (i < lines.length && (group.length === 0 || len + lines[i].length < 350)) { group.push(lines[i]); len += lines[i].length; i++; }
    const qs = group.map(l => 'q=' + encodeURIComponent(l || ' ')).join('&');
    const r = await fetchTimeout(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&${qs}`, {}, 15000);
    if (!r.ok) throw new Error('翻譯服務回應 ' + r.status);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : [j];
    if (arr.length !== group.length) throw new Error('翻譯結果不完整');
    for (const x of arr) {
      if (Array.isArray(x)) { out.push(String(x[0] || '')); src = src || x[1]; }
      else if (typeof x === 'string') out.push(x);
      else out.push(String(x?.trans || x?.sentences?.map(y => y.trans).join('') || ''));
    }
  }
  return { lines: out, src };
}
async function myMemory(lines, tl, sl) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) { out.push(''); continue; }
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(l.slice(0, 480))}&langpair=${encodeURIComponent(sl || 'en')}|${encodeURIComponent(tl)}`);
    const j = await r.json();
    out.push(j?.responseData?.translatedText || '');
  }
  return { lines: out };
}
async function translateLines(lines, tl, sl) {
  return tLimit(async () => {
    if (serverReady()) {
      try {
        return await withRetry(async () => {
          const r = await sFetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: lines, tl }) });
          if (!r.ok) throw new Error(await errText(r));
          const j = await r.json(); if (j.lines?.length !== lines.length) throw new Error('翻譯結果不完整');
          return j;
        }, 2);
      } catch (e) { console.warn('server translate', e); }
    }
    try {
      return await withRetry(async () => {
        try { return await gtx(lines, tl); }
        catch (e) { if (e.mismatch) return gtx2(lines, tl); throw e; }   // 行數對不上 → 改用一句一句的管道
      }, 3);
    } catch (e) { console.warn('gtx', e); }
    try { return await withRetry(() => gtx2(lines, tl), 2); } catch (e) { console.warn('gtx2', e); }
    return myMemory(lines, tl, sl);
  });
}
const tKey = (b, lang, p) => `${b.id}|${lang}|${p}`;
const inflight = new Map();
// 確保第 from～to 段已經翻譯好
async function ensureTrans(b, lang, from, to) {
  const sents = sentsOf(b);
  const todo = [];
  for (let p = from; p <= Math.min(to, b.paras.length - 1); p++) {
    const k = tKey(b, lang, p);
    if (B.trans.has(k)) continue;
    if (inflight.has(k)) { todo.push(inflight.get(k)); continue; }
    todo.push(p);
  }
  const waits = todo.filter(x => x instanceof Promise);
  const ps = todo.filter(x => typeof x === 'number');
  // 每批最多約 1500 字或 60 句
  let batch = [], size = 0;
  const run = async group => {
    const lines = group.flatMap(p => sents[p]);
    try {
      const j = await translateLines(lines, lang, b.srcLang);
      if (j.src && j.src !== 'auto' && !b.srcLangSure) {
        const n = normLang(j.src), g = guessLang(lines.join(' '));
        // 只在跟文字看起來一致時才採用（避免把中文書誤判成英文，用英文語音唸中文）
        if (family(n) === family(g)) { b.srcLang = family(n) === 'zh' ? g : n; b.srcLangSure = true; if (b.saved) DB.put('books', b).catch(() => {}); }
      }
      let i = 0;
      for (const p of group) {
        const v = sents[p].map(() => (j.lines[i++] || '').trim());
        B.trans.set(tKey(b, lang, p), v);
        if (b.saved) DB.put('trans', { k: tKey(b, lang, p), v }).catch(() => {});
        if (B.book === b && B.lang === lang) refreshPara(p);
      }
    } catch (e) {
      console.warn(e);
      if (!B.transErrShown) { B.transErrShown = true; toast('翻譯失敗，請確認網路（稍後會再試）', 3500); setTimeout(() => (B.transErrShown = false), 15000); }
      throw e;
    } finally { for (const p of group) inflight.delete(tKey(b, lang, p)); }
  };
  const jobs = [];
  for (const p of ps) {
    const n = sents[p].join('').length;
    if (batch.length && (size + n > 1500 || batch.length >= 25)) { jobs.push(batch); batch = []; size = 0; }
    batch.push(p); size += n;
  }
  if (batch.length) jobs.push(batch);
  const promises = jobs.map(g => { const pr = run(g); g.forEach(p => inflight.set(tKey(b, lang, p), pr.catch(() => {}))); return pr; });
  await Promise.allSettled([...promises, ...waits]);
}
const family = c => (c || '').startsWith('zh') ? 'zh' : ['ja', 'ko', 'th', 'ru'].includes(c) ? c : 'latin';
// 每一句自己判斷語言：中文句子一定用中文語音、日文用日文……（混合語言的書也不會唸錯）
function sentLang(text, fallback) {
  if (/[\u3041-\u3096\u30a1-\u30fa]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  if (/[\u4e00-\u9fff]/.test(text)) return (fallback || '').startsWith('zh') ? fallback : (/[们这个说为时来对国还没发经过动进]/.test(text) ? 'zh-CN' : 'zh-TW');
  return family(fallback) === 'latin' ? (fallback || 'en') : 'en';
}
function normLang(c) {
  c = (c || '').toLowerCase();
  if (c.startsWith('zh')) return c.includes('cn') || c === 'zh' ? 'zh-CN' : 'zh-TW';
  return c.split('-')[0];
}
async function translateAll(b) {
  const lang = B.lang, total = b.paras.length;
  B.stopAll = false;
  const t = openSheet(`<h4>整本翻譯成 ${esc(langName(lang))}</h4><p class="hint" style="padding:0 20px" id="allProg">準備中…</p><button class="sheet-item" data-a="stop">停止</button>`, a => { if (a === 'stop') B.stopAll = true; });
  for (let p = 0; p < total && !B.stopAll; p += 40) {
    try { await ensureTrans(b, lang, p, p + 39); } catch {}
    const el = $('#allProg'); if (el) el.textContent = `已翻譯 ${Math.min(total, p + 40)} / ${total} 段（${Math.round(Math.min(total, p + 40) / total * 100)}%）${b.saved ? '' : '。這本書還沒存到手機，翻譯不會保留'}`;
  }
  if (!B.stopAll) { t.close(); toast(b.saved ? '整本翻譯完成，已存在手機，離線也能聽' : '整本翻譯完成'); }
}

/* ---------------- 閱讀器 ---------------- */
function sentsOf(b) {
  if (b._sents) return b._sents;
  Object.defineProperty(b, '_sents', { value: b.paras.map(p => splitSentences(p, b.srcLang)), enumerable: false, writable: true });
  return b._sents;
}
$('#rdLang').innerHTML = LANGS.map(([c, n]) => `<option value="${c}">翻成：${n}</option>`).join('');
$('#rdMore').innerHTML = ICON.more;
async function openReader(id) {
  const b = B.books.find(x => x.id === id); if (!b) return;
  B.book = b; B.rendered = 0;
  if (b.saved && !b._transLoaded) {
    try { for (const t of await DB.allPrefix('trans', b.id + '|')) B.trans.set(t.k, t.v); } catch {}
    Object.defineProperty(b, '_transLoaded', { value: true, enumerable: false, writable: true });
  }
  sentsOf(b);
  $('#rdTitle').textContent = b.title;
  $('#rdLang').value = B.lang;
  $('#reader').hidden = false; document.body.style.overflow = 'hidden';
  if (!history.state?.reader) history.pushState({ reader: 1 }, '');
  applyReaderUI();
  renderReader(true);
}
function closeReader(fromPop) {
  if ($('#reader').hidden) return;
  $('#reader').hidden = true; document.body.style.overflow = '';
  if (!fromPop && history.state?.reader) history.back();
  renderBooks();
}
addEventListener('popstate', () => { if (!$('#reader').hidden) closeReader(true); });
function applyReaderUI() {
  $$('#rdMode button').forEach(x => x.classList.toggle('active', x.dataset.m === B.mode));
  $('#rdLang').disabled = B.mode === 'orig';
  $('#rdRead').value = B.read;
  $('#rdRead').hidden = B.mode !== 'sent';
  $('#rdRate').textContent = (Number.isInteger(B.rate) ? B.rate.toFixed(1) : String(B.rate)) + '×';
  $('#rdBody').style.fontSize = B.font + 'px';
  updateSpeakBtn();
}
function paraHTML(b, p) {
  const ss = sentsOf(b)[p], tr = B.trans.get(tKey(b, B.lang, p));
  const cur = TTS.on && TTS.book === b ? TTS.pos : null;
  const cls = (s) => cur && cur.p === p && cur.s === s ? ' reading' : '';
  if (B.mode === 'orig' || (B.lang === b.srcLang && B.mode !== 'orig' && !tr)) {
    return `<p class="bp" data-p="${p}">${ss.map((s, i) => `<span class="bs${cls(i)}" data-s="${i}">${esc(s)}</span>`).join(' ')}</p>`;
  }
  if (B.mode === 'full') {
    if (!tr) return `<p class="bp pending" data-p="${p}">${ss.map((s, i) => `<span class="bs${cls(i)}" data-s="${i}">${esc(s)}</span>`).join(' ')}</p>`;
    return `<p class="bp" data-p="${p}">${tr.map((t, i) => `<span class="bs${cls(i)}" data-s="${i}">${esc(t || ss[i])}</span>`).join(CJK.test(B.lang === 'ja' || B.lang.startsWith('zh') ? '字' : 'a') ? '' : ' ')}</p>`;
  }
  // 逐句：原文 + 譯文
  return `<div class="bp sent" data-p="${p}">${ss.map((s, i) => `<div class="bpair${cls(i)}" data-s="${i}"><div class="bo">${esc(s)}</div><div class="bt">${tr ? esc(tr[i] || '') : '<span class="bt-wait">翻譯中…</span>'}</div></div>`).join('')}</div>`;
}
function renderReader(jump) {
  const b = B.book; if (!b) return;
  const body = $('#rdBody');
  const upto = Math.min(b.paras.length, Math.max(40, (jump ? b.pos.p : 0) + 25));
  B.rendered = upto;
  body.innerHTML = b.paras.slice(0, upto).map((_, p) => paraHTML(b, p)).join('') + `<div class="rd-more" id="rdSentinel"></div>`;
  observeSentinel();
  if (B.mode !== 'orig') ensureTrans(b, B.lang, jump ? Math.max(0, b.pos.p - 2) : 0, Math.min(upto, (jump ? b.pos.p : 0) + 20)).catch(() => {});
  updateProg();
  if (jump) requestAnimationFrame(() => scrollToPos(b.pos.p, b.pos.s, false));
}
let sentObs;
function observeSentinel() {
  sentObs?.disconnect();
  const el = $('#rdSentinel'); if (!el) return;
  sentObs = new IntersectionObserver(es => { if (es[0].isIntersecting) renderMore(); }, { root: $('#rdBody'), rootMargin: '800px' });
  sentObs.observe(el);
}
function renderMore() {
  const b = B.book; if (!b || B.rendered >= b.paras.length) return;
  const from = B.rendered, to = Math.min(b.paras.length, from + 30);
  $('#rdSentinel').insertAdjacentHTML('beforebegin', b.paras.slice(from, to).map((_, i) => paraHTML(b, from + i)).join(''));
  B.rendered = to;
  if (B.mode !== 'orig') ensureTrans(b, B.lang, from, to - 1).catch(() => {});
}
function refreshPara(p) {
  if (!B.book || p >= B.rendered) return;
  const el = $(`#rdBody .bp[data-p="${p}"]`); if (el) el.outerHTML = paraHTML(B.book, p);
}
function ensureRendered(p) { while (B.book && B.rendered <= p && B.rendered < B.book.paras.length) renderMore(); }
function scrollToPos(p, s, smooth = true) {
  ensureRendered(p);
  const el = $(`#rdBody .bp[data-p="${p}"] [data-s="${s}"]`) || $(`#rdBody .bp[data-p="${p}"]`);
  el?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}
/* ---------- 整本書的「時間軸」：用每句字數估算朗讀時間，讓進度條可以拖、鎖定畫面顯示時間 ---------- */
function timeline(b) {
  const parts = TTS.parts().length, key = parts + '|' + B.rate;
  if (b._tl && b._tl.key === key) return b._tl;
  const ss = sentsOf(b), cum = [0], first = [];
  let i = 0;
  for (let p = 0; p < ss.length; p++) {
    first.push(i);
    for (const t of ss[p]) {
      const cjk = (t.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
      const secs = (cjk / 4.3 + (t.length - cjk) / 14 + 0.35) * parts / B.rate;   // 中日韓約每秒 4 字、英文約每秒 14 字母
      cum.push(cum[i] + secs); i++;
    }
  }
  const tl = { key, cum, first, total: cum[i] || 1, count: i };
  Object.defineProperty(b, '_tl', { value: tl, enumerable: false, writable: true });
  return tl;
}
const tlIndex = (b, pos) => timeline(b).first[pos.p] + pos.s;
function tlPos(b, idx) {   // 第幾句 → {p, s}
  const tl = timeline(b); idx = Math.max(0, Math.min(tl.count - 1, idx));
  let lo = 0, hi = tl.first.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tl.first[m] <= idx) lo = m; else hi = m - 1; }
  return { p: lo, s: idx - tl.first[lo] };
}
function tlSeek(b, secs) {   // 時間（秒）→ {p, s}
  const c = timeline(b).cum; let lo = 0, hi = c.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= secs) lo = m; else hi = m - 1; }
  return tlPos(b, lo);
}
function fmtLeft(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `剩約 ${h} 小時 ${m} 分` : `剩約 ${Math.max(1, m)} 分`;
}
function updateProg() {
  const b = B.book; if (!b) return;
  const tl = timeline(b), now = tl.cum[tlIndex(b, b.pos)] || 0;
  if (!B.seeking) $('#rdSeek').value = Math.round(now / tl.total * 1000);
  $('#rdCur').textContent = Math.round(now / tl.total * 100) + '%';
  $('#rdLeft').textContent = fmtLeft(tl.total - now);
}
// 拖閱讀器下面的進度條：放開後跳到那裡（正在朗讀就從那句接著讀）
$('#rdSeek').addEventListener('input', () => {
  const b = B.book; if (!b) return;
  B.seeking = true;
  const tl = timeline(b), secs = $('#rdSeek').value / 1000 * tl.total;
  const pos = tlSeek(b, secs);
  $('#rdCur').textContent = Math.round(secs / tl.total * 100) + '%';
  $('#rdLeft').textContent = `第 ${pos.p + 1} 段`;
});
$('#rdSeek').addEventListener('change', () => {
  const b = B.book; if (!b) return;
  const tl = timeline(b), pos = tlSeek(b, $('#rdSeek').value / 1000 * tl.total);
  B.seeking = false;
  setPos(pos.p, pos.s);
  if (TTS.on && TTS.book === b) { TTS.unlock(); TTS.start(b, pos); }
  else { scrollToPos(pos.p, pos.s, false); markReading(pos); }
  B.userScrollAt = 0;
});
let posSaveT;
function setPos(p, s) {
  const b = B.book || TTS.book; if (!b) return;
  b.pos = { p, s };
  if (B.book === b) updateProg();
  clearTimeout(posSaveT);
  posSaveT = setTimeout(() => { if (b.saved) DB.put('books', b).catch(() => {}); }, 2000);
}
$('#rdBody').addEventListener('scroll', () => { B.userScrollAt = Date.now(); }, { passive: true });
$('#rdBody').addEventListener('click', e => {
  const s = e.target.closest('[data-s]'), p = e.target.closest('.bp');
  if (!s || !p) return;
  const pos = { p: +p.dataset.p, s: +s.dataset.s };
  setPos(pos.p, pos.s);
  if (TTS.on) { TTS.unlock(); TTS.start(B.book, pos); }
  else { markReading(pos); toast('按 🔊 從這一句開始朗讀', 1800); }
});
$('#rdBack').onclick = () => closeReader();
$('#rdFont').onclick = () => { B.font = B.font >= 26 ? 15 : B.font + 2; LS.set('bookFont', B.font); applyReaderUI(); };
$('#rdMore').onclick = () => B.book && bookMenu(B.book);
$('#rdLang').onchange = () => { B.lang = $('#rdLang').value; LS.set('bookLang', B.lang); renderReader(true); if (TTS.on) TTS.restart(); };
function setReaderMode(mode, lang) {
  B.mode = mode; LS.set('bookMode', mode);
  if (lang) { B.lang = lang; LS.set('bookLang', lang); $('#rdLang').value = lang; }
  applyReaderUI(); renderReader(true); if (TTS.on) TTS.restart();
}
$('#rdMode').onclick = e => {
  const x = e.target.closest('button'); if (!x) return;
  const mode = x.dataset.m;
  if (mode === 'orig') return setReaderMode('orig');
  // 逐句／全部翻譯：先問要翻成哪種語言，選好才開始翻（不會先用上次的語言翻一遍）
  const b = B.book;
  const done = code => b && [...B.trans.keys()].some(k => k.startsWith(`${b.id}|${code}|`));
  openSheet(`<h4>${mode === 'sent' ? '逐句翻譯' : '全部翻譯'}：要翻成哪種語言？</h4>
    ${LANGS.map(([c, n]) => `<button class="sheet-item${c === B.lang ? ' on' : ''}" data-a="${c}">${c === B.lang ? '✓ ' : ''}${esc(n)}${done(c) ? ' <small style="color:#34c759">已翻好，馬上顯示</small>' : ''}</button>`).join('')}
    <button class="sheet-item" data-a="no">取消</button>`, a => {
    if (a === 'no' || !LANGS.some(([c]) => c === a)) return;
    setReaderMode(mode, a);
  });
};
$('#rdRead').onchange = () => { B.read = $('#rdRead').value; LS.set('bookRead', B.read); if (TTS.on) TTS.restart(); };
$('#rdRate').onclick = () => {
  const rates = [0.75, 1, 1.25, 1.5, 2];
  B.rate = rates[(rates.indexOf(B.rate) + 1) % rates.length] || 1; LS.set('bookRate', B.rate);
  TTS.el.playbackRate = B.rate; applyReaderUI(); updateProg(); TTS.pushPosition();
};
function markReading(pos) {
  $$('#rdBody .reading').forEach(x => x.classList.remove('reading'));
  if (!pos) return;
  const el = $(`#rdBody .bp[data-p="${pos.p}"] [data-s="${pos.s}"]`);
  el?.classList.add('reading');
}

/* ---------------- 朗讀（用 <audio> 播放，鎖螢幕／開車也能繼續） ---------------- */
const SILENT = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAACAAAA/oAR0dHR0dHR0dHR0dHYmJiYmJiYmJiYmJifHx8fHx8fHx8fHx8fJaWlpaWlpaWlpaWlrGxsbGxsbGxsbGxsbHLy8vLy8vLy8vLy8vl5eXl5eXl5eXl5eXl////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQC1AAAAAAAAAP6yysejgAAAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsSjAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==';
// 送 Google 語音請求時不帶來源網站（比較不會被擋）；看 YouTube 時要恢復，不然 YouTube 播放器會出錯
function noReferrer(on) {
  let m = document.getElementById('refMeta');
  if (on && !m) { m = document.createElement('meta'); m.id = 'refMeta'; m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m); }
  if (!on && m) m.remove();
}
const TTS = {
  el: $('#ttsEl'), on: false, playing: false, book: null, pos: null, phase: 0, token: 0, synthMode: false,
  googleFails: 0, googleDown: false, unlocked: false,
  /* 一定要在「按下按鈕的當下」呼叫：iPhone 只允許這時候開始出聲音，之後才能自動一句接一句播 */
  unlock() {
    try { if (!this.el.src || this.el.paused) { this.el.src = SILENT; this.el.play().catch(() => {}); } } catch {}
    if (!this.unlocked && 'speechSynthesis' in window) {
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {}
    }
    this.unlocked = true;
  },
  // 這一句要讀哪些：['o'] 原文、['t'] 譯文
  parts() {
    if (B.mode === 'orig') return ['o'];
    if (B.mode === 'full') return ['t'];
    return B.read === 'both' ? ['o', 't'] : B.read === 'trans' ? ['t'] : ['o'];
  },
  start(book, pos) {
    P.guardUntil = 0;
    if (P.item && !audioEl.paused) audioEl.pause();          // 先停掉影片／音樂
    this.book = book; this.pos = { ...pos }; this.phase = 0; this.on = true;
    const tok = ++this.token;
    this.setSession();
    loadPack(book).finally(() => { if (tok === this.token) this.loop(tok); });
    updateSpeakBtn(); renderBooks();
  },
  restart() { if (this.on && this.book) this.start(this.book, this.pos); },
  stop() {
    this.on = false; this.playing = false; this.token++; noReferrer(false);
    this.el.pause(); try { speechSynthesis.cancel(); } catch {}
    updateSpeakBtn(); markReading(null); renderBooks();
  },
  pause() {
    this.playing = false;
    if (this.synthMode) { try { speechSynthesis.pause(); } catch {} } else this.el.pause();
    updateSpeakBtn();
  },
  resume() {
    this.playing = true;
    if (this.synthMode) { try { speechSynthesis.resume(); } catch {} } else this.el.play().catch(() => {});
    updateSpeakBtn();
  },
  step(d) {
    if (!this.book) return;
    const ss = sentsOf(this.book);
    let { p, s } = this.pos;
    s += d;
    while (s < 0 && p > 0) { p--; s += ss[p].length; }
    while (p < ss.length && s >= ss[p].length) { s -= ss[p].length; p++; }
    if (s < 0) s = 0;
    if (p >= ss.length) return;
    this.start(this.book, { p, s });
  },
  async loop(tok) {
    const b = this.book, ss = sentsOf(b);
    while (this.on && tok === this.token) {
      const { p, s } = this.pos;
      if (p >= ss.length) { this.stop(); toast('讀完了 📖'); return; }
      // 往後多翻幾段，開車時不會卡住
      if (B.mode !== 'orig') ensureTrans(b, B.lang, p, p + 4).catch(() => {});
      const parts = this.parts();
      if (B.book === b) { markReading(this.pos); if (Date.now() - B.userScrollAt > 4000) scrollToPos(p, s); }
      setPos(p, s);
      this.pushPosition();
      for (let i = this.phase; i < parts.length; i++) {
        if (!this.on || tok !== this.token) return;
        this.phase = i;
        let text = ss[p][s], lang = sentLang(text, b.srcLang);
        if (parts[i] === 't') {
          let tr = B.trans.get(tKey(b, B.lang, p));
          if (!tr) { try { await ensureTrans(b, B.lang, p, p + 4); } catch {} tr = B.trans.get(tKey(b, B.lang, p)); }
          if (!this.on || tok !== this.token) return;
          if (tr && tr[s]) { text = tr[s]; lang = sentLang(text, B.lang); }
          else if (parts.includes('o')) continue;     // 翻譯拿不到：已經讀過原文就跳過
        }
        await this.speak(text, lang, tok);
      }
      if (!this.on || tok !== this.token) return;
      this.phase = 0;
      let np = p, ns = s + 1;
      if (ns >= ss[p].length) { np = p + 1; ns = 0; }
      this.pos = { p: np, s: ns };
    }
  },
  chunks(text, max) {
    const out = []; let rest = text.trim();
    while (rest.length > max) {
      let cut = -1;
      for (const ch of ['。', '！', '？', '. ', '! ', '? ', '；', '; ', '，', ', ', '、', ' ']) cut = Math.max(cut, rest.lastIndexOf(ch, max));
      if (cut < max * 0.3) cut = max - 1;
      out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
    return out;
  },
  url(text, lang) {
    if (!serverReady()) noReferrer(true);
    if (serverReady()) return `${getServer()}/api/tts?key=${encodeURIComponent((serverKey.value || '').trim())}&lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
    return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
  },
  async speak(text, lang, tok) {
    if (!text || !text.trim()) return;
    const off = PACK.id === this.book?.id && PACK.keys.size > 0;
    const parts = this.chunks(text, off || !serverReady() ? 180 : 900);
    for (const c of parts) {
      let tries = 0;
      // 已經下載好的聲音：直接從手機裡播，不用網路（飛機上、鎖螢幕都可以）
      if (off && PACK.keys.has(ttsHash(lang, c))) {
        const blob = await DB.get('blobs', `tts_${this.book.id}_${ttsHash(lang, c)}`).catch(() => null);
        if (!this.on || tok !== this.token) return;
        if (blob) {
          const u = URL.createObjectURL(blob);
          const ok = await this.playChunk(c, lang, tok, u);
          URL.revokeObjectURL(u);
          if (!this.on || tok !== this.token) return;
          if (ok) continue;
        }
      }
      while (this.on && tok === this.token) {
        let ok = false;
        // 背景（鎖螢幕、開車）時一定用線上語音：手機內建語音在背景不會出聲
        if (serverReady() || !this.googleDown || document.hidden) ok = await this.playChunk(c, lang, tok);
        if (!this.on || tok !== this.token) return;
        if (ok) { this.googleFails = 0; break; }
        if (!serverReady() && ++this.googleFails >= 2 && !document.hidden) this.googleDown = true;
        if (document.hidden) {
          // 在背景失敗：等一下再試，試 3 次還不行就跳過這一小段，繼續往下讀（不會停下來）
          if (++tries >= 3) { console.warn('skip chunk', c); break; }
          await sleep(1500 * tries);
          continue;
        }
        await this.synth(c, lang, tok);
        break;
      }
    }
  },
  playChunk(text, lang, tok, src) {
    return new Promise(res => {
      const el = this.el;
      let done = false;
      let last = Date.now();
      const onTU = () => { last = Date.now(); };
      const fin = ok => { if (done) return; done = true; el.onended = el.onerror = null; clearTimeout(t); clearInterval(wd); el.removeEventListener('timeupdate', onTU); res(ok); };
      const t = setTimeout(() => fin(false), 8000);    // 8 秒還沒開始播就換方法
      // 播到一半卡住（網路不穩）超過 12 秒 → 重新來，不會整個停住
      const wd = setInterval(() => { if (!this.playing) { last = Date.now(); return; } if (Date.now() - last > 12000) fin(false); }, 2000);
      el.addEventListener('timeupdate', onTU);
      el.onended = () => fin(true);
      el.onerror = () => fin(false);
      this.synthMode = false;
      el.src = src || this.url(text, lang);
      el.playbackRate = B.rate;
      this.playing = true; updateSpeakBtn();
      el.play().then(() => { clearTimeout(t); }).catch(err => { console.warn('tts play', err); fin(false); });
    });
  },
  // 線上語音失敗時：用手機內建語音（這個在鎖螢幕時可能會停）
  synth(text, lang, tok) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      if (!this.synthWarned) { this.synthWarned = true; toast('線上語音連不上，改用手機內建語音（鎖螢幕可能會停；請關閉靜音模式）', 4500); }
      this.synthMode = true;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'zh-TW' ? 'zh-TW' : lang === 'zh-CN' ? 'zh-CN' : lang;
      const vs = speechSynthesis.getVoices(), want = u.lang.toLowerCase(), base = want.split('-')[0];
      const norm = x => x.lang.replace('_', '-').toLowerCase();
      const v = vs.find(x => norm(x) === want) || (want === 'zh-tw' && vs.find(x => /zh-(hk|hant)/.test(norm(x)))) || vs.find(x => norm(x).startsWith(base));
      if (v) u.voice = v;
      u.rate = Math.min(2, B.rate);
      let started = false, finished = false;
      const warn = () => {
        if (this.silentWarned) return;
        this.silentWarned = true;
        this.stop();
        openSheet(`<h4>朗讀沒有聲音</h4>
            <p class="hint" style="padding:0 20px">1. 請把 iPhone 側邊的<b>靜音開關關掉</b>（橘色那面朝內），並把音量調大。<br>2. 線上語音（Google）目前連不上。到「下載」設定好 ☁️ 伺服器後，會改用伺服器的語音，最穩定，鎖螢幕也能聽。<br>3. 可以在書的「⋯」選「🔈 測試朗讀聲音」，看是哪一段不通。</p>
            <button class="sheet-item" data-a="ok">知道了</button>`);
      };
      const done = () => { if (!finished) { finished = true; res(); } };
      u.onstart = () => { started = true; this.playing = true; updateSpeakBtn(); };
      u.onend = done;
      u.onerror = () => { if (!started && this.on && tok === this.token) warn(); done(); };
      speechSynthesis.speak(u);
      setTimeout(() => { if (!started && this.on && tok === this.token) { warn(); done(); } }, 4000);
    });
  },
  setSession() {
    if (!('mediaSession' in navigator) || !this.book) return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: this.book.title, artist: 'myTube 電子書', album: langName(B.lang) }); } catch {}
    const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    set('play', () => this.resume()); set('pause', () => this.pause());
    set('previoustrack', () => this.step(-1)); set('nexttrack', () => this.step(1));
    // 鎖定畫面的進度條和 ⟲10 / ⟳10：照估算的時間跳
    set('seekbackward', d => this.seekBy(-(d?.seekOffset || 10)));
    set('seekforward', d => this.seekBy(d?.seekOffset || 10));
    set('seekto', d => { if (d && d.seekTime != null && this.book) this.start(this.book, tlSeek(this.book, d.seekTime)); });
    this.pushPosition();
  },
  now() {   // 現在讀到整本書的第幾秒（估算）
    if (!this.book || !this.pos) return 0;
    const tl = timeline(this.book), i = tlIndex(this.book, this.pos);
    const one = (tl.cum[i + 1] - tl.cum[i]) / Math.max(1, this.parts().length);
    return Math.min(tl.total, tl.cum[i] + this.phase * one + Math.min(one, (this.el.currentTime || 0) / Math.max(0.5, B.rate)));
  },
  seekBy(sec) { if (this.book) this.start(this.book, tlSeek(this.book, Math.max(0, this.now() + sec))); },
  pushPosition() {
    if (!('mediaSession' in navigator) || !this.book || !navigator.mediaSession.setPositionState) return;
    const tl = timeline(this.book);
    try { navigator.mediaSession.setPositionState({ duration: tl.total, position: Math.min(tl.total, this.now()), playbackRate: this.playing ? 1 : 1 }); } catch {}
    try { navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused'; } catch {}
  },
};
TTS.el.addEventListener('play', () => { TTS.playing = true; updateSpeakBtn(); TTS.pushPosition(); });
let lastPush = 0;
TTS.el.addEventListener('timeupdate', () => { if (TTS.on && Date.now() - lastPush > 1000) { lastPush = Date.now(); TTS.pushPosition(); } });
TTS.el.addEventListener('pause', () => { if (!TTS.el.ended) { TTS.playing = false; updateSpeakBtn(); TTS.pushPosition(); } });
// 開始播影片／音樂時，停止朗讀
audioEl.addEventListener('play', () => { if (TTS.on) TTS.stop(); });
function updateSpeakBtn() {
  const btn = $('#rdSpeak'); if (!btn) return;
  const active = TTS.on && TTS.book === B.book && TTS.playing;
  btn.innerHTML = active ? ICON.pause
    : '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
}
$('#rdSpeak').onclick = () => {
  const b = B.book; if (!b) return;
  TTS.unlock();
  if (TTS.on && TTS.book === b) { TTS.playing ? TTS.pause() : TTS.resume(); return; }
  TTS.googleDown = false; TTS.googleFails = 0; TTS.silentWarned = false;   // 每次重新開始都再試一次
  TTS.start(b, b.pos || { p: 0, s: 0 });
};
$('#rdPrev').onclick = () => { if (TTS.on) { TTS.unlock(); TTS.step(-1); } };
$('#rdNext').onclick = () => { if (TTS.on) { TTS.unlock(); TTS.step(1); } };

/* ---------------- 離線朗讀：先把整本書的聲音下載到手機 ---------------- */
const PACK = { id: null, keys: new Set() };
const packKey = b => 'ttspack_' + b.id;
function ttsHash(lang, text) {
  const str = lang + '|' + text;
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995); h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
async function loadPack(b) {
  if (!b) return;
  const m = await DB.get('kv', packKey(b)).catch(() => null);
  PACK.id = b.id; PACK.keys = new Set(m?.keys || []); PACK.meta = m || null;
}
async function savePack(b, keys, extra) {
  const m = { keys: [...keys], at: Date.now(), mode: B.mode, read: B.read, lang: B.lang, ...extra };
  await DB.put('kv', m, packKey(b));
  if (PACK.id === b.id) { PACK.keys = new Set(keys); PACK.meta = m; }
}
const readDesc = () => B.mode === 'orig' ? '只唸原文' : B.mode === 'full' ? `只唸${langName(B.lang)}翻譯` : B.read === 'both' ? `原文＋${langName(B.lang)}翻譯` : B.read === 'trans' ? `只唸${langName(B.lang)}翻譯` : '只唸原文';
// 照「現在的朗讀設定」列出整本書要唸的每一小段（跟朗讀時切的方式一模一樣）
async function buildPackList(b, prog) {
  const ss = sentsOf(b), parts = TTS.parts();
  if (parts.includes('t')) {
    for (let p = 0; p < ss.length; p += 8) {
      prog(`先翻譯整本書（需要網路）… ${Math.round(p / ss.length * 100)}%`);
      await ensureTrans(b, B.lang, p, p + 7);
    }
  }
  const items = [], seen = new Set();
  for (let p = 0; p < ss.length; p++) for (let s = 0; s < ss[p].length; s++) for (const part of parts) {
    let text = ss[p][s], lang = sentLang(text, b.srcLang);
    if (part === 't') {
      const tr = B.trans.get(tKey(b, B.lang, p));
      if (tr && tr[s]) { text = tr[s]; lang = sentLang(text, B.lang); }
      else if (parts.includes('o')) continue;
    }
    if (!text || !text.trim()) continue;
    for (const c of TTS.chunks(text, 180)) {
      const h = ttsHash(lang, c);
      if (!seen.has(h)) { seen.add(h); items.push([h, lang, c]); }
    }
  }
  return items;
}
const TTS_SRC = [
  () => serverReady() && ((l, t) => `${getServer()}/api/tts?key=${encodeURIComponent((serverKey.value || '').trim())}&lang=${encodeURIComponent(l)}&text=${encodeURIComponent(t)}`),
  () => (l, t) => `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(l)}&q=${encodeURIComponent(t)}`,
  () => (l, t) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(l)}&q=${encodeURIComponent(t)}`,
];
let ttsSrcOk = -1;
async function fetchTTS(lang, text) {
  const order = ttsSrcOk >= 0 ? [ttsSrcOk, ...TTS_SRC.keys()] : [...TTS_SRC.keys()];
  for (const i of [...new Set(order)]) {
    const mk = TTS_SRC[i](); if (!mk) continue;
    try {
      const r = await fetch(mk(lang, text), { referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (!r.ok) continue;
      const b = await r.blob();
      if (b.size < 300 || /text|html|json/.test(b.type)) continue;
      ttsSrcOk = i; LS.set('ttsDirect', 'yes');
      return b.type.startsWith('audio') ? b : new Blob([b], { type: 'audio/mpeg' });
    } catch (e) { /* 這個來源不給網頁下載（CORS）或沒網路 → 換下一個 */ }
  }
  throw new Error('no-source');
}
async function offlineSheet(b) {
  await loadPack(b);
  const n = PACK.keys.size, m = PACK.meta;
  // 這支手機之前已經知道 Google 不讓網頁下載 → 先把 a-Shell 指令準備好，按一下就複製＋跳過去
  let direct = null;
  if (LS.get('ttsDirect') === 'no' && !serverReady()) {
    try {
      const needT = TTS.parts().includes('t'), ss = sentsOf(b);
      if (!needT || ss.every((_, p) => B.trans.has(tKey(b, B.lang, p)))) {
        const items = await buildPackList(b, () => {});
        const have = new Set([...PACK.keys]);
        if (items.some(it => !have.has(it[0]))) direct = await ashellJob(b, items, have);
      }
    } catch (e) { console.warn(e); }
  }
  openSheet(`<h4>🎧 下載朗讀聲音：${esc(b.title)}</h4>
    <p class="hint" style="padding:0 20px">先在有網路時把整本書的聲音<b>下載到手機（存在 myTube 裡）</b>，之後在飛機上、沒網路也能朗讀，鎖螢幕、切到別的 App 都會繼續唸。<br><br>
    會照<b>現在的朗讀設定</b>下載：${esc(readDesc())}。（之後改了朗讀方式或翻譯語言，要再下載一次）<br>
    ${n ? `目前已下載：<b>${n} 段</b>（${m?.lang ? esc(langName(m.lang)) + '，' : ''}${new Date(m?.at || Date.now()).toLocaleDateString()}）` : '目前還沒有下載。'}</p>
    ${direct ? `<button class="sheet-item ph-big" data-a="go">⬇️ 開始下載（自動複製指令、跳到 a-Shell）</button>
      <p class="hint" style="padding:0 20px">到了 a-Shell：<b>長按畫面 → 貼上 → 按「換行」</b>就開始下載。完成後回到 myTube，會自動跳出「匯入」。</p>`
      : `<button class="sheet-item ph-big" data-a="dl">⬇️ ${n ? '補齊／更新' : '開始下載'}朗讀聲音</button>`}
    <button class="sheet-item btnlike" data-a="imp">📥 匯入 a-Shell 下載好的朗讀聲音（…-朗讀.mp3）</button>
    ${n ? '<button class="sheet-item danger" data-a="del">🗑 刪除下載的朗讀聲音（釋放空間）</button>' : ''}
    <button class="sheet-item" data-a="no">關閉</button>`, async a => {
    if (a === 'go') { copyText(direct.cmd); armReturn(b, direct.zipPath); openAShell(); toast('✅ 已複製指令，在 a-Shell 長按 → 貼上 → 換行', 4000); }
    if (a === 'dl') downloadPack(b);
    if (a === 'imp') pickPackZip(b);
    if (a === 'del') { await DB.delPrefix('blobs', `tts_${b.id}_`); await DB.del('kv', packKey(b)); await loadPack(b); toast('已刪除下載的朗讀聲音'); }
  });
}
async function downloadPack(b) {
  if (!navigator.onLine) return toast('要有網路才能下載，請連上網路再試');
  let cancel = false;
  const sh = openSheet(`<h4>⬇️ 下載離線朗讀聲音</h4><p class="hint" style="padding:0 20px" id="pkProg">準備中…</p><div class="ph-bar"><i id="pkBar"></i></div>
    <p class="hint" style="padding:0 20px">下載時請停在 myTube（不要鎖螢幕）。中斷了沒關係，再按一次會接著下載。</p>
    <button class="sheet-item" data-a="stop">停止</button>`, a => { if (a === 'stop') cancel = true; });
  $('#sheetBackdrop').onclick = null;
  const prog = (t, f) => { const el = $('#pkProg'); if (el) el.textContent = t; if (f != null && $('#pkBar')) $('#pkBar').style.width = Math.round(f * 100) + '%'; };
  try {
    if (!b.saved) { prog('先把這本書存到手機…'); await saveBook(b, true); }   // 沒存的書，關掉 App 就不見了
    await loadPack(b);
    const items = await buildPackList(b, prog);
    if (b.saved) for (const [k, v] of B.trans) if (k.startsWith(b.id + '|')) await DB.put('trans', { k, v }).catch(() => {});
    const have = new Set([...PACK.keys].filter(h => items.some(it => it[0] === h)));
    const todo = items.filter(it => !have.has(it[0]));
    if (!todo.length) { await savePack(b, have); sh.close(); toast('✅ 已經全部下載好了，可以離線朗讀', 3500); return; }
    prog('測試下載…', 0);
    try { const first = await fetchTTS(todo[0][1], todo[0][2]); await DB.put('blobs', first, `tts_${b.id}_${todo[0][0]}`); have.add(todo[0][0]); }
    catch { LS.set('ttsDirect', 'no'); sh.close(); return ashellPackSheet(b, items, have); }      // 瀏覽器不能直接下載 → 用 a-Shell
    let done = 1, fail = 0, i = 1;
    const worker = async () => {
      while (!cancel && i < todo.length) {
        const it = todo[i++];
        let ok = false;
        for (let k = 0; k < 3 && !ok && !cancel; k++) {
          try { const bl = await fetchTTS(it[1], it[2]); await DB.put('blobs', bl, `tts_${b.id}_${it[0]}`); have.add(it[0]); ok = true; }
          catch { await sleep(800 * (k + 1)); }
        }
        if (!ok && !cancel) fail++;
        done++;
        prog(`下載中 ${done} / ${todo.length}${fail ? `（${fail} 段失敗）` : ''}`, done / todo.length);
        if (done % 25 === 0) await savePack(b, have);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await savePack(b, have);
    sh.close();
    const missing = items.length - [...have].length;
    if (cancel) toast(`已停止，下載了 ${have.size} / ${items.length} 段，下次會接著下載`, 4000);
    else if (missing > 0) toast(`下載完成，但有 ${missing} 段失敗，再按一次「補齊」就好`, 4500);
    else toast('✅ 整本書的聲音都下載好了！沒網路也能背景朗讀', 4000);
  } catch (e) {
    console.error(e); sh.close();
    openSheet(`<h4>下載沒有完成</h4><p class="hint" style="padding:0 20px">${esc(/翻譯|translate|fetch|network/i.test(e.message) ? '翻譯或下載需要網路，請確認網路後再試。' : e.message)}<br>已經下載好的部分會保留，下次會接著下載。</p><button class="sheet-item" data-a="ok">知道了</button>`);
  }
}
// 瀏覽器被 Google 擋住時：請 a-Shell 幫忙下載（Python 沒有這個限制），下載好再匯入
// 書的內容直接包在指令裡（壓縮過），只要「貼上 → 換行」一次就好
async function packJobB64(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let data = bytes, z = 'j';
  if (typeof CompressionStream !== 'undefined') {
    try { data = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); z = 'z'; } catch { data = bytes; z = 'j'; }
  }
  let bin = ''; for (let i = 0; i < data.length; i += 32768) bin += String.fromCharCode.apply(null, data.subarray(i, i + 32768));
  return 'MTJOB' + z + ':' + btoa(bin);
}
const ONE_PASTE_MAX = 120000;       // 太長的指令貼進 a-Shell 會很慢，超過就分兩步
async function ashellJob(b, items, have) {
  const todo = items.filter(it => !have.has(it[0]));
  const obj = { book: b.id, title: b.title, items: todo };
  const base = `python3 -c "import urllib.request as u;exec(u.urlopen('${MT_URL}').read())" tts`;
  const b64 = await packJobB64(obj);
  const one = b64.length <= ONE_PASTE_MAX;
  return {
    todo: todo.length, one, cmd: one ? `${base} ${b64}` : base,
    job: 'MYTUBE-TTS1\n' + JSON.stringify(obj),
    zipPath: `我的 iPhone › a-Shell › myTube › 朗讀 › 「${esc(b.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60))}-朗讀.mp3」`,
  };
}
function armReturn(b, zipPath) {      // 從 a-Shell 回來時，自動跳出「匯入」
  const onVis = () => {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', onVis);
    setTimeout(() => importPrompt(b, zipPath), 400);
  };
  setTimeout(() => document.addEventListener('visibilitychange', onVis), 1500);
}
async function ashellPackSheet(b, items, have) {
  const J = await ashellJob(b, items, have);
  openSheet(`<h4>🎧 用 a-Shell 下載朗讀聲音</h4>
    <p class="hint" style="padding:0 20px">Google 不讓網頁直接下載聲音，改請 a-Shell 幫忙（共 ${J.todo} 段）。<br>按下面紅色按鈕，會<b>自動複製這行指令</b>並<b>自動跳到 a-Shell</b>：</p>
    <div class="cmd-box">${esc(J.cmd.slice(0, 90))}${J.cmd.length > 90 ? '…（很長，不用看）' : ''}</div>
    <button class="sheet-item ph-big" data-a="c1" data-keep>📋 ${J.one ? '複製指令並跳到 a-Shell' : '① 複製指令並跳到 a-Shell'}</button>
    <p class="hint" style="padding:0 20px">到了 a-Shell：<b>長按畫面 → 貼上 → 按鍵盤的「換行」</b>${J.one ? '，就會開始下載。' : '。它會叫你回來按 ②。'}<br>
    等它顯示「✅ 完成」，回到 myTube，會自動跳出「匯入」按鈕。</p>
    ${J.one ? '' : `<button class="sheet-item btnlike" data-a="c2" data-keep>② 複製書的內容並跳回 a-Shell（再按換行）</button>`}
    <button class="sheet-item btnlike" data-a="imp" data-keep>📥 匯入下載好的朗讀聲音</button>
    <p class="hint" style="padding:0 20px;margin:0">（檔案在：${J.zipPath}）</p>
    <button class="sheet-item" data-a="no">關閉</button>`, a => {
    if (a === 'c1') { copyText(J.cmd); armReturn(b, J.zipPath); openAShell(); toast('✅ 已複製指令，在 a-Shell 長按 → 貼上 → 換行', 4000); }
    if (a === 'c2') { copyText(J.job); armReturn(b, J.zipPath); openAShell(); toast('✅ 已複製書的內容，回 a-Shell 按換行'); }
    if (a === 'imp') pickPackZip(b);
  });
}
// 從 a-Shell 回到 myTube 時跳出來（選檔案一定要手指按一下，iPhone 規定）
function importPrompt(b, zipPath) {
  openSheet(`<h4>📥 a-Shell 下載好了嗎？</h4>
    <p class="hint" style="padding:0 20px">如果 a-Shell 已經顯示「✅ 完成」，按下面的按鈕，選：<br>${zipPath}</p>
    <button class="sheet-item ph-big" data-a="imp">📥 匯入朗讀聲音</button>
    <button class="sheet-item" data-a="later">還沒好，等一下再匯入（之後在書的「⋯ → 🎧 離線朗讀」匯入）</button>`, a => {
    if (a === 'imp') pickPackZip(b);
  });
}
function pickPackZip(b) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'audio/*,.mp3,.zip,application/zip';      // iPhone 只讓你選這裡列出的檔案類型
  inp.style.display = 'none'; document.body.appendChild(inp);
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) importPackFile(f, b); };
  inp.click();
}
// 是不是 a-Shell 做的朗讀聲音檔（.mp3 最後面有 MTTSIDX1 索引）
async function isPackFile(f) {
  if (!f || f.size < 20) return false;
  try { return new TextDecoder().decode(await f.slice(f.size - 8).arrayBuffer()) === 'MTTSIDX1'; } catch { return false; }
}
async function readPack(f) {
  if (await isPackFile(f)) {
    const tail = new DataView(await f.slice(f.size - 12, f.size - 8).arrayBuffer());
    const len = tail.getUint32(0, false);
    const info = JSON.parse(new TextDecoder().decode(await f.slice(f.size - 12 - len, f.size - 12).arrayBuffer()));
    const out = [];
    for (const [h, [off, n]] of Object.entries(info.items)) out.push([h, () => Promise.resolve(f.slice(off, off + n, 'audio/mpeg'))]);
    return { info, entries: out };
  }
  await loadScript('vendor/photo/jszip.min.js');          // 舊版的 .zip
  const zip = await JSZip.loadAsync(f);
  const info = JSON.parse(await zip.file('info.json').async('string'));
  const out = Object.keys(zip.files).filter(n => n.endsWith('.mp3')).map(n => [n.replace(/\.mp3$/, '').split('/').pop(), () => zip.file(n).async('blob')]);
  return { info, entries: out };
}
async function importPackFile(file, b) {
  toast('匯入朗讀聲音…', 60000);
  try {
    const { info, entries } = await readPack(file);
    let target = B.books.find(x => x.id === info.book);
    if (!target && b) {
      if (!confirm(`這個檔案是「${info.title}」的朗讀聲音，不是「${b.title}」的。還是要匯入到「${b.title}」嗎？`)) return toast('已取消');
      target = b;
    }
    if (!target) return toast(`找不到「${info.title}」這本書，請先匯入這本書再匯入聲音`, 5000);
    await loadPack(target);
    const have = new Set(PACK.keys);
    let n = 0;
    for (const [h, get] of entries) {
      const data = await get();
      await DB.put('blobs', new Blob([data], { type: 'audio/mpeg' }), `tts_${target.id}_${h}`);
      have.add(h); n++;
      if (n % 50 === 0) toast(`匯入朗讀聲音… ${n} / ${entries.length}`, 60000);
    }
    await savePack(target, have);
    $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true;
    toast(`✅ 匯入 ${n} 段聲音，「${target.title}」沒網路也能朗讀了`, 4500);
    return true;
  } catch (e) { console.error(e); toast('匯入失敗：這不是 myTube 的朗讀聲音檔（' + (e.message || e) + '）', 5000); }
}
window.isPackFile = isPackFile; window.importPackFile = importPackFile;

/* ---------------- 測試朗讀聲音：找出是哪一段不通 ---------------- */
function soundTest() {
  TTS.unlock();        // 這是按按鈕的當下
  if (TTS.on) TTS.stop();
  const out = [];
  const show = () => openSheet(`<h4>🔈 測試朗讀聲音</h4><p class="hint" style="padding:0 20px">${out.join('<br>') || '測試中…'}</p><button class="sheet-item" data-a="ok">關閉</button>`);
  show();
  const el = TTS.el;
  const tryUrl = (label, url) => new Promise(res => {
    let done = false;
    const fin = (ok, why) => { if (done) return; done = true; el.onended = el.onerror = el.onplaying = null; out.push(`${ok ? '✅' : '❌'} ${label}${why ? '：' + why : ''}`); show(); res(ok); };
    el.onplaying = () => setTimeout(() => fin(true), 400);
    el.onerror = () => fin(false, '連不上或被拒絕');
    setTimeout(() => fin(false, '8 秒沒有回應'), 8000);
    if (url.includes('translate.google.com')) noReferrer(true);
    el.src = url; el.play().catch(e => fin(false, '被 iPhone 擋下（' + e.name + '）'));
  });
  (async () => {
    out.push('會依序播放幾段「你好」，有聽到的就是可以用的。'); show();
    if (serverReady()) await tryUrl('伺服器語音', `${getServer()}/api/tts?key=${encodeURIComponent((serverKey.value || '').trim())}&lang=zh-TW&text=${encodeURIComponent('伺服器語音測試，你好')}`);
    else out.push('➖ 伺服器語音：還沒設定 ☁️ 伺服器');
    await tryUrl('Google 線上語音', `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-TW&q=${encodeURIComponent('Google 語音測試，你好')}`);
    noReferrer(false);
    await new Promise(res => {
      if (!('speechSynthesis' in window)) { out.push('❌ 手機內建語音：這個瀏覽器不支援'); return res(); }
      const u = new SpeechSynthesisUtterance('手機內建語音測試，你好'); u.lang = 'zh-TW';
      let started = false, done = false;
      const fin = msg => { if (done) return; done = true; out.push(msg); show(); res(); };
      u.onstart = () => { started = true; };
      u.onend = () => fin(started ? '✅ 手機內建語音（如果沒聽到，請關閉靜音模式）' : '❌ 手機內建語音');
      u.onerror = e => fin('❌ 手機內建語音：' + (e.error || '失敗'));
      speechSynthesis.speak(u);
      setTimeout(() => { if (!started) fin('❌ 手機內建語音：沒有開始（可能被靜音模式或 iPhone 擋下）'); }, 5000);
    });
    out.push('<br>請把這個畫面截圖給我。'); show();
  })();
}

/* ---------------- 進度條：點任何位置就跳、從任何位置都能拖（iPhone 原本只能拖那顆小圓點） ---------------- */
function tapSeek(input) {
  if (!input || input._tapSeek) return;
  input._tapSeek = true;
  let active = false;
  const set = (t, commit) => {
    const r = input.getBoundingClientRect();
    // 全螢幕轉橫時，進度條在畫面上是直的 → 用上下位置算
    let f = r.height > r.width ? (t.clientY - r.top) / r.height : (t.clientX - r.left) / r.width;
    f = Math.max(0, Math.min(1, f));
    input.value = Math.round(f * (+input.max || 1000));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('touchstart', e => { active = true; set(e.touches[0], false); e.preventDefault(); e.stopPropagation(); }, { passive: false });
  input.addEventListener('touchmove', e => { if (active) { set(e.touches[0], false); e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  input.addEventListener('touchend', e => { if (active) { active = false; set(e.changedTouches[0], true); e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  input.addEventListener('touchcancel', () => { if (active) { active = false; input.dispatchEvent(new Event('change', { bubbles: true })); } });
}
['#rdSeek', '#olSeek', '#seekBar'].forEach(sel => tapSeek($(sel)));

/* ---------------- 啟動 ---------------- */
(async () => {
  try { B.books = (await DB.all('books') || []).sort((a, b) => b.created - a.created); } catch (e) { console.warn(e); }
  renderBooks(); updateSpeakBtn();
})();
