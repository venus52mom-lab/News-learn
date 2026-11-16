"use strict";
/* ===== 基本資料 ===== */
const CUR = {
  USD:["美金","🇺🇸"],HKD:["港幣","🇭🇰"],GBP:["英鎊","🇬🇧"],AUD:["澳幣","🇦🇺"],CAD:["加拿大幣","🇨🇦"],
  SGD:["新加坡幣","🇸🇬"],CHF:["瑞士法郎","🇨🇭"],JPY:["日圓","🇯🇵"],ZAR:["南非幣","🇿🇦"],SEK:["瑞典幣","🇸🇪"],
  NZD:["紐元","🇳🇿"],THB:["泰銖","🇹🇭"],PHP:["菲國比索","🇵🇭"],IDR:["印尼盾","🇮🇩"],EUR:["歐元","🇪🇺"],
  KRW:["韓元","🇰🇷"],VND:["越南盾","🇻🇳"],MYR:["馬來幣","🇲🇾"],CNY:["人民幣","🇨🇳"],
  XAU:["黃金","🥇"],XAG:["白銀","🥈"],TXF:["台指期","📈"]
};
const METAL = c => c === "XAU" || c === "XAG";
const FUT = c => c === "TXF";
const SPECIAL = c => METAL(c) || FUT(c);
let CTX = "";               // 目前在畫哪一個（決定小數位數）
const RATE_NAME = {cb:"現金買入",cs:"現金賣出",sb:"即期買入",ss:"即期賣出"};
const COL = {cb:1,cs:2,sb:3,ss:4};
const FALLBACK = {cs:["cs","ss"],ss:["ss","cs"],cb:["cb","sb"],sb:["sb","cb"]};

/* ===== 設定（存在手機本機） ===== */
const DEF = {list:["TXF","JPY","USD","AUD","THB","KRW","XAU","XAG"],rate:"cs",dir:"n",color:"tw",data:"",badge:"d"};
let S = {...DEF};
try { S = {...DEF, ...JSON.parse(localStorage.getItem("fx-settings")||"{}")}; } catch(e) {}
if (!S.fut) { if (!S.list.includes("TXF")) S.list.unshift("TXF"); S.fut = 1; }
if (!S.metals) { for (const m of ["XAU","XAG"]) if (!S.list.includes(m)) S.list.push(m); S.metals = 1; }
const save = () => { try { localStorage.setItem("fx-settings", JSON.stringify(S)); } catch(e) {} };
const dataBase = () => { let b = (S.data||"").trim() || "data/"; return b.endsWith("/") ? b : b + "/"; };

let RECENT = null;          // recent.json
const isYahoo = () => !!(RECENT && RECENT.source === "yahoo");
const HIST = {};            // CCY -> rows（完整歷史）

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

