"use strict";
/* ===== 基本資料 ===== */
const CUR = {
  USD:["美金","🇺🇸"],HKD:["港幣","🇭🇰"],GBP:["英鎊","🇬🇧"],AUD:["澳幣","🇦🇺"],CAD:["加拿大幣","🇨🇦"],
  SGD:["新加坡幣","🇸🇬"],CHF:["瑞士法郎","🇨🇭"],JPY:["日圓","🇯🇵"],ZAR:["南非幣","🇿🇦"],SEK:["瑞典幣","🇸🇪"],
  NZD:["紐元","🇳🇿"],THB:["泰銖","🇹🇭"],PHP:["菲國比索","🇵🇭"],IDR:["印尼盾","🇮🇩"],EUR:["歐元","🇪🇺"],
  KRW:["韓元","🇰🇷"],VND:["越南盾","🇻🇳"],MYR:["馬來幣","🇲🇾"],CNY:["人民幣","🇨🇳"]
};
const RATE_NAME = {cb:"現金買入",cs:"現金賣出",sb:"即期買入",ss:"即期賣出"};
const COL = {cb:1,cs:2,sb:3,ss:4};
const FALLBACK = {cs:["cs","ss"],ss:["ss","cs"],cb:["cb","sb"],sb:["sb","cb"]};

