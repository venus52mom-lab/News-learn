"use strict";
/* ===================== 項目 ===================== */
const FXN = {
  USD:["美金","🇺🇸"],HKD:["港幣","🇭🇰"],GBP:["英鎊","🇬🇧"],AUD:["澳幣","🇦🇺"],CAD:["加拿大幣","🇨🇦"],
  SGD:["新加坡幣","🇸🇬"],CHF:["瑞士法郎","🇨🇭"],JPY:["日圓","🇯🇵"],ZAR:["南非幣","🇿🇦"],SEK:["瑞典幣","🇸🇪"],
  NZD:["紐元","🇳🇿"],THB:["泰銖","🇹🇭"],PHP:["菲國比索","🇵🇭"],IDR:["印尼盾","🇮🇩"],EUR:["歐元","🇪🇺"],
  KRW:["韓元","🇰🇷"],VND:["越南盾","🇻🇳"],MYR:["馬來幣","🇲🇾"],CNY:["人民幣","🇨🇳"]
};
// kind: fx 銀行牌價｜metal 台幣/公克｜txf 台指期｜mkt 股市・期貨・加密（cn = 鉅亨網代號，可手機即時）
const ITEMS = {};
for (const [k, [n, f]] of Object.entries(FXN)) ITEMS[k] = {name:k, sub:n, flag:f, kind:"fx", group:"外匯"};
Object.assign(ITEMS, {
  XAU:{name:"黃金", sub:"台幣／公克・國際價", flag:"🥇", kind:"metal", group:"黃金白銀"},
  XAG:{name:"白銀", sub:"台幣／公克・國際價", flag:"🥈", kind:"metal", group:"黃金白銀"},
  TXF:{name:"台指期", sub:"全日盤", flag:"🇹🇼", kind:"txf", cn:"TWF:TXF:FUTURES", group:"期貨"},
  DJI:{name:"Dow Jones", sub:"道瓊工業指數", kind:"mkt", cn:"GI:DJI:INDEX", group:"股市"},
  TWII:{name:"加權指數", sub:"台灣加權指數", kind:"mkt", cn:"TWS:TSE01:INDEX", group:"股市"},
  SPX:{name:"S&P 500", sub:"標普 500 指數", kind:"mkt", cn:"GI:INX:INDEX", group:"股市"},
  IXIC:{name:"NASDAQ", sub:"那斯達克綜合指數", kind:"mkt", cn:"GI:IXIC:INDEX", group:"股市"},
  SOX:{name:"費城半導體", sub:"PHLX Semiconductor", kind:"mkt", cn:"GI:SOX:INDEX", group:"股市"},
  N225:{name:"日經 225", sub:"Nikkei 225", kind:"mkt", group:"股市"},
  HSI:{name:"恆生指數", sub:"Hang Seng Index", kind:"mkt", cn:"GI:HSI:INDEX", group:"股市"},
  CSI300:{name:"滬深 300", sub:"CSI 300 Index", kind:"mkt", group:"股市"},
  KOSPI:{name:"KOSPI", sub:"韓國綜合指數", kind:"mkt", cn:"GI:KOSPI:INDEX", group:"股市"},
  EU500:{name:"歐洲 500", sub:"Euronext Europe 500", kind:"mkt", group:"股市"},
  VIX:{name:"VIX", sub:"恐慌指數", kind:"mkt", group:"股市"},
  UTEN:{name:"UTEN", sub:"美國 10 年公債 ETF", kind:"mkt", cn:"USS:UTEN:STOCK", group:"股市"},
  DXY:{name:"美元指數", sub:"US Dollar Index", kind:"mkt", cn:"GI:DXY:INDEX", group:"外匯"},
  BTC:{name:"比特幣", sub:"BTC-USD", kind:"mkt", group:"外匯"},
  NQ:{name:"那斯達克期貨", sub:"NQ=F", kind:"mkt", group:"期貨"},
  Z3N:{name:"3 年美債期貨", sub:"Z3N=F", kind:"mkt", group:"期貨"},
  GC:{name:"紐約金", sub:"GC=F・美元／盎司", kind:"mkt", group:"黃金白銀"},
  SI:{name:"紐約銀", sub:"SI=F・美元／盎司", kind:"mkt", group:"黃金白銀"},
});
const K = id => (ITEMS[id] || {}).kind;
const LIVE = id => K(id) === "mkt" || K(id) === "txf";
const RATE_NAME = {cb:"現金買入",cs:"現金賣出",sb:"即期買入",ss:"即期賣出"};
const COL = {cb:1,cs:2,sb:3,ss:4};
const FALLBACK = {cs:["cs","ss"],ss:["ss","cs"],cb:["cb","sb"],sb:["sb","cb"]};
const LCOL = ["#ff453a","#ff9f0a","#30d158","#ffd60a","#0a84ff","#bf5af2"];
const LETTER = "ABCDEF";
const MAX_LISTS = 6;

/* ===================== 設定（存在這支手機） ===================== */
const DEFAULT_LISTS = [
  {n:"股市", items:["DJI","TWII","SPX","EU500","N225","UTEN","HSI","VIX","CSI300","KOSPI","IXIC","SOX"]},
  {n:"外匯", items:["JPY","USD","AUD","THB","KRW","DXY","BTC"]},
  {n:"期貨", items:["TXF","NQ","Z3N"]},
  {n:"金銀", items:["XAU","XAG","GC","SI"]},
];
const DEF = {lists: DEFAULT_LISTS, cur:0, rate:"cs", dir:"n", color:"tw", data:"", badge:"d", spark:"3M", v:2};
const RNAME = {"1D":"當日","3M":"3個月","1Y":"1年","3Y":"3年","ALL":"全部"};
let S = JSON.parse(JSON.stringify(DEF));
try {
  const old = JSON.parse(localStorage.getItem("fx-settings") || "{}");
  if (old.v === 2) S = {...S, ...old};
  else { for (const k of ["rate","dir","color","data","badge"]) if (old[k]) S[k] = old[k]; }   // 舊版：保留顯示設定，換成新的預設列表
} catch (e) {}
if (!S.lists.length) S.lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
S.cur = Math.min(S.cur || 0, S.lists.length - 1);
const save = () => { try { localStorage.setItem("fx-settings", JSON.stringify(S)); } catch (e) {} };
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
const LIST = () => S.lists[S.cur];
const dataBase = () => { let b = (S.data||"").trim() || "data/"; return b.endsWith("/") ? b : b + "/"; };