/* ===== 數值 ===== */
function pick(row, ccy) {
  for (const k of FALLBACK[S.rate]) { const v = row[COL[k]]; if (v) return v; }
  return null;
}
function usedKey(rows) {
  const last = rows && rows[rows.length-1]; if (!last) return S.rate;
  for (const k of FALLBACK[S.rate]) if (last[COL[k]]) return k;
  return S.rate;
}
const disp = (v, c) => v == null ? null : (S.dir === "n" || FUT(c) ? v : 1000 / v);
function series(rows, c) {
  const out = [];
  for (const r of rows || []) { const v = disp(pick(r), c); if (v) out.push([r[0], v]); }
  return out;
}
function fmt(v) {
  if (v == null || !isFinite(v)) return "—";
  if (FUT(CTX)) return Math.round(v).toLocaleString("en-US");
  const a = Math.abs(v);
  const d = S.dir === "n"
    ? (a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : 6)
    : (a >= 10000 ? 0 : a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 3 : 4);
  return v.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
}
const pct = (a, b) => (b - a) / a * 100;
const ymd = s => `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}` + (s.length >= 12 ? ` ${s.slice(8,10)}:${s.slice(10,12)}` : "");
const toDate = s => new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
function cutoff(range) {
  if (range === "ALL") return "0";
  const d = new Date();
  if (range === "3M") d.setMonth(d.getMonth()-3);
  if (range === "1Y") d.setFullYear(d.getFullYear()-1);
  if (range === "3Y") d.setFullYear(d.getFullYear()-3);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
const unitLabel = ccy => FUT(ccy) ? "點" : METAL(ccy) ? (S.dir === "n" ? "1 公克 → 台幣" : "1000 台幣 → 公克") : S.dir === "n" ? `1 ${ccy} → 台幣` : `1000 台幣 → ${ccy}`;

/* ===== 畫圖 ===== */
function cssVar(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
function setupCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width*dpr)); cv.height = Math.max(1, Math.round(r.height*dpr));
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  return [ctx, r.width, r.height];
}
function thin(pts, maxN) {          // 依像素分桶，保留每桶最高/最低，長期資料也不失真
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
  const vals = pts.map(p => p[1]), base = pts[0][1];
  let lo = Math.min(...vals, opt.baseline ? base : Infinity), hi = Math.max(...vals, opt.baseline ? base : -Infinity);
  if (hi === lo) { hi += hi*0.001 || 1; lo -= lo*0.001 || 1; }
  const n = pts.length;
  const X = i => i/(n-1)*(W-padR), Y = v => padT + (hi - v)/(hi - lo)*(H - padT - padB);
  const up = pts[n-1][1] >= base, color = cssVar(pts[n-1][1] === base ? "--flat" : up ? "--up" : "--down");
  // 漸層填色
  const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0, color+"55"); g.addColorStop(1, color+"00");
  ctx.beginPath(); pts.forEach((p,i) => i ? ctx.lineTo(X(i),Y(p[1])) : ctx.moveTo(X(i),Y(p[1])));
  ctx.lineTo(X(n-1),H); ctx.lineTo(0,H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  // 起點虛線
  if (opt.baseline) { ctx.setLineDash([3,3]); ctx.strokeStyle = color+"aa"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,Y(base)); ctx.lineTo(W-padR,Y(base)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.beginPath(); pts.forEach((p,i) => i ? ctx.lineTo(X(i),Y(p[1])) : ctx.moveTo(X(i),Y(p[1])));
  ctx.strokeStyle = color; ctx.lineWidth = opt.lw || 1.6; ctx.lineJoin = "round"; ctx.stroke();
  // 換資料來源的位置
  if (opt.marks && opt.marks.length) {
    ctx.setLineDash([2,4]); ctx.strokeStyle = "#8e8e93"; ctx.lineWidth = 1;
    for (const m of opt.marks) {
      const i = pts.findIndex(p => p[0] >= m); if (i <= 0) continue;
      ctx.beginPath(); ctx.moveTo(X(i), 0); ctx.lineTo(X(i), H); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // 右側刻度
  if (opt.axis) {
    ctx.fillStyle = "#8e8e93"; ctx.font = "11px -apple-system,sans-serif"; ctx.textAlign = "left";
    for (let k = 0; k <= 3; k++) {
      const v = hi - (hi-lo)*k/3, y = Y(v);
      ctx.fillText(fmt(v), W-padR+4, Math.min(H-2, Math.max(10, y+4)));
      ctx.strokeStyle = "#2c2c2e"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W-padR,y); ctx.stroke();
    }
  }
  return {X, Y, n, color, W, H};
}

/* ===== 首頁 ===== */
function renderHome() {
  document.body.classList.toggle("us", S.color === "us");
  const now = new Date();
  $("#today").textContent = `${now.getMonth()+1}月${now.getDate()}日`;
  $("#rateLabel").textContent = `${isYahoo() ? "市場匯率（Yahoo）" : "銀行牌告・" + RATE_NAME[S.rate]}${S.dir === "n" ? "" : "・每千台幣"}`;
  document.querySelector(".foot").textContent = isYahoo()
    ? "暫用 Yahoo Finance 市場中間價（不是銀行買賣牌價）。"
    : "今天的牌價來自玉山銀行（玉山沒有的幣別用其他銀行，名稱標在幣別下方）。2026/6/26 以前的走勢是臺灣銀行牌價（比率網整理），之後是玉山銀行。縮圖為近 3 個月，點右側數字可切換顯示。";
  $("#updated").textContent = RECENT ? `更新 ${RECENT.updated.slice(5)}` : "";
  const ul = $("#list"); ul.innerHTML = "";
  if (!RECENT) { ul.append(el("li","empty","載入中…")); return; }
  if (!Object.keys(RECENT.rates || {}).length) { ul.append(el("li","empty","資料還沒抓到，請稍後再打開。")); return; }
  if (!S.list.length) { ul.append(el("li","empty","還沒有幣別，按右上「編輯」加入。")); return; }
  const c3 = cutoff("3M");
  for (const ccy of S.list) {
    CTX = ccy;
    const rows = RECENT.rates[ccy] || [];
    const all = series(rows, ccy), pts = all.filter(p => p[0] >= c3);
    const li = el("li","row");
    const last = all[all.length-1], prev = all[all.length-2];
    const [nm, flag] = CUR[ccy] || [ccy, ""];
    const lastRow = rows[rows.length-1] || [];
    const fb = (lastRow[5] ? `・${lastRow[5]}` : "") + (!isYahoo() && usedKey(rows) !== S.rate ? `・${RATE_NAME[usedKey(rows)]}` : "");
    li.innerHTML = `<div><div class="name"><span class="flag">${flag}</span>${SPECIAL(ccy) ? nm : ccy}</div>
      <div class="desc">${FUT(ccy) ? futDesc() : METAL(ccy) ? "台幣／公克・國際價" : nm + fb}</div></div><canvas></canvas>
      <div class="right"><div class="price">${last ? fmt(last[1]) : "—"}</div><div class="badge"></div></div>`;
    const b = li.querySelector(".badge");
    let ch = null, txt = "—";
    if (last && prev && S.badge === "d") { ch = pct(prev[1], last[1]); txt = (ch>0?"+":"") + ch.toFixed(2) + "%"; }
    if (FUT(ccy) && FQ && S.badge === "d") { ch = FQ.pct; txt = (ch>0?"+":"") + ch.toFixed(2) + "%"; }
    if (FUT(ccy) && FQ && S.badge === "abs") { ch = FQ.chg; txt = (ch>0?"+":"") + Math.round(ch).toLocaleString("en-US"); }
    if (last && pts.length > 1 && S.badge === "p3") { ch = pct(pts[0][1], last[1]); txt = "3M " + (ch>0?"+":"") + ch.toFixed(1) + "%"; }
    if (last && prev && S.badge === "abs") { ch = last[1]-prev[1]; txt = (ch>0?"+":"") + fmt(ch); }
    b.textContent = txt;
    b.classList.add(ch == null || Math.abs(ch) < 1e-9 ? "flat" : ch > 0 ? "up" : "down");
    b.addEventListener("click", e => { e.stopPropagation(); S.badge = {d:"p3",p3:"abs",abs:"d"}[S.badge]; save(); renderHome(); });
    li.addEventListener("click", () => openDetail(ccy));
    ul.append(li);
    requestAnimationFrame(() => drawLine(li.querySelector("canvas"), pts, {baseline:true, lw:1.4}));
  }
}

/* ===== 資料 ===== */
async function loadRecent(force) {
  try {
    const r = await fetch(dataBase() + "recent.json" + (force ? "?t=" + Date.now() : ""), {cache:"no-cache"});
    if (!r.ok) throw new Error(r.status);
    RECENT = await r.json();
    putFut(); loadFut();
  } catch (e) {
    if (!RECENT) { $("#list").innerHTML = ""; $("#list").append(el("li","empty",
      "還讀不到匯率資料。")); return; }
  }
  renderHome();
}
async function loadHist(ccy) {
  if (HIST[ccy]) return HIST[ccy];
  const r = await fetch(dataBase() + `hist/${ccy}.json`, {cache:"no-cache"});
  if (!r.ok) throw new Error(r.status);
  const rows = await r.json();
  // 合併 recent 中較新的資料
  const rec = (RECENT && RECENT.rates[ccy]) || [];
  const lastD = rows.length ? rows[rows.length-1][0] : "0";
  for (const x of rec) if (x[0] > lastD) rows.push(x);
  return HIST[ccy] = rows;
}

/* ===== 詳細頁 ===== */
let D = {ccy:null, range:"3M", pts:[], geo:null};
function openSheet(id) { $("#scrim").hidden = false; $(id).hidden = false; document.body.style.overflow = "hidden"; }
function closeSheets() { for (const s of document.querySelectorAll(".sheet")) s.hidden = true; $("#scrim").hidden = true; document.body.style.overflow = ""; }

function openDetail(ccy) {
  D.ccy = ccy; D.range = FUT(ccy) ? "1D" : "3M";
  document.querySelector('#ranges [data-r="1D"]').hidden = !FUT(ccy);
  document.querySelector("#detail .conv").hidden = FUT(ccy);
  if (FUT(ccy)) loadIntraday().then(() => {
    if (D.ccy !== ccy) return;
    if (!INTRA && D.range === "1D") document.querySelector('#ranges [data-r="3M"]').click(); else renderDetail();
  });
  const [nm, flag] = CUR[ccy] || [ccy,""];
  $("#dTitle").textContent = `${flag} ${nm} ${ccy}`;
  document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.r === D.range));
  openSheet("#detail");
  renderDetail();
  loadHist(ccy).then(() => { if (D.ccy === ccy) renderDetail(); }).catch(() => {});
}
function rowsFor(ccy) { return HIST[ccy] || (RECENT && RECENT.rates[ccy]) || []; }

