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
function joinLines(lines) {
  let out = '';
  for (const l0 of lines) {
    const l = l0.trim(); if (!l) continue;
    if (!out) { out = l; continue; }
    if (out.endsWith('-') && /[a-z]$/i.test(out.slice(-2, -1))) { out = out.slice(0, -1) + l; continue; }   // 斷字連回去
    out += (CJK.test(out.slice(-1)) && CJK.test(l[0])) ? l : ' ' + l;
  }
  return out;
}
// 把一大段文字切成段落
function toParas(text) {
  text = (text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n');
  let blocks = text.split(/\n\s*\n+/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim());
    if (lines.length <= 1) { out.push(joinLines(lines)); continue; }
    // 沒有空行分段（PDF 常見）：標題自成一段；一行以句號結尾、而且比一般行短，就是段落結尾
    const maxLen = Math.max(...lines.map(l => l.trim().length));
    let cur = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      const isHeading = l.length < 40 && !/[.!?。！？,，;；:：]$/.test(l) && (i + 1 < lines.length) && !/^[a-z]/.test(lines[i + 1].trim());
      if (isHeading) { if (cur.length) out.push(joinLines(cur)); out.push(l); cur = []; continue; }
      cur.push(l);
      const endsSentence = /[.!?。！？」』”"]\s*$/.test(l);
      if (endsSentence && (l.length < maxLen * 0.85 || lines.length < 12)) { out.push(joinLines(cur)); cur = []; }
    }
    if (cur.length) out.push(joinLines(cur));
  }
  return out.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p && !/^[\s\d\-–—_*#=.·•|]+$/.test(p));
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
  if (/[぀-ヿ]/.test(t)) return 'ja';
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
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 5 === 0) toast(`讀取 PDF ${i}/${pdf.numPages} 頁…`, 60000);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let line = '', lastY = null;
    for (const it of tc.items) {
      const y = it.transform ? Math.round(it.transform[5]) : lastY;
      if (lastY !== null && y !== lastY && Math.abs(y - lastY) > 2 && line) { lines.push(line); line = ''; }
      line += it.str; lastY = y;
      if (it.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    lines.push('');   // 換頁
  }
  const text = lines.join('\n');
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
    <button class="sheet-item" data-a="all">🌐 整本翻譯成${esc(langName(B.lang))}並存起來（開車前先做）</button>
    <button class="sheet-item" data-a="rename">✏️ 重新命名</button>
    <button class="sheet-item danger" data-a="del">🗑️ 刪除</button>`, async a => {
    if (a === 'open') openReader(b.id);
    if (a === 'save') saveBook(b, !b.saved);
    if (a === 'all') translateAll(b);
    if (a === 'rename') promptSheet('重新命名', b.title, async n => { b.title = n.trim() || b.title; if (b.saved) await DB.put('books', b); renderBooks(); if (B.book === b) $('#rdTitle').textContent = b.title; });
    if (a === 'del') openSheet(`<h4>確定刪除「${esc(b.title)}」？</h4><button class="sheet-item danger" data-a="y">刪除</button><button class="sheet-item" data-a="n">取消</button>`, x => { if (x === 'y') deleteBook(b); });
  });
}

/* ---------------- 翻譯 ---------------- */
async function gtx(lines, tl) {
  const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`, {
    method: 'POST', body: new URLSearchParams({ q: lines.join('\n') }),
  });
  if (!r.ok) throw new Error('翻譯服務回應 ' + r.status);
  const j = await r.json();
  const text = (j[0] || []).map(x => x && x[0] || '').join('');
  return { lines: text.split('\n'), src: j[2] };
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
  if (serverReady()) {
    try {
      const r = await sFetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: lines, tl }) });
      if (r.ok) { const j = await r.json(); if (j.lines?.length === lines.length) return j; }
    } catch {}
  }
  try {
    const j = await gtx(lines, tl);
    if (j.lines.length === lines.length) return j;
    // 行數對不上：一行一行翻
    const out = [];
    for (const l of lines) out.push(l.trim() ? (await gtx([l], tl)).lines.join(' ') : '');
    return { lines: out, src: j.src };
  } catch (e) { console.warn('gtx', e); }
  return myMemory(lines, tl, sl);
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
      if (j.src && j.src !== 'auto' && !b.srcLangSure) { b.srcLang = normLang(j.src); b.srcLangSure = true; if (b.saved) DB.put('books', b).catch(() => {}); }
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
function updateProg() {
  const b = B.book; if (!b) return;
  $('#rdProg').style.width = (b.paras.length > 1 ? b.pos.p / (b.paras.length - 1) * 100 : 0) + '%';
}
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
  if (TTS.on) TTS.start(B.book, pos);
  else { markReading(pos); toast('按 🔊 從這一句開始朗讀', 1800); }
});
$('#rdBack').onclick = () => closeReader();
$('#rdFont').onclick = () => { B.font = B.font >= 26 ? 15 : B.font + 2; LS.set('bookFont', B.font); applyReaderUI(); };
$('#rdMore').onclick = () => B.book && bookMenu(B.book);
$('#rdLang').onchange = () => { B.lang = $('#rdLang').value; LS.set('bookLang', B.lang); renderReader(true); if (TTS.on) TTS.restart(); };
$('#rdMode').onclick = e => {
  const x = e.target.closest('button'); if (!x) return;
  B.mode = x.dataset.m; LS.set('bookMode', B.mode); applyReaderUI(); renderReader(true); if (TTS.on) TTS.restart();
};
$('#rdRead').onchange = () => { B.read = $('#rdRead').value; LS.set('bookRead', B.read); if (TTS.on) TTS.restart(); };
$('#rdRate').onclick = () => {
  const rates = [0.75, 1, 1.25, 1.5, 2];
  B.rate = rates[(rates.indexOf(B.rate) + 1) % rates.length] || 1; LS.set('bookRate', B.rate);
  TTS.el.playbackRate = B.rate; applyReaderUI();
};
function markReading(pos) {
  $$('#rdBody .reading').forEach(x => x.classList.remove('reading'));
  if (!pos) return;
  const el = $(`#rdBody .bp[data-p="${pos.p}"] [data-s="${pos.s}"]`);
  el?.classList.add('reading');
}