/* ===================== 資料 ===================== */
let RECENT = null;          // 外匯、金銀（recent.json）
const HIST = {};            // 外匯、金銀完整歷史
const MK = {};              // 市場項目：{quote, daily:[[d,v]], full:bool, intra:[[key,v]]}
let MARKETS = null;

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const pad2 = n => String(n).padStart(2, "0");

function pick(row) { for (const k of FALLBACK[S.rate]) { const v = row[COL[k]]; if (v) return v; } return null; }
function usedKey(rows) { const l = rows && rows[rows.length-1]; if (!l) return S.rate; for (const k of FALLBACK[S.rate]) if (l[COL[k]]) return k; return S.rate; }
const inv = id => S.dir !== "n" && (K(id) === "fx" || K(id) === "metal");
function fmtFor(id, v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v), k = K(id);
  let d;
  if (k === "txf") d = 0;
  else if (k === "mkt") d = a >= 1000 ? 2 : a >= 10 ? 2 : 3;
  else if (!inv(id)) d = a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : 6;
  else d = a >= 10000 ? 0 : a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 3 : 4;
  return v.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
}
const pct = (a, b) => (b - a) / a * 100;
const ymd = s => `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}` + (s.length >= 12 ? ` ${s.slice(8,10)}:${s.slice(10,12)}` : "");
function cutoff(range) {
  if (range === "ALL" || range === "1D") return "0";
  const d = new Date();
  if (range === "3M") d.setMonth(d.getMonth()-3);
  if (range === "1Y") d.setFullYear(d.getFullYear()-1);
  if (range === "3Y") d.setFullYear(d.getFullYear()-3);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
}
const tpeKey = ts => { const d = new Date(ts*1000 + 8*3600*1000).toISOString(); return d.slice(0,10).replace(/-/g,"") + d.slice(11,13) + d.slice(14,16); };
const tpeHM = ts => { const d = new Date(ts*1000 + 8*3600*1000); return `${d.getUTCMonth()+1}/${d.getUTCDate()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };

/** 日線：[[YYYYMMDD, 值]] */
function daily(id) {
  const k = K(id);
  if (k === "fx" || k === "metal") {
    const rows = HIST[id] || (RECENT && RECENT.rates[id]) || [];
    const out = [];
    for (const r of rows) { let v = pick(r); if (v) { if (inv(id)) v = 1000 / v; out.push([r[0], v]); } }
    return out;
  }
  const m = MK[id]; if (!m || !m.daily) return [];
  const pts = m.daily.slice();
  if (m.quote && m.quote.last && pts.length) {   // 用即時價蓋掉最後一根
    if (k === "txf") {
      const d = tradeDay(m.quote.time), i = pts.findIndex(p => p[0] === d);
      if (i >= 0) pts[i] = [d, m.quote.last]; else { pts.push([d, m.quote.last]); pts.sort((a,b) => a[0] < b[0] ? -1 : 1); }
    } else if (Date.now()/1000 - (m.quote.time||0) < 36*3600) pts[pts.length-1] = [pts[pts.length-1][0], m.quote.last];
  }
  return pts;
}
/** 最新值與漲跌 */
function info(id) {
  const pts = daily(id), last = pts[pts.length-1], prev = pts[pts.length-2];
  const q = MK[id] && MK[id].quote;
  if (LIVE(id) && q && q.last != null) {
    const chg = q.chg != null ? +q.chg : (q.prev ? q.last - q.prev : prev ? q.last - prev[1] : null);
    const p = q.pct != null ? +q.pct : chg != null && (q.prev || prev) ? chg / (q.prev || prev[1]) * 100 : null;
    return {last:q.last, chg, pct:p, pts};
  }
  if (!last) return {last:null, chg:null, pct:null, pts};
  return {last:last[1], chg: prev ? last[1]-prev[1] : null, pct: prev ? pct(prev[1], last[1]) : null, pts};
}
function descFor(id) {
  const it = ITEMS[id], k = it.kind;
  if (k === "fx") {
    const rows = (RECENT && RECENT.rates[id]) || [], l = rows[rows.length-1] || [];
    return it.sub + (l[5] ? `・${l[5]}` : "") + (usedKey(rows) !== S.rate ? `・${RATE_NAME[usedKey(rows)]}` : "");
  }
  if (k === "txf") return futDesc();
  if (k === "mkt") { const q = MK[id] && MK[id].quote; return it.sub + (q && q.time ? `・${tpeHM(q.time).split(" ")[1]}` : ""); }
  return it.sub;
}

/* ===================== 畫圖 ===================== */
function cssVar(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
function setupCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width*dpr)); cv.height = Math.max(1, Math.round(r.height*dpr));
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  return [ctx, r.width, r.height];
}
function thin(pts, maxN) {
  if (pts.some(p => p[1] == null)) {   // 分段各自縮減，保留中間的間隔
    const segs = [[]]; for (const p of pts) { if (p[1] == null) { if (segs[segs.length-1].length) segs.push([]); segs[segs.length-1].gap = (segs[segs.length-1].gap || 0) + 1; } else segs[segs.length-1].push(p); }
    const n = pts.length, out = [];
    segs.forEach((g, i) => { if (i) for (let k = 0; k < (g.gap || 1); k++) out.push([g[0] ? g[0][0] : "", null]); out.push(...thin(g, Math.max(4, Math.round(maxN * g.length / n)))); });
    return out;
  }
  if (pts.length <= maxN) return pts;
  const out = [], step = pts.length / (maxN/2);
  for (let i = 0; i < pts.length; i += step) {
    const b = pts.slice(Math.floor(i), Math.floor(i+step)); if (!b.length) continue;
    let lo = b[0], hi = b[0];
    for (const p of b) { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; }
    if (lo === hi) out.push(lo); else if (lo[0] < hi[0]) out.push(lo, hi); else out.push(hi, lo);
  }
  const last = pts[pts.length-1]; if (out[out.length-1] !== last) out.push(last);
  return out;
}
function drawLine(cv, pts, opt = {}) {
  const [ctx, W, H] = setupCanvas(cv);
  ctx.clearRect(0,0,W,H);
  if (pts.length < 2) return null;
  const padT = opt.padT ?? 4, padB = opt.padB ?? 4, padR = opt.padR ?? 0;
  const vals = pts.map(p => p[1]).filter(v => v != null), base = opt.base ?? vals[0];
  let lo = Math.min(...vals, opt.baseline ? base : Infinity), hi = Math.max(...vals, opt.baseline ? base : -Infinity);
  if (hi === lo) { hi += hi*0.001 || 1; lo -= lo*0.001 || 1; }
  const n = pts.length;
  const X = i => i/(n-1)*(W-padR), Y = v => padT + (hi - v)/(hi - lo)*(H - padT - padB);
  const lastV = vals[vals.length-1], color = cssVar(lastV === base ? "--flat" : lastV > base ? "--up" : "--down");
  const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0, color+"55"); g.addColorStop(1, color+"00");
  const segs = []; let cur = [];
  pts.forEach((p, i) => { if (p[1] == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
  if (cur.length) segs.push(cur);
  for (const sg of segs) {   // 每段各自填色
    ctx.beginPath(); sg.forEach((i, j) => j ? ctx.lineTo(X(i),Y(pts[i][1])) : ctx.moveTo(X(i),Y(pts[i][1])));
    ctx.lineTo(X(sg[sg.length-1]),H); ctx.lineTo(X(sg[0]),H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  }
  if (opt.baseline) { ctx.setLineDash([3,3]); ctx.strokeStyle = color+"aa"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,Y(base)); ctx.lineTo(W-padR,Y(base)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = color; ctx.lineWidth = opt.lw || 1.6; ctx.lineJoin = "round";
  for (const sg of segs) { ctx.beginPath(); sg.forEach((i, j) => j ? ctx.lineTo(X(i),Y(pts[i][1])) : ctx.moveTo(X(i),Y(pts[i][1]))); ctx.stroke(); }
  if (segs.length > 1) {   // 分段之間畫虛線，標上「日盤／夜盤」
    ctx.setLineDash([3,3]); ctx.strokeStyle = "#636366"; ctx.lineWidth = 1;
    for (let k = 1; k < segs.length; k++) { const x = (X(segs[k-1][segs[k-1].length-1]) + X(segs[k][0])) / 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.setLineDash([]);
    if (opt.segLabels) { ctx.fillStyle = "#8e8e93"; ctx.font = `${opt.axis ? 12 : 9}px -apple-system,sans-serif`; ctx.textAlign = "left";
      segs.forEach(sg => { const h = +String(pts[sg[0]][0]).slice(8,10); ctx.fillText(h >= 15 || h < 6 ? "夜盤" : "日盤", X(sg[0]) + 3, opt.axis ? 12 : 9); }); }
  }
  if (opt.marks && opt.marks.length) {
    ctx.setLineDash([2,4]); ctx.strokeStyle = "#8e8e93"; ctx.lineWidth = 1;
    for (const m of opt.marks) { const i = pts.findIndex(p => p[0] >= m); if (i <= 0) continue;
      ctx.beginPath(); ctx.moveTo(X(i), 0); ctx.lineTo(X(i), H); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if (opt.axis) {
    ctx.fillStyle = "#8e8e93"; ctx.font = "11px -apple-system,sans-serif"; ctx.textAlign = "left";
    for (let k = 0; k <= 3; k++) {
      const v = hi - (hi-lo)*k/3, y = Y(v);
      ctx.fillText(fmtFor(opt.id, v), W-padR+4, Math.min(H-2, Math.max(10, y+4)));
      ctx.strokeStyle = "#2c2c2e"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W-padR,y); ctx.stroke();
    }
  }
  return {X, Y, n, color, W, H};
}
const realPts = pts => pts.filter(p => p[1] != null);

/* ===================== 首頁 ===================== */
let EDITING = false;
function renderTabs() {
  const bar = $("#tabs"); bar.innerHTML = "";
  S.lists.forEach((l, i) => {
    const b = el("button", "tab" + (i === S.cur ? " on" : ""), `<i style="background:${LCOL[i]}">${LETTER[i]}</i>${l.n}`);
    b.onclick = () => { S.cur = i; save(); EDITING = false; renderHome(); refreshLive(); window.scrollTo(0, 0); };
    bar.append(b);
  });
  if (S.lists.length < MAX_LISTS) { const b = el("button", "tab add", "＋"); b.onclick = newList; bar.append(b); }
}
function renderHome() {
  document.body.classList.toggle("us", S.color === "us");
  document.body.classList.toggle("editing", EDITING);
  const now = new Date();
  $("#today").textContent = `${now.getMonth()+1}月${now.getDate()}日`;
  renderTabs();
  const L = LIST(), hasFx = L.items.some(id => K(id) === "fx");
  $("#rateLabel").innerHTML = `<i class="dot" style="background:${LCOL[S.cur]}"></i>${L.n}` +
    (hasFx ? `<small>銀行牌告・${RATE_NAME[S.rate]}${S.dir === "n" ? "" : "・每千台幣"}</small>` : "");
  $("#updated").textContent = hasFx ? (RECENT ? `更新 ${RECENT.updated.slice(5)}` : "") : (MARKETS ? `更新 ${MARKETS.updated.slice(5)}` : "");
  $("#btnMenu").hidden = EDITING; $("#btnDone").hidden = !EDITING;
  const ul = $("#list"); ul.innerHTML = "";
  if (!L.items.length && !EDITING) ul.append(el("li","empty","這個列表還是空的。<br>按右上「•••」→「編輯觀察列表」加入項目。"));
  const c3 = cutoff(S.spark === "1D" ? "3M" : S.spark);
  for (const id of L.items) {
    const it = ITEMS[id]; if (!it) continue;
    const {last, chg, pct: p, pts} = info(id);
    const useIntra = S.spark === "1D" && LIVE(id) && MK[id] && MK[id].intraS;
    const spark = useIntra ? MK[id].intraS : S.spark === "1D" ? pts.slice(-6) : pts.filter(x => x[0] >= c3);
    const li = el("li", "wrap");
    li.dataset.id = id;
    li.innerHTML = `<div class="acts"><button class="a-list"><b>☰</b>列表</button><button class="a-del"><b>🗑</b>移除</button></div>
      <div class="row"><button class="e-rm" aria-label="移除">−</button>
        <div class="nm"><div class="name">${it.flag ? `<span class="flag">${it.flag}</span>` : ""}${it.name}</div><div class="desc">${descFor(id)}</div></div>
        <canvas></canvas>
        <div class="right"><div class="price">${fmtFor(id, last)}</div><div class="badge"></div></div>
        <span class="drag">☰</span></div>`;
    const b = li.querySelector(".badge");
    let ch = null, txt = "—";
    if (S.badge === "d" && p != null) { ch = p; txt = (ch>0?"+":"") + ch.toFixed(2) + "%"; }
    if (S.badge === "abs" && chg != null) { ch = chg; txt = (ch>0?"+":"") + fmtFor(id, ch); }
    if (S.badge === "p3") { const rg = S.spark === "1D" ? "3M" : S.spark, q = pts.filter(x => x[0] >= cutoff(rg)); if (q.length > 1 && last) { ch = pct(q[0][1], last); txt = rg + " " + (ch>0?"+":"") + ch.toFixed(1) + "%"; } }
    b.textContent = txt;
    b.classList.add(ch == null || Math.abs(ch) < 1e-9 ? "flat" : ch > 0 ? "up" : "down");
    b.addEventListener("click", e => { if (EDITING) return; e.stopPropagation(); S.badge = {d:"p3",p3:"abs",abs:"d"}[S.badge]; save(); renderHome(); });
    const row = li.querySelector(".row");
    row.addEventListener("click", () => { if (EDITING) return; if (li.classList.contains("open")) { closeSwipes(); return; } if (document.querySelector(".wrap.open")) { closeSwipes(); return; } openDetail(id); });
    li.querySelector(".e-rm").onclick = e => { e.stopPropagation(); removeItem(id); };
    li.querySelector(".a-del").onclick = e => { e.stopPropagation(); removeItem(id); };
    li.querySelector(".a-list").onclick = e => { e.stopPropagation(); closeSwipes(); openListPicker(id); };
    swipeify(li);
    dragify(li, li.querySelector(".drag"), ul);
    ul.append(li);
    const base = useIntra && MK[id].quote && MK[id].quote.prev ? MK[id].quote.prev : undefined;
    requestAnimationFrame(() => drawLine(row.querySelector("canvas"), spark, {baseline:true, lw:1.4, base, segLabels:false}));
  }
  renderAdd();
  if ((S.spark === "1Y" || S.spark === "3Y") && !renderHome.loading) {
    const need = L.items.filter(id => (K(id) === "fx" || K(id) === "metal") ? !HIST[id] : K(id) === "mkt" ? !(MK[id] && MK[id].full) : false);
    if (need.length) { renderHome.loading = true; Promise.allSettled(need.map(loadHist)).then(() => { renderHome.loading = false; renderHome(); }); }
  }
  $("#sparkSeg") && document.querySelectorAll("#sparkSeg button").forEach(b => b.classList.toggle("on", b.dataset.v === S.spark));
  const foot = $(".foot");
  foot.textContent = hasFx ? "外幣今天的牌價來自玉山銀行（玉山沒有的幣別用其他銀行，名稱標在幣別下方）；2026/6/26 以前是臺灣銀行牌價。向左滑可移除或加到其他列表；點右側數字可切換顯示。"
                           : "向左滑可移除或加到其他列表；點右側數字可切換顯示。有「●」的是手機即時報價，其他約每小時更新。";
  foot.hidden = EDITING;
}
function renderAdd() {   // 編輯模式：下方列出可以加入的項目
  const box = $("#addBox"); box.hidden = !EDITING; if (!EDITING) return;
  box.innerHTML = `<div class="addhead"><button id="renameList">重新命名「${LIST().n}」</button>${S.lists.length > 1 ? `<button id="delList" class="danger">刪除這個列表</button>` : ""}</div>`;
  const groups = {};
  for (const [id, it] of Object.entries(ITEMS)) if (!LIST().items.includes(id)) (groups[it.group] = groups[it.group] || []).push(id);
  for (const g of ["股市","外匯","期貨","黃金白銀"]) {
    if (!groups[g]) continue;
    box.append(el("div", "section-title", `可加入：${g}`));
    const ul = el("ul", "elist");
    for (const id of groups[g]) {
      const it = ITEMS[id];
      const li = el("li", "", `<button class="ebtn add">＋</button><div class="n">${it.flag || ""} ${it.name}<small>${it.sub}</small></div>`);
      li.onclick = () => { LIST().items.push(id); save(); renderHome(); refreshLive(); };
      ul.append(li);
    }
    box.append(ul);
  }
  $("#renameList").onclick = () => { const n = prompt("列表名稱", LIST().n); if (n && n.trim()) { LIST().n = n.trim().slice(0, 8); save(); renderHome(); } };
  const d = $("#delList"); if (d) d.onclick = () => {
    if (!confirm(`確定刪除「${LIST().n}」？`)) return;
    S.lists.splice(S.cur, 1); S.cur = Math.max(0, S.cur - 1); save(); renderHome(); };
}
function removeItem(id) { LIST().items = LIST().items.filter(x => x !== id); save(); renderHome(); }
function newList() {
  if (S.lists.length >= MAX_LISTS) return;
  const n = prompt(`新觀察列表名稱（${LETTER[S.lists.length]}）`, `列表 ${LETTER[S.lists.length]}`);
  if (!n || !n.trim()) return;
  S.lists.push({n: n.trim().slice(0, 8), items: []}); S.cur = S.lists.length - 1; EDITING = true; save(); renderHome();
}

/* 向左滑：列表／移除 */
function closeSwipes(except) { for (const w of document.querySelectorAll(".wrap.open")) if (w !== except) { w.classList.remove("open"); w.querySelector(".row").style.transform = ""; } }
function swipeify(li) {
  const row = li.querySelector(".row"); const W = 150;
  let x0, y0, dx, active, base;
  row.addEventListener("touchstart", e => { if (EDITING) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; active = null; base = li.classList.contains("open") ? -W : 0; }, {passive:true});
  row.addEventListener("touchmove", e => {
    if (EDITING || x0 == null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (active === null) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; active = Math.abs(mx) > Math.abs(my); if (active) closeSwipes(li); }
    if (!active) return;
    e.preventDefault(); dx = mx;
    row.style.transition = "none"; row.style.transform = `translateX(${Math.min(0, Math.max(-W - 40, base + dx))}px)`;
  }, {passive:false});
  row.addEventListener("touchend", () => {
    if (!active) { x0 = null; return; }
    row.style.transition = ""; const open = base + dx < -W/2;
    li.classList.toggle("open", open); row.style.transform = open ? `translateX(${-W}px)` : "";
    x0 = null;
  });
}
/* 編輯模式拖曳排序 */
function dragify(li, handle, ul) {
  handle.addEventListener("pointerdown", e => {
    if (!EDITING) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId); li.classList.add("dragging");
    const move = ev => {
      const sibs = [...ul.children].filter(x => x !== li && x.dataset.id);
      const after = sibs.find(s => { const r = s.getBoundingClientRect(); return ev.clientY < r.top + r.height/2; });
      ul.insertBefore(li, after || null);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      li.classList.remove("dragging"); LIST().items = [...ul.children].map(x => x.dataset.id).filter(Boolean); save();
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  });
}
/* 加到觀察列表 */
function openListPicker(id) {
  const box = $("#pickBody"); box.innerHTML = "";
  $("#pickTitle").textContent = `把「${ITEMS[id].name}」加到…`;
  S.lists.forEach((l, i) => {
    const on = l.items.includes(id);
    const b = el("button", "pick" + (on ? " on" : ""), `<i style="background:${LCOL[i]}">${LETTER[i]}</i><span>${l.n}</span><em>${on ? "✓" : ""}</em>`);
    b.onclick = () => { if (on) l.items = l.items.filter(x => x !== id); else l.items.push(id); save(); openListPicker(id); renderHome(); };
    box.append(b);
  });
  if (S.lists.length < MAX_LISTS) { const b = el("button", "pick", `<i style="background:#48484a">＋</i><span>新增觀察列表</span>`);
    b.onclick = () => { closeSheets(); const n = prompt("新觀察列表名稱", `列表 ${LETTER[S.lists.length]}`); if (n && n.trim()) { S.lists.push({n:n.trim().slice(0,8), items:[id]}); save(); renderHome(); } };
    box.append(b); }
  openSheet("#picker");
}

/* ===================== 讀資料 ===================== */
async function getJSON(u, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, {signal:c.signal, cache:"no-store"}); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function loadRecent() {
  try { RECENT = await getJSON(dataBase() + "recent.json?t=" + Date.now()); } catch (e) {}
  renderHome();
}
async function loadMarkets() {
  try {
    MARKETS = await getJSON(dataBase() + "markets.json?t=" + Date.now());
    for (const [id, m] of Object.entries(MARKETS.items || {})) {
      const cur = MK[id] || (MK[id] = {});
      if (!cur.full) cur.daily = m.daily;
      if (!cur.quote || cur.quote.src !== "鉅亨網") cur.quote = m.quote;
      if (!cur.intraLive && m.intra && m.intra.length) { cur.intra = m.intra.map(([t, c]) => [tpeKey(t), c]); cur.intraS = cur.intra; }
    }
  } catch (e) {}
  renderHome();
}
async function loadHist(id) {
  const k = K(id);
  if (k === "fx" || k === "metal") {
    if (HIST[id]) return;
    const rows = await getJSON(dataBase() + `hist/${id}.json`, 15000);
    const rec = (RECENT && RECENT.rates[id]) || [], lastD = rows.length ? rows[rows.length-1][0] : "0";
    for (const x of rec) if (x[0] > lastD) rows.push(x);
    HIST[id] = rows; return;
  }
  if (k === "mkt") {
    const m = MK[id] || (MK[id] = {}); if (m.full) return;
    try { m.daily = await getJSON(dataBase() + `mkt/${id}.json`, 15000); m.full = true; }
    catch (e) { if (ITEMS[id].cn) { m.daily = await cnyesDaily(ITEMS[id].cn, 0); m.full = true; } }
  }
}

/* ===================== 鉅亨網（手機直接即時） ===================== */
const CNYES = "https://ws.api.cnyes.com/ws/api/v1";
const utcDay = ts => new Date(ts*1000).toISOString().slice(0,10).replace(/-/g,"");
function tradeDay(ts) {   // 台指期：15:00 以後的夜盤算隔天
  const t = new Date(ts*1000 + 8*3600*1000); if (t.getUTCHours() >= 15) t.setUTCDate(t.getUTCDate()+1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6) t.setUTCDate(t.getUTCDate()+1);
  return t.toISOString().slice(0,10).replace(/-/g,"");
}
async function cnyesQuote(sym) {
  const q = (await getJSON(`${CNYES}/quote/quotes/${sym}`)).data[0];
  return {last:q["6"], chg:q["11"], pct:q["56"], prev:q["21"], open:q["19"], high:q["12"], low:q["13"], time:q["200007"], sessions:q["800003"], src:"鉅亨網"};
}
async function cnyesDaily(sym, days) {
  const now = Math.floor(Date.now()/1000);
  const h = (await getJSON(`${CNYES}/charting/history?symbol=${sym}&resolution=D&from=${now}&to=${days ? now - days*86400 : 0}`, 15000)).data;
  const m = {}; h.t.forEach((t, i) => { if (h.c[i]) m[utcDay(t)] = h.c[i]; });
  return Object.keys(m).sort().map(k => [k, m[k]]);
}
async function cnyesIntra(id) {
  const it = ITEMS[id], m = MK[id] || (MK[id] = {}), now = Math.floor(Date.now()/1000);
  let pts;
  if (it.kind === "txf") {   // 最近兩個時段（日盤＋夜盤），中間留間隔
    const h = (await getJSON(`${CNYES}/charting/history?symbol=${it.cn}&resolution=1&from=${now}&to=${now - 4*86400}`, 15000)).data;
    const all = h.t.map((t, i) => [t, h.c[i]]).filter(p => p[1]).sort((a,b) => a[0]-b[0]);
    const segs = [[]];
    all.forEach((p, i) => { if (i && p[0] - all[i-1][0] > 50*60) segs.push([]); segs[segs.length-1].push(p); });
    const two = segs.filter(g => g.length > 5).slice(-2);
    if (two.length) {
      const gap = Math.max(4, Math.round((two[0].length + (two[1] || []).length) * 0.04));
      m.intra = two[0].map(([t, c]) => [tpeKey(t), c]);
      if (two[1]) { for (let k = 0; k < gap; k++) m.intra.push([tpeKey(two[1][0][0]), null]); m.intra.push(...two[1].map(([t, c]) => [tpeKey(t), c])); }
      m.intraS = m.intra; m.intraLive = true;
    }
    return;
  } else {
    const h = (await getJSON(`${CNYES}/charting/history?symbol=${it.cn}&resolution=5&from=${now}&to=${now - 4*86400}`)).data;
    pts = h.t.map((t, i) => [t, h.c[i]]).filter(p => p[1]).sort((a,b) => a[0]-b[0]);
    let cut = 0;   // 只留最後一個交易時段（中間停超過 2 小時就切開）
    for (let i = pts.length - 1; i > 0; i--) if (pts[i][0] - pts[i-1][0] > 2*3600) { cut = i; break; }
    pts = pts.slice(cut);
  }
  if (pts.length > 1) { m.intra = pts.map(([t, c]) => [tpeKey(t), c]); m.intraS = m.intra; m.intraLive = true; }
}
async function refreshLive() {
  const ids = new Set(LIST().items.filter(id => ITEMS[id] && ITEMS[id].cn));
  if (D.id && ITEMS[D.id].cn && !$("#detail").hidden) ids.add(D.id);
  await Promise.all([...ids].map(async id => {
    const m = MK[id] || (MK[id] = {}), it = ITEMS[id];
    try {
      m.quote = await cnyesQuote(it.cn);
      if (it.kind === "txf" && (!m.daily || Date.now() - (m.t || 0) > 30*60*1000)) {
        const mm = {};
        try { (await getJSON(dataBase() + "txf.json?t=" + Date.now())).daily.forEach(([d, c]) => mm[d] = c); } catch (e) {}
        (await cnyesDaily(it.cn, 400)).forEach(([d, c]) => mm[d] = c);
        m.daily = Object.keys(mm).sort().map(k => [k, mm[k]]); m.t = Date.now(); m.full = true;
      }
      if (!m.daily && it.kind === "mkt") m.daily = await cnyesDaily(it.cn, 200);
      if (!m.intraLive || Date.now() - (m.it || 0) > 60*1000) { await cnyesIntra(id); m.it = Date.now(); }
    } catch (e) {
      if (it.kind === "txf") {   // 台指期備援
        try { const j = await getJSON(dataBase() + "txf.json?t=" + Date.now());
          if (j.quote) m.quote = {...j.quote, prev: j.quote.ref, src: (j.source || "備援") + "（備援，約每小時更新）"}; m.daily = j.daily; } catch (e2) {}
      }
    }
  }));
  renderHome();
  if (!$("#detail").hidden && D.id && LIVE(D.id)) renderDetail();
}
function futDesc() {
  const q = MK.TXF && MK.TXF.quote; if (!q) return "全日盤";
  const t = new Date(q.time*1000 + 8*3600*1000), hm = t.getUTCHours()*60 + t.getUTCMinutes();
  const ses = (hm >= 900 || hm < 300) ? "夜盤" : (hm >= 525 && hm <= 825) ? "日盤" : "收盤";
  return `全日盤・${ses} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}${Date.now()/1000 - q.time < 20*60 ? " ●" : ""}`;
}

/* ===================== 詳細頁 ===================== */
let D = {id:null, range:"3M", pts:[], geo:null};
function openSheet(id) { $("#scrim").hidden = false; $(id).hidden = false; document.body.style.overflow = "hidden"; }
function closeSheets() { for (const s of document.querySelectorAll(".sheet")) s.hidden = true; $("#scrim").hidden = true; $("#menu").hidden = true; document.body.style.overflow = ""; }
function openDetail(id) {
  const it = ITEMS[id];
  D.id = id; D.range = LIVE(id) ? "1D" : "3M";
  document.querySelector('#ranges [data-r="1D"]').hidden = !LIVE(id);
  document.querySelector("#detail .conv").hidden = LIVE(id);
  $("#dTitle").textContent = `${it.flag || ""} ${it.name}${it.kind === "fx" ? " " + it.sub : ""}`;
  document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.r === D.range));
  openSheet("#detail");
  renderDetail();
  if (LIVE(id) && it.cn) refreshLive();
  if (LIVE(id) && !(MK[id] && MK[id].intra)) setTimeout(() => { if (D.id === id && D.range === "1D" && !(MK[id] && MK[id].intra)) document.querySelector('#ranges [data-r="3M"]').click(); }, 4000);
}
function renderDetail() {
  const id = D.id, it = ITEMS[id], k = it.kind;
  const all = daily(id), m = MK[id] || {};
  const need = D.range === "1D" ? !m.intra : (D.range !== "3M" && !(k === "fx" || k === "metal" ? HIST[id] : m.full));
  $("#dLoading").hidden = !need;
  $("#dLoading").textContent = D.range === "1D" ? "讀取今天的走勢…" : "載入歷史資料…";
  const ptsRaw = D.range === "1D" ? (m.intra || []) : need ? [] : all.filter(p => p[0] >= cutoff(D.range));
  const pts = realPts(ptsRaw);
  D.pts = pts;
  const rows = (k === "fx" || k === "metal") ? (HIST[id] || (RECENT && RECENT.rates[id]) || []) : [];
  const BANK = {玉山:"玉山銀行",台銀:"臺灣銀行",台企銀:"臺灣企銀",一銀:"第一銀行",兆豐:"兆豐銀行",永豐:"永豐銀行",國泰:"國泰世華"};
  const q = m.quote;
  $("#dSub").textContent =
    k === "txf" ? `全日盤（夜盤＋日盤）・${futDesc().replace("全日盤・", "")}` :
    k === "mkt" ? `${it.sub}${q && q.time ? `・${q.src}・${tpeHM(q.time)}` : ""}` :
    k === "metal" ? `國際${it.name}價換算台幣・${S.dir === "n" ? "1 公克 → 台幣" : "1000 台幣 → 公克"}` :
    `${(BANK[(rows[rows.length-1]||[])[5]] || "") && BANK[(rows[rows.length-1]||[])[5]] + "・"}${RATE_NAME[usedKey(rows)]}・${S.dir === "n" ? `1 ${id} → 台幣` : `1000 台幣 → ${id}`}`;
  D.switches = [];
  for (let i = 1; i < rows.length; i++) if (rows[i][5] && rows[i-1][5] && rows[i][5] !== rows[i-1][5] && rows[i][0] >= (pts[0]||[""])[0]) D.switches.push([rows[i][0], rows[i-1][5], rows[i][5]]);
  D.switches = D.switches.filter((x, i, a) => i === 0 || a[i-1][2] !== x[2] || a[i-1][1] !== x[1]).slice(-3);
  const cv = $("#chart");
  D.thin = thin(ptsRaw, Math.round(cv.clientWidth*2));
  D.geo = drawLine(cv, D.thin, detailOpt());
  showPoint(null);
  const st = $("#dStats"); st.innerHTML = "";
  if (pts.length) {
    const v = pts.map(p=>p[1]), hi = Math.max(...v), lo = Math.min(...v), avg = v.reduce((a,b)=>a+b,0)/v.length;
    const label = {"1D":"今天","3M":"3個月","1Y":"1年","3Y":"3年","ALL":"全部"}[D.range];
    st.innerHTML = `<div class="stat"><span>${label}最高</span><b>${fmtFor(id, hi)}</b><span>${ymd(pts[v.indexOf(hi)][0])}</span></div>
      <div class="stat"><span>${label}最低</span><b>${fmtFor(id, lo)}</b><span>${ymd(pts[v.indexOf(lo)][0])}</span></div>
      <div class="stat"><span>平均</span><b>${fmtFor(id, avg)}</b><span>${ymd(pts[0][0]).slice(0, D.range === "1D" ? 16 : 7)} 起</span></div>`;
    if (D.switches.length) st.insertAdjacentHTML("beforeend", `<div class="muted small" style="grid-column:1/-1">虛線處換了資料來源：${D.switches.map(x => `${ymd(x[0])} 起由${x[1]}改為${x[2]}`).join("；")}。不同銀行牌價略有差異。</div>`);
  }
  const rq = $("#dRates"); rq.innerHTML = "";
  const note = t => { const n = el("div","muted small",t); n.style.gridColumn = "1/-1"; rq.append(n); };
  if (LIVE(id) && q) {
    const I = info(id);
    for (const [lab, v] of [["最新", fmtFor(id, q.last)], ["漲跌", I.chg != null ? (I.chg>0?"+":"") + fmtFor(id, I.chg) + `（${I.pct>0?"+":""}${(+I.pct).toFixed(2)}%）` : "—"],
                            [k === "txf" ? "參考價（前一日結算）" : "昨收", fmtFor(id, q.prev)], ["開盤", fmtFor(id, q.open)], ["最高", fmtFor(id, q.high)], ["最低", fmtFor(id, q.low)]])
      rq.append(el("div","stat",`<span>${lab}</span><b>${v}</b><span>${q.time ? tpeHM(q.time) : ""}</span>`));
    note(k === "txf" ? `資料來源：${q.src}。台指期近月，全日盤：前一天 15:00 夜盤開始，到當天 13:45 日盤結束。`
                     : `資料來源：${q.src}${q.src === "鉅亨網" ? "（手機即時）" : "（約每小時更新）"}；歷史走勢來自 Yahoo Finance。`);
  } else if (k === "metal") {
    const r = rows[rows.length-1];
    if (r) for (const [lab, mul] of [["1 公克", 1], ["1 台錢（3.75 公克）", 3.75], ["1 台兩（37.5 公克）", 37.5], ["1 盎司（31.1 公克）", 31.1035]])
      rq.append(el("div","stat",`<span>${lab}</span><b>${(r[2]*mul).toLocaleString("en-US",{maximumFractionDigits: r[2]*mul >= 100 ? 0 : 2})} 元</b><span>${ymd(r[0])}</span>`));
    note("國際價（紐約期貨）× 美元匯率換算，未含銀行黃金存摺買賣價差。");
  } else if (k === "fx") {
    const r = rows[rows.length-1];
    if (r) for (const kk of ["cs","ss","cb","sb"]) rq.append(el("div","stat",`<span>${RATE_NAME[kk]}（1 ${id}）</span><b>${r[COL[kk]] || "無報價"}</b><span>${ymd(r[0])}${r[5] ? "・" + r[5] : ""}</span>`));
  }
  renderNews(id);
  if (!LIVE(id)) { $("#cvFxLabel").textContent = k === "metal" ? `公克 ${it.name}` : `${it.sub} ${id}`; convert("twd"); }
}
function showPoint(i) {
  const pts = D.thin || [], all = D.pts, id = D.id;
  if (!all.length) { $("#dPrice").textContent = "—"; $("#dChg").textContent = ""; $("#dScrub").innerHTML = "&nbsp;"; return; }
  const q = MK[id] && MK[id].quote;
  const first = D.range === "1D" && q && q.prev ? [null, q.prev] : all[0];
  const p = i == null ? all[all.length-1] : pts[i];
  const ch = pct(first[1], p[1]);
  $("#dPrice").textContent = fmtFor(id, p[1]);
  const c = $("#dChg"); c.textContent = `${ch>0?"+":""}${fmtFor(id, p[1]-first[1])}（${ch>0?"+":""}${ch.toFixed(2)}%）`;
  c.className = ch > 0 ? "up-t" : ch < 0 ? "down-t" : "muted";
  $("#dScrub").textContent = (i == null ? `最新 ${ymd(p[0])}` : ymd(p[0])) + (D.range === "1D" ? (q && q.prev ? "・相對昨收" : "") : "・相對區間起點");
}
function scrub(e) {
  const g = D.geo, pts = D.thin; if (!g || !pts || pts.length < 2) return;
  const r = $("#chart").getBoundingClientRect(), x = e.clientX - r.left;
  let i = Math.max(0, Math.min(pts.length-1, Math.round(x / (g.W - 58) * (pts.length-1))));
  for (let d = 0; pts[i][1] == null && d < pts.length; d++) { if (pts[i+d] && pts[i+d][1] != null) { i += d; break; } if (pts[i-d] && pts[i-d][1] != null) { i -= d; break; } }
  drawLine($("#chart"), pts, detailOpt());
  const ctx = $("#chart").getContext("2d"), X = g.X(i), Y = g.Y(pts[i][1]);
  ctx.strokeStyle = "#8e8e93"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X,0); ctx.lineTo(X,g.H); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X,Y,4.5,0,7); ctx.fill();
  showPoint(i);
}
function endScrub() { if (D.geo) { drawLine($("#chart"), D.thin, detailOpt()); showPoint(null); } }
function detailOpt() {
  const q = MK[D.id] && MK[D.id].quote;
  return {baseline:true, axis:true, padR:58, padT:16, padB:10, lw:2, id:D.id, segLabels:true, marks:(D.switches||[]).map(x => x[0]),
          base: D.range === "1D" && q && q.prev ? q.prev : undefined};
}
function curRate() { const rows = HIST[D.id] || (RECENT && RECENT.rates[D.id]) || []; const l = rows[rows.length-1]; return l ? pick(l) : null; }
function convert(from) {
  const v = curRate(); const a = $("#cvTwd"), b = $("#cvFx");
  const n = s => parseFloat(String(s).replace(/,/g,""));
  if (!v) { $("#cvNote").textContent = "沒有報價"; return; }
  if (from === "twd") { const t = n(a.value); b.value = isFinite(t) ? (t / v).toLocaleString("en-US",{maximumFractionDigits: t/v >= 100 ? 0 : 2}) : ""; }
  else { const f = n(b.value); a.value = isFinite(f) ? Math.round(f * v).toLocaleString("en-US") : ""; }
  $("#cvNote").textContent = K(D.id) === "metal" ? `以國際價 ${v} 元／公克試算` : `以${RATE_NAME[usedKey(HIST[D.id] || RECENT.rates[D.id])]} ${v} 試算，實際以銀行交易時為準`;
}

/* ===================== 相關新聞 ===================== */
let NEWS = null;
async function loadNews() { try { NEWS = await getJSON(dataBase() + "news.json?t=" + Date.now()); } catch (e) {} }
const ago = ts => { const m = Math.round((Date.now()/1000 - ts) / 60); return m < 60 ? `${Math.max(1, m)} 分鐘前` : m < 1440 ? `${Math.round(m/60)} 小時前` : `${Math.round(m/1440)} 天前`; };
const esc = t => String(t || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function renderNews(id) {
  const box = $("#dNews");
  const list = NEWS && NEWS.news && NEWS.news[id];
  if (!list) { box.innerHTML = `<div class="news-h">相關新聞</div><p class="muted small">${NEWS ? "目前沒有相關新聞" : "讀取中…"}</p>`; if (!NEWS) loadNews().then(() => { if (D.id === id) renderNews(id); }); return; }
  const today = list.filter(n => Date.now()/1000 - n.ts < 24*3600);
  const show = (today.length >= 3 ? today : list).slice(0, 3);
  box.innerHTML = `<div class="news-h">相關新聞<small>${today.length ? "最近 24 小時" : "最新"}・約每小時更新</small></div>`;
  show.forEach((n, i) => {
    const a = el("div", "news");
    a.innerHTML = `<a href="${esc(n.u)}" target="_blank" rel="noopener"><div class="nt">${esc(n.t)}</div>${n.d ? `<div class="nd">${esc(n.d)}</div>` : ""}</a>
      <div class="nm2">${n.lang === "en" ? '<span class="en">英文</span>' : ""}${esc(n.s)}・${n.ts ? ago(n.ts) : ""}</div>
      ${n.lang === "en" ? `<button class="tr">翻譯成中文</button><div class="trout" hidden></div>` : ""}`;
    const b = a.querySelector(".tr");
    if (b) b.onclick = async () => {
      const out = a.querySelector(".trout"); b.disabled = true; b.textContent = "翻譯中…";
      const r = await translate(n.t + (n.d ? "\n" + n.d : ""));
      out.hidden = false;
      if (r.ok) { out.className = "trout ok"; out.innerHTML = `<span class="tag">中文翻譯</span>${esc(r.text).replace(/\n/g, "<br>")}`; b.hidden = true; }
      else { out.className = "trout warn"; out.textContent = r.quota ? "⚠️ 今天的翻譯額度已用完，明天再試。" : "⚠️ 翻譯失敗，請稍後再試。"; b.disabled = false; b.textContent = "再試一次"; }
    };
    box.append(a);
  });
}
async function translate(text) {
  const day = new Date().toISOString().slice(0,10);
  let quota = false;
  try {   // 1) Google 翻譯
    const j = await getJSON("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=" + encodeURIComponent(text));
    const t = (j[0] || []).map(x => x[0]).join("");
    if (t) return {ok:true, text:t};
  } catch (e) { if (String(e.message) === "429") quota = true; }
  try {   // 2) MyMemory（每天有免費額度）
    if (localStorage.getItem("fx-mm-quota") === day) return {ok:false, quota:true};
    const j = await getJSON("https://api.mymemory.translated.net/get?langpair=en|zh-TW&q=" + encodeURIComponent(text.slice(0, 480)));
    const t = j.responseData && j.responseData.translatedText || "";
    if (j.quotaFinished || j.responseStatus == 429 || /MYMEMORY WARNING|USED ALL AVAILABLE FREE/i.test(t)) { try { localStorage.setItem("fx-mm-quota", day); } catch (e) {} return {ok:false, quota:true}; }
    if (t) return {ok:true, text:t};
  } catch (e) { if (String(e.message) === "429") quota = true; }
  return {ok:false, quota};
}

/* ===================== 設定 ===================== */
function renderSettings() {
  for (const [id, key] of [["#segRate","rate"],["#segDir","dir"],["#segColor","color"]])
    document.querySelectorAll(id + " button").forEach(b => {
      b.classList.toggle("on", b.dataset.v === S[key]);
      b.onclick = () => { S[key] = b.dataset.v; save(); renderSettings(); renderHome(); };
    });
  $("#sData").value = S.data || "";
}

/* ===================== 綁定 ===================== */
$("#btnMenu").onclick = e => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; };
document.addEventListener("click", e => { if (!e.target.closest("#menu,#btnMenu")) $("#menu").hidden = true; if (!e.target.closest(".wrap")) closeSwipes(); });
$("#mEdit").onclick = () => { $("#menu").hidden = true; EDITING = true; closeSwipes(); renderHome(); };
$("#mNew").onclick = () => { $("#menu").hidden = true; newList(); };
$("#mSettings").onclick = () => { $("#menu").hidden = true; renderSettings(); openSheet("#settings"); };
$("#btnDone").onclick = () => { EDITING = false; renderHome(); refreshLive(); };
$("#sClose").onclick = () => { const v = $("#sData").value.trim(); if (v !== (S.data||"")) { S.data = v; save(); for (const k in HIST) delete HIST[k]; loadAll(); } closeSheets(); renderHome(); };
$("#dClose").onclick = closeSheets; $("#pClose").onclick = closeSheets; $("#scrim").onclick = closeSheets;
$("#sRefresh").onclick = () => { for (const k in HIST) delete HIST[k]; loadAll(); closeSheets(); };
document.querySelectorAll("#ranges button").forEach(b => b.onclick = () => {
  D.range = b.dataset.r;
  document.querySelectorAll("#ranges button").forEach(x => x.classList.toggle("on", x === b));
  renderDetail();
  if (D.range !== "1D" && D.range !== "3M") loadHist(D.id).then(renderDetail).catch(() => { $("#dLoading").textContent = "讀不到歷史資料"; });
  if (D.range === "1D" && ITEMS[D.id].cn) cnyesIntra(D.id).then(renderDetail).catch(() => {});
});
const cvs = $("#chart");
cvs.addEventListener("pointerdown", e => { cvs.setPointerCapture(e.pointerId); scrub(e); });
cvs.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") scrub(e); });
cvs.addEventListener("pointerup", endScrub); cvs.addEventListener("pointercancel", endScrub);
$("#cvTwd").addEventListener("input", () => convert("twd"));
$("#cvFx").addEventListener("input", () => convert("fx"));
for (const sh of document.querySelectorAll(".sheet")) {   // 下滑關閉
  let y0 = null;
  sh.addEventListener("touchstart", e => { y0 = sh.scrollTop <= 0 && !e.target.closest("canvas,input") ? e.touches[0].clientY : null; }, {passive:true});
  sh.addEventListener("touchend", e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 110) closeSheets(); y0 = null; });
}
window.addEventListener("resize", () => { renderHome(); if (!$("#detail").hidden) renderDetail(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
setInterval(() => { if (!document.hidden && !EDITING) refreshLive(); }, 30000);

function loadAll() { loadRecent(); loadMarkets().then(refreshLive); loadNews(); }
document.querySelectorAll("#sparkSeg button").forEach(b => b.onclick = e => { e.stopPropagation(); S.spark = b.dataset.v; save(); renderHome(); });
renderHome();
loadAll();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