/* ===== 台指期（手機直接向鉅亨網拿即時報價；失敗改讀備援檔） ===== */
const CNYES = "https://ws.api.cnyes.com/ws/api/v1";
let FQ = null, INTRA = null, FUT_DAILY = null;
async function getJSON(u, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, {signal:c.signal, cache:"no-store"}); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const utcDay = ts => new Date(ts*1000).toISOString().slice(0,10).replace(/-/g,"");
function tradeDay(ts) { // 15:00 以後的夜盤算隔天的交易日
  const t = new Date(ts*1000 + 8*3600*1000); if (t.getUTCHours() >= 15) t.setUTCDate(t.getUTCDate()+1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6) t.setUTCDate(t.getUTCDate()+1);
  return t.toISOString().slice(0,10).replace(/-/g,"");
}
function futDesc() {
  if (!FQ) return "全日盤";
  const t = new Date(FQ.time*1000 + 8*3600*1000), h = t.getUTCHours(), m = t.getUTCMinutes(), hm = h*60+m;
  const ses = (hm >= 900 || hm < 300) ? "夜盤" : (hm >= 525 && hm <= 825) ? "日盤" : "收盤";
  const stale = Date.now()/1000 - FQ.time > 20*60 ? "" : " ●";
  return `全日盤・${ses} ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}${stale}`;
}
function putFut() {
  if (!FUT_DAILY || !RECENT) return;
  const rows = FUT_DAILY.map(([d, c]) => [d, c, c, c, c, FQ ? FQ.src : ""]);
  if (FQ) { const d = tradeDay(FQ.time); const i = rows.findIndex(r => r[0] === d); const r = [d, FQ.last, FQ.last, FQ.last, FQ.last, FQ.src]; if (i >= 0) rows[i] = r; else rows.push(r); rows.sort((a,b) => a[0] < b[0] ? -1 : 1); }
  HIST.TXF = rows;
  const c = cutoff("3M"), pad = new Date(); pad.setMonth(pad.getMonth()-4);
  RECENT.rates.TXF = rows.slice(-130);
}
async function loadFut() {
  if (!S.list.includes("TXF") && D.ccy !== "TXF") return;
  try {
    const q = (await getJSON(`${CNYES}/quote/quotes/TWF:TXF:FUTURES`)).data[0];
    FQ = {last:q["6"], chg:q["11"], pct:q["56"], ref:q["21"], open:q["19"], high:q["12"], low:q["13"], time:q["200007"], sessions:q["800003"], src:"鉅亨網"};
    if (!FUT_DAILY || Date.now() - (loadFut.t || 0) > 30*60*1000) {
      const m = {};
      try { (await getJSON(dataBase() + "txf.json?t=" + Date.now())).daily.forEach(([d, c]) => m[d] = c); } catch (e) {}  // 完整歷史
      const now = Math.floor(Date.now()/1000);
      const h = (await getJSON(`${CNYES}/charting/history?symbol=TWF:TXF:FUTURES&resolution=D&from=${now}&to=${now - 400*86400}`, 15000)).data;
      h.t.forEach((t, i) => { if (h.c[i]) m[utcDay(t)] = h.c[i]; });
      FUT_DAILY = Object.keys(m).sort().map(k => [k, m[k]]); loadFut.t = Date.now();
    }
  } catch (e) {   // 備援：GitHub 每小時存的期交所／鉅亨網資料
    try {
      const j = await getJSON(dataBase() + "txf.json?t=" + Date.now());
      if (j.quote) FQ = {...j.quote, src: (j.source || "備援") + "（備援，約每小時更新）"};
      FUT_DAILY = j.daily;
    } catch (e2) {}
  }
  putFut(); renderHome(); if (!$("#detail").hidden && D.ccy === "TXF") renderDetail();
}
async function loadIntraday() {
  try {
    const now = Math.floor(Date.now()/1000), start = FQ && FQ.sessions ? FQ.sessions[0][0] : now - 86400;
    const h = (await getJSON(`${CNYES}/charting/history?symbol=TWF:TXF:FUTURES&resolution=1&from=${now}&to=${start}`)).data;
    const pts = h.t.map((t, i) => [t, h.c[i]]).filter(p => p[1]).sort((a,b) => a[0]-b[0]);
    INTRA = pts.map(([t, c]) => { const d = new Date(t*1000 + 8*3600*1000).toISOString(); return [d.slice(0,10).replace(/-/g,"") + d.slice(11,13) + d.slice(14,16), c]; });
  } catch (e) { INTRA = null; }
}