/* ---------------- 朗讀（用 <audio> 播放，鎖螢幕／開車也能繼續） ---------------- */
const TTS = {
  el: $('#ttsEl'), on: false, playing: false, book: null, pos: null, phase: 0, token: 0, synthMode: false,
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
    this.setSession(); this.loop(++this.token);
    updateSpeakBtn(); renderBooks();
  },
  restart() { if (this.on && this.book) this.start(this.book, this.pos); },
  stop() {
    this.on = false; this.playing = false; this.token++;
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
      for (let i = this.phase; i < parts.length; i++) {
        if (!this.on || tok !== this.token) return;
        this.phase = i;
        let text = ss[p][s], lang = b.srcLang;
        if (parts[i] === 't') {
          let tr = B.trans.get(tKey(b, B.lang, p));
          if (!tr) { try { await ensureTrans(b, B.lang, p, p + 4); } catch {} tr = B.trans.get(tKey(b, B.lang, p)); }
          if (!this.on || tok !== this.token) return;
          if (tr && tr[s]) { text = tr[s]; lang = B.lang; }
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
    if (serverReady()) return `${getServer()}/api/tts?key=${encodeURIComponent((serverKey.value || '').trim())}&lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
    return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
  },
  async speak(text, lang, tok) {
    if (!text || !text.trim()) return;
    const parts = this.chunks(text, serverReady() ? 900 : 180);
    for (const c of parts) {
      if (!this.on || tok !== this.token) return;
      const ok = await this.playChunk(c, lang, tok);
      if (!ok && this.on && tok === this.token) await this.synth(c, lang, tok);
    }
  },
  playChunk(text, lang, tok) {
    return new Promise(res => {
      const el = this.el;
      let done = false;
      const fin = ok => { if (done) return; done = true; el.onended = el.onerror = null; clearTimeout(t); res(ok); };
      const t = setTimeout(() => fin(false), 20000);   // 20 秒沒反應就換方法
      el.onended = () => fin(true);
      el.onerror = () => fin(false);
      this.synthMode = false;
      el.src = this.url(text, lang);
      el.playbackRate = B.rate;
      this.playing = true; updateSpeakBtn();
      el.play().then(() => { clearTimeout(t); }).catch(() => fin(false));
    });
  },
  // 線上語音失敗時：用手機內建語音（這個在鎖螢幕時可能會停）
  synth(text, lang, tok) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      if (!this.synthWarned) { this.synthWarned = true; toast('線上語音連不上，改用手機內建語音（鎖螢幕可能會停）', 4000); }
      this.synthMode = true;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'zh-TW' ? 'zh-TW' : lang === 'zh-CN' ? 'zh-CN' : lang;
      u.rate = B.rate;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  },
  setSession() {
    if (!('mediaSession' in navigator) || !this.book) return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: this.book.title, artist: 'myTube 電子書', album: langName(B.lang) }); } catch {}
    const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    set('play', () => this.resume()); set('pause', () => this.pause());
    set('previoustrack', () => this.step(-1)); set('nexttrack', () => this.step(1));
    set('seekbackward', () => this.step(-1)); set('seekforward', () => this.step(1));
    set('seekto', null);
  },
};
TTS.el.addEventListener('play', () => { TTS.playing = true; updateSpeakBtn(); });
TTS.el.addEventListener('pause', () => { if (!TTS.el.ended) { TTS.playing = false; updateSpeakBtn(); } });
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
  if (TTS.on && TTS.book === b) { TTS.playing ? TTS.pause() : TTS.resume(); return; }
  TTS.start(b, b.pos || { p: 0, s: 0 });
};
$('#rdPrev').onclick = () => (TTS.on ? TTS.step(-1) : null);
$('#rdNext').onclick = () => (TTS.on ? TTS.step(1) : null);

/* ---------------- 啟動 ---------------- */
(async () => {
  try { B.books = (await DB.all('books') || []).sort((a, b) => b.created - a.created); } catch (e) { console.warn(e); }
  renderBooks(); updateSpeakBtn();
})();