/* ===== 設定（存在手機本機） ===== */
const DEF = {list:["JPY","USD","AUD","THB","KRW"],rate:"cs",dir:"n",color:"tw",data:"",badge:"d"};
let S = {...DEF};
try { S = {...DEF, ...JSON.parse(localStorage.getItem("fx-settings")||"{}")}; } catch(e) {}
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
const disp = v => v == null ? null : (S.dir === "n" ? v : 1000 / v);
function series(rows) {
  const out = [];
  for (const r of rows || []) { const v = disp(pick(r)); if (v) out.push([r[0], v]); }
  return out;
}
function fmt(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = S.dir === "n"
    ? (a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : 6)
    : (a >= 10000 ? 0 : a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 3 : 4);
  return v.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
}
const pct = (a, b) => (b - a) / a * 100;
const ymd = s => `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
const toDate = s => new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
function cutoff(range) {
  if (range === "ALL") return "0";
  const d = new Date();
  if (range === "3M") d.setMonth(d.getMonth()-3);
  if (range === "1Y") d.setFullYear(d.getFullYear()-1);
  if (range === "3Y") d.setFullYear(d.getFullYear()-3);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
const unitLabel = ccy => S.dir === "n" ? `1 ${ccy} → 台幣` : `1000 台幣 → ${ccy}`;

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
  $("#rateLabel").textContent = `${isYahoo() ? "市場匯率（Yahoo）" : "台灣銀行・" + RATE_NAME[S.rate]}${S.dir === "n" ? "" : "・每千台幣"}`;
  document.querySelector(".foot").textContent = isYahoo()
    ? "目前臺灣銀行網站擋掉自動抓取，暫用 Yahoo Finance 市場中間價（不是銀行買賣牌價，實際換匯會差一點）。縮圖為近 3 個月走勢，點右側數字可切換顯示。"
    : "資料來源：臺灣銀行牌告匯率。縮圖為近 3 個月走勢，點右側數字可切換顯示。";
  $("#updated").textContent = RECENT ? `更新 ${RECENT.updated.slice(5)}` : "";
  const ul = $("#list"); ul.innerHTML = "";
  if (!RECENT) { ul.append(el("li","empty","載入中…")); return; }
  if (!Object.keys(RECENT.rates || {}).length) { ul.append(el("li","empty","資料還沒抓到，請稍後再打開。")); return; }
  if (!S.list.length) { ul.append(el("li","empty","還沒有幣別，按右上「編輯」加入。")); return; }
  const c3 = cutoff("3M");
  for (const ccy of S.list) {
    const rows = RECENT.rates[ccy] || [];
    const all = series(rows), pts = all.filter(p => p[0] >= c3);
    const li = el("li","row");
    const last = all[all.length-1], prev = all[all.length-2];
    const [nm, flag] = CUR[ccy] || [ccy, ""];
    const fb = !isYahoo() && usedKey(rows) !== S.rate ? `・${RATE_NAME[usedKey(rows)]}` : "";
    li.innerHTML = `<div><div class="name"><span class="flag">${flag}</span>${ccy}</div>
      <div class="desc">${nm}${fb}</div></div><canvas></canvas>
      <div class="right"><div class="price">${last ? fmt(last[1]) : "—"}</div><div class="badge"></div></div>`;
    const b = li.querySelector(".badge");
    let ch = null, txt = "—";
    if (last && prev && S.badge === "d") { ch = pct(prev[1], last[1]); txt = (ch>0?"+":"") + ch.toFixed(2) + "%"; }
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
  D.ccy = ccy; D.range = "3M";
  const [nm, flag] = CUR[ccy] || [ccy,""];
  $("#dTitle").textContent = `${flag} ${nm} ${ccy}`;
  document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.r === "3M"));
  openSheet("#detail");
  renderDetail();
  loadHist(ccy).then(() => { if (D.ccy === ccy) renderDetail(); }).catch(() => {});
}
function rowsFor(ccy) { return HIST[ccy] || (RECENT && RECENT.rates[ccy]) || []; }

function renderDetail() {
  const ccy = D.ccy, rows = rowsFor(ccy), all = series(rows);
  const need = D.range !== "3M" && !HIST[ccy];
  $("#dLoading").hidden = !need;
  const pts = need ? [] : all.filter(p => p[0] >= cutoff(D.range));
  D.pts = pts;
  const k = usedKey(rows);
  $("#dSub").textContent = `${isYahoo() ? "市場匯率（Yahoo）" : "臺灣銀行・" + RATE_NAME[k]}・${unitLabel(ccy)}`;
  const cv = $("#chart");
  D.geo = drawLine(cv, thin(pts, Math.round(cv.clientWidth*2)), {baseline:true, axis:true, padR:58, padT:10, padB:10, lw:2});
  D.thin = thin(pts, Math.round(cv.clientWidth*2));
  showPoint(null);
  // 統計
  const st = $("#dStats"); st.innerHTML = "";
  if (pts.length) {
    const v = pts.map(p=>p[1]), hi = Math.max(...v), lo = Math.min(...v), avg = v.reduce((a,b)=>a+b,0)/v.length;
    const hiP = pts[v.indexOf(hi)], loP = pts[v.indexOf(lo)];
    const label = {"3M":"3個月","1Y":"1年","3Y":"3年","ALL":"全部"}[D.range];
    st.innerHTML = `<div class="stat"><span>${label}最高</span><b>${fmt(hi)}</b><span>${ymd(hiP[0])}</span></div>
      <div class="stat"><span>${label}最低</span><b>${fmt(lo)}</b><span>${ymd(loP[0])}</span></div>
      <div class="stat"><span>平均</span><b>${fmt(avg)}</b><span>${ymd(pts[0][0]).slice(0,7)} 起</span></div>`;
  }
  // 四種牌價
  const last = rows[rows.length-1], rq = $("#dRates"); rq.innerHTML = "";
  if (last && isYahoo()) rq.append(el("div","stat",`<span>市場中間價（1 ${ccy}）</span><b>${last[2]}</b><span>${ymd(last[0])}</span>`));
  else if (last) for (const kk of ["cs","ss","cb","sb"]) {
    const v = last[COL[kk]];
    rq.append(el("div","stat",`<span>${RATE_NAME[kk]}（1 ${ccy}）</span><b>${v ? v : "無報價"}</b><span>${ymd(last[0])}</span>`));
  }
  // 換算
  $("#cvFxLabel").textContent = `${CUR[ccy]?.[0]||ccy} ${ccy}`;
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
  drawLine($("#chart"), pts, {baseline:true, axis:true, padR:58, padT:10, padB:10, lw:2});
  const ctx = $("#chart").getContext("2d"), X = g.X(i), Y = g.Y(pts[i][1]);
  ctx.strokeStyle = "#8e8e93"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X,0); ctx.lineTo(X,g.H); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X,Y,4.5,0,7); ctx.fill();
  showPoint(i);
}
function endScrub() { if (D.geo) { drawLine($("#chart"), D.thin, {baseline:true, axis:true, padR:58, padT:10, padB:10, lw:2}); showPoint(null); } }

function curRate() { const rows = rowsFor(D.ccy); const l = rows[rows.length-1]; return l ? pick(l) : null; }
function convert(from) {
  const v = curRate(); const a = $("#cvTwd"), b = $("#cvFx");
  const n = s => parseFloat(String(s).replace(/,/g,""));
  if (!v) { $("#cvNote").textContent = "沒有報價"; return; }
  if (from === "twd") { const t = n(a.value); b.value = isFinite(t) ? (t / v).toLocaleString("en-US",{maximumFractionDigits: t/v >= 100 ? 0 : 2}) : ""; }
  else { const f = n(b.value); a.value = isFinite(f) ? Math.round(f * v).toLocaleString("en-US") : ""; }
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
  if (!HIST[D.ccy]) loadHist(D.ccy).then(renderDetail).catch(() => { $("#dLoading").textContent = "讀不到歷史資料"; });
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

renderHome();
loadRecent();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