function renderDetail() {
  const ccy = D.ccy; CTX = ccy;
  const rows = rowsFor(ccy), all = series(rows, ccy);
  const need = (D.range !== "3M" && D.range !== "1D" && !HIST[ccy]) || (D.range === "1D" && !INTRA);
  $("#dLoading").hidden = !need;
  $("#dLoading").textContent = D.range === "1D" ? "讀取今天的走勢…" : "載入歷史資料…";
  const pts = D.range === "1D" ? (INTRA || []) : need ? [] : all.filter(p => p[0] >= cutoff(D.range));
  D.pts = pts;
  const k = usedKey(rows);
  const lastBank = (rows[rows.length-1] || [])[5];
  const BANK = {玉山:"玉山銀行",台銀:"臺灣銀行",台企銀:"臺灣企銀",一銀:"第一銀行",兆豐:"兆豐銀行",永豐:"永豐銀行",國泰:"國泰世華"};
  $("#dSub").textContent = FUT(ccy) ? `全日盤（夜盤＋日盤）・${futDesc().replace("全日盤・", "")}` : METAL(ccy) ? `國際${CUR[ccy][0]}價換算台幣・${unitLabel(ccy)}`
    : `${isYahoo() ? "市場匯率（Yahoo）" : (lastBank ? (BANK[lastBank] || lastBank) + "・" : "") + RATE_NAME[k]}・${unitLabel(ccy)}`;
  // 換銀行的位置（畫虛線）
  D.switches = [];
  for (let i = 1; i < rows.length; i++) if (rows[i][5] && rows[i-1][5] && rows[i][5] !== rows[i-1][5] && rows[i][0] >= (pts[0]||[""])[0]) D.switches.push([rows[i][0], rows[i-1][5], rows[i][5]]);
  D.switches = D.switches.filter((x, i, a) => i === 0 || a[i-1][2] !== x[2] || a[i-1][1] !== x[1]).slice(-3);
  const cv = $("#chart");
  D.geo = drawLine(cv, thin(pts, Math.round(cv.clientWidth*2)), detailOpt());
  D.thin = thin(pts, Math.round(cv.clientWidth*2));
  showPoint(null);
  // 統計
  const st = $("#dStats"); st.innerHTML = "";
  if (pts.length) {
    const v = pts.map(p=>p[1]), hi = Math.max(...v), lo = Math.min(...v), avg = v.reduce((a,b)=>a+b,0)/v.length;
    const hiP = pts[v.indexOf(hi)], loP = pts[v.indexOf(lo)];
    const label = {"1D":"今天","3M":"3個月","1Y":"1年","3Y":"3年","ALL":"全部"}[D.range];
    st.innerHTML = `<div class="stat"><span>${label}最高</span><b>${fmt(hi)}</b><span>${ymd(hiP[0])}</span></div>
      <div class="stat"><span>${label}最低</span><b>${fmt(lo)}</b><span>${ymd(loP[0])}</span></div>
      <div class="stat"><span>平均</span><b>${fmt(avg)}</b><span>${ymd(pts[0][0]).slice(0,7)} 起</span></div>`;
    if (D.switches.length) st.insertAdjacentHTML("beforeend", `<div class="muted small" style="grid-column:1/-1">虛線處換了資料來源：${D.switches.map(x => `${ymd(x[0])} 起由${x[1]}改為${x[2]}`).join("；")}。不同銀行牌價略有差異。</div>`);
  }
  // 四種牌價
  const last = rows[rows.length-1], rq = $("#dRates"); rq.innerHTML = "";
  if (FUT(ccy) && FQ) {
    const t = new Date(FQ.time * 1000);
    for (const [lab, v] of [["最新", fmt(FQ.last)], ["漲跌", (FQ.chg>0?"+":"") + fmt(FQ.chg) + `（${FQ.pct>0?"+":""}${(+FQ.pct).toFixed(2)}%）`],
                            ["參考價（前一日結算）", fmt(FQ.ref)], ["開盤", fmt(FQ.open)], ["最高", fmt(FQ.high)], ["最低", fmt(FQ.low)]])
      rq.append(el("div","stat",`<span>${lab}</span><b>${v}</b><span>${t.getMonth()+1}/${t.getDate()} ${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}</span>`));
    const n = el("div","muted small",`資料來源：${FQ.src}。台指期近月，全日盤：前一天 15:00 夜盤開始，到當天 13:45 日盤結束。`); n.style.gridColumn = "1/-1"; rq.append(n);
  }
  else if (last && METAL(ccy)) {
    const g = last[2];
    for (const [lab, mul] of [["1 公克", 1], ["1 台錢（3.75 公克）", 3.75], ["1 台兩（37.5 公克）", 37.5], ["1 盎司（31.1 公克）", 31.1035]])
      rq.append(el("div","stat",`<span>${lab}</span><b>${(g*mul).toLocaleString("en-US",{maximumFractionDigits: g*mul >= 100 ? 0 : 2})} 元</b><span>${ymd(last[0])}</span>`));
    { const n = el("div","muted small","國際價（紐約期貨）× 美元匯率換算，未含銀行黃金存摺買賣價差。"); n.style.gridColumn = "1/-1"; rq.append(n); }
  }
  else if (last && isYahoo()) rq.append(el("div","stat",`<span>市場中間價（1 ${ccy}）</span><b>${last[2]}</b><span>${ymd(last[0])}</span>`));
  else if (last) for (const kk of ["cs","ss","cb","sb"]) {
    const v = last[COL[kk]];
    rq.append(el("div","stat",`<span>${RATE_NAME[kk]}（1 ${ccy}）</span><b>${v ? v : "無報價"}</b><span>${ymd(last[0])}${last[5] ? "・" + last[5] : ""}</span>`));
  }
  // 換算
  $("#cvFxLabel").textContent = METAL(ccy) ? `公克 ${CUR[ccy][0]}` : `${CUR[ccy]?.[0]||ccy} ${ccy}`;
  convert("twd");
}
function showPoint(i) {
  const pts = D.thin || [], all = D.pts;
  if (!all.length) { $("#dPrice").textContent = "—"; $("#dChg").textContent = ""; $("#dScrub").innerHTML = "&nbsp;"; return; }
  const first = all[0], p = i == null ? all[all.length-1] : pts[i];
  const ch = pct(first[1], p[1]);
  $("#dPrice").textContent = fmt(p[1]);
  const c = $("#dChg"); c.textContent = `${ch>0?"+":""}${fmt(p[1]-first[1])}（${ch>0?"+":""}${ch.toFixed(2)}%）`;
  c.className = ch > 0 ? "up-t" : ch < 0 ? "down-t" : "muted";
  $("#dScrub").textContent = i == null ? `最新 ${ymd(p[0])}・區間漲跌` : `${ymd(p[0])}・相對區間起點`;
}
function scrub(e) {
  const g = D.geo, pts = D.thin; if (!g || !pts || pts.length < 2) return;
  const r = $("#chart").getBoundingClientRect(), x = e.clientX - r.left;
  const i = Math.max(0, Math.min(pts.length-1, Math.round(x / (g.W - 58) * (pts.length-1))));
  drawLine($("#chart"), pts, detailOpt());
  const ctx = $("#chart").getContext("2d"), X = g.X(i), Y = g.Y(pts[i][1]);
  ctx.strokeStyle = "#8e8e93"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X,0); ctx.lineTo(X,g.H); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X,Y,4.5,0,7); ctx.fill();
  showPoint(i);
}
function endScrub() { if (D.geo) { drawLine($("#chart"), D.thin, detailOpt()); showPoint(null); } }
function detailOpt() { return {baseline:true, axis:true, padR:58, padT:10, padB:10, lw:2, marks:(D.switches||[]).map(x => x[0])}; }

