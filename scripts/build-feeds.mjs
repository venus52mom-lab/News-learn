// 由 GitHub Actions 每 2 小時執行：在伺服器端抓所有內建國家／分類的新聞標題，
// 輸出成 JSON，推到 data 分支（每次覆蓋，只保留最新一份，不會越存越多）。
import fs from 'fs';
import vm from 'vm';

const code = fs.readFileSync(new URL('../common.js', import.meta.url), 'utf8');
const ctx = {
  console, fetch, URL, URLSearchParams, Intl, setTimeout, clearTimeout, Promise, AbortController,
  encodeURIComponent, decodeURIComponent, atob, btoa,
  document: {}, window: {}, navigator: {},
  localStorage: { getItem(){ return null; }, setItem(){} },
  matchMedia: () => ({ matches: false, addEventListener(){} }),
  speechSynthesis: { getVoices(){ return []; } }
};
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__api = {BUILTIN, CATS, sourcesFor, cleanItems, SRC_NAME};', ctx);
const { BUILTIN, CATS, sourcesFor, cleanItems, SRC_NAME } = ctx.__api;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };
function parseRss(xml){
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => {
    const it = m[0];
    return { title: tag(it, 'title'), link: tag(it, 'link'), date: tag(it, 'pubDate') || tag(it, 'dc:date'),
             source: tag(it, 'News:Source') || tag(it, 'source') };
  }).filter(x => x.title);
}
async function get(url){
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try{
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }, signal: ac.signal, redirect: 'follow' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

const jobs = [];
for(const [lang, L] of Object.entries(BUILTIN))
  for(const rk of Object.keys(L.regions))
    for(const cat of Object.keys(CATS)) jobs.push({ lang, rk, cat });

fs.mkdirSync('out/feeds', { recursive: true });
const report = {};
let i = 0;
async function worker(){
  while(i < jobs.length){
    const { lang, rk, cat } = jobs[i++];
    const key = `${lang}-${rk}-${cat}`;
    let ok = null, tried = [];
    let urls = [];
    try{ urls = await sourcesFor(lang, rk, cat); }catch(e){ tried.push('sourcesFor: ' + e.message); }
    for(const url of urls){
      try{
        const items = cleanItems(parseRss(await get(url)), SRC_NAME(url), 20);
        if(items.length >= 3){ ok = { url, items }; break; }
        tried.push(`${url} → ${items.length} 則`);
      }catch(e){ tried.push(`${url} → ${e.message}`); }
    }
    if(ok){
      fs.writeFileSync(`out/feeds/${key}.json`, JSON.stringify({ updated: new Date().toISOString(), source: ok.url, items: ok.items }));
      report[key] = { n: ok.items.length, from: ok.url.split('/')[2] };
    } else report[key] = { n: 0, tried };
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
const good = Object.values(report).filter(r => r.n).length;
fs.writeFileSync('out/index.json', JSON.stringify({ updated: new Date().toISOString(), ok: good, total: jobs.length, report }, null, 1));
console.log(`完成：${good} / ${jobs.length} 個成功`);
for(const [k, r] of Object.entries(report)) if(!r.n) console.log('失敗', k, r.tried?.join(' | '));