function curRate() { const rows = rowsFor(D.ccy); const l = rows[rows.length-1]; return l ? pick(l) : null; }
function convert(from) {
  const v = curRate(); const a = $("#cvTwd"), b = $("#cvFx");
  const n = s => parseFloat(String(s).replace(/,/g,""));
  if (!v) { $("#cvNote").textContent = "沒有報價"; return; }
  if (from === "twd") { const t = n(a.value); b.value = isFinite(t) ? (t / v).toLocaleString("en-US",{maximumFractionDigits: t/v >= 100 ? 0 : 2}) : ""; }
  else { const f = n(b.value); a.value = isFinite(f) ? Math.round(f * v).toLocaleString("en-US") : ""; }
  if (METAL(D.ccy)) { $("#cvNote").textContent = `以國際價 ${v} 元／公克試算`; return; }
  $("#cvNote").textContent = isYahoo() ? `以市場中間價 ${v} 試算，銀行實際換匯會比較差一點` : `以${RATE_NAME[usedKey(rowsFor(D.ccy))]} ${v} 試算，實際以銀行交易時為準`;
}

/* ===== 編輯 ===== */
function renderEdit() {
  const mine = $("#eMine"), all = $("#eAll"); mine.innerHTML = ""; all.innerHTML = "";
  S.list.forEach(ccy => {
    const li = el("li", "", `<button class="ebtn rm">−</button><div class="n">${CUR[ccy][1]} ${CUR[ccy][0]}<small>${ccy}</small></div><span class="drag">☰</span>`);
    li.dataset.c = ccy;
    li.querySelector(".rm").onclick = () => { S.list = S.list.filter(x => x !== ccy); save(); renderEdit(); };
    dragify(li, li.querySelector(".drag"), mine);
    mine.append(li);
  });
  Object.keys(CUR).filter(c => !S.list.includes(c)).forEach(ccy => {
    const li = el("li", "", `<button class="ebtn add">＋</button><div class="n">${CUR[ccy][1]} ${CUR[ccy][0]}<small>${ccy}</small></div>`);
    li.onclick = () => { S.list.push(ccy); save(); renderEdit(); };
    all.append(li);
  });
}
function dragify(li, handle, ul) {
  handle.addEventListener("pointerdown", e => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); li.classList.add("dragging");
    const move = ev => {
      const sibs = [...ul.children].filter(x => x !== li);
      const after = sibs.find(s => { const r = s.getBoundingClientRect(); return ev.clientY < r.top + r.height/2; });
      ul.insertBefore(li, after || null);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      li.classList.remove("dragging"); S.list = [...ul.children].map(x => x.dataset.c); save();
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  });
}

/* ===== 設定 ===== */
function renderSettings() {
  for (const [id, key] of [["#segRate","rate"],["#segDir","dir"],["#segColor","color"]])
    document.querySelectorAll(id + " button").forEach(b => {
      b.classList.toggle("on", b.dataset.v === S[key]);
      b.onclick = () => { S[key] = b.dataset.v; save(); renderSettings(); renderHome(); };
    });
  $("#sData").value = S.data || "";
}

/* ===== 綁定 ===== */
$("#btnEdit").onclick = () => { renderEdit(); openSheet("#edit"); };
$("#btnSettings").onclick = () => { renderSettings(); openSheet("#settings"); };
$("#eClose").onclick = () => { closeSheets(); renderHome(); };
$("#sClose").onclick = () => { const v = $("#sData").value.trim(); if (v !== (S.data||"")) { S.data = v; save(); for (const k in HIST) delete HIST[k]; loadRecent(true); } closeSheets(); renderHome(); };
$("#dClose").onclick = closeSheets; $("#scrim").onclick = closeSheets;
$("#sRefresh").onclick = () => { for (const k in HIST) delete HIST[k]; loadRecent(true); closeSheets(); };
document.querySelectorAll("#ranges button").forEach(b => b.onclick = () => {
  D.range = b.dataset.r;
  document.querySelectorAll("#ranges button").forEach(x => x.classList.toggle("on", x === b));
  renderDetail();
  if (!HIST[D.ccy] && !FUT(D.ccy)) loadHist(D.ccy).then(renderDetail).catch(() => { $("#dLoading").textContent = "讀不到歷史資料"; });
});
const cv = $("#chart");
cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); scrub(e); });
cv.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") scrub(e); });
cv.addEventListener("pointerup", endScrub); cv.addEventListener("pointercancel", endScrub);
$("#cvTwd").addEventListener("input", () => convert("twd"));
$("#cvFx").addEventListener("input", () => convert("fx"));
// 下滑關閉
for (const sh of document.querySelectorAll(".sheet")) {
  let y0 = null;
  sh.addEventListener("touchstart", e => { y0 = sh.scrollTop <= 0 && !e.target.closest("canvas,.drag,input") ? e.touches[0].clientY : null; }, {passive:true});
  sh.addEventListener("touchend", e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 110) { closeSheets(); renderHome(); } y0 = null; });
}
window.addEventListener("resize", () => { renderHome(); if (!$("#detail").hidden) renderDetail(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadRecent(true); });
setInterval(() => { if (!document.hidden) { loadFut(); if (!$("#detail").hidden && D.ccy === "TXF" && D.range === "1D") loadIntraday().then(renderDetail); } }, 30000);

renderHome();
loadRecent();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
