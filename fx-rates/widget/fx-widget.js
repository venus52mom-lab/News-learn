// 匯率小工具（給 iPhone 的 Scriptable App 用）
// 1. App Store 安裝免費的「Scriptable」
// 2. 新增腳本、貼上本檔全部內容，把下面 SITE 改成你的網址
// 3. 回桌面長按 → 加入小工具 → Scriptable（中或大）→ 編輯小工具 → Script 選這個腳本
const SITE = "https://venus52mom-lab.github.io/News-learn/fx-rates/";
const LIST = ["JPY", "USD", "AUD", "THB", "KRW"];   // 想顯示的幣別
const RATE = "cs";        // cs 現金賣出 / ss 即期賣出 / cb 現金買入 / sb 即期買入
const UP = new Color("#ff3b30"), DOWN = new Color("#30d158"), GREY = new Color("#8e8e93");
const NAME = {USD:"美金",HKD:"港幣",GBP:"英鎊",AUD:"澳幣",CAD:"加拿大幣",SGD:"新加坡幣",CHF:"瑞士法郎",JPY:"日圓",ZAR:"南非幣",SEK:"瑞典幣",NZD:"紐元",THB:"泰銖",PHP:"菲國比索",IDR:"印尼盾",EUR:"歐元",KRW:"韓元",VND:"越南盾",MYR:"馬來幣",CNY:"人民幣"};
const COL = {cb:1,cs:2,sb:3,ss:4}, FB = {cs:["cs","ss"],ss:["ss","cs"],cb:["cb","sb"],sb:["sb","cb"]};
const pick = r => { for (const k of FB[RATE]) if (r[COL[k]]) return r[COL[k]]; return null; };
const fmt = v => v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v >= 0.1 ? v.toFixed(4) : v.toFixed(5);

function spark(vals, color) {
  const W = 120, H = 30, dc = new DrawContext(); dc.size = new Size(W, H); dc.opaque = false; dc.respectScreenScale = true;
  const lo = Math.min(...vals), hi = Math.max(...vals) || 1, n = vals.length;
  const p = new Path();
  vals.forEach((v, i) => { const pt = new Point(i/(n-1)*W, 2 + (hi-v)/((hi-lo)||1)*(H-4)); i ? p.addLine(pt) : p.move(pt); });
  dc.addPath(p); dc.setStrokeColor(color); dc.setLineWidth(1.5); dc.strokePath();
  return dc.getImage();
}

const w = new ListWidget();
w.backgroundColor = new Color("#1c1c1e");
w.setPadding(12, 14, 12, 14);
w.url = SITE;
try {
  const data = await new Request(SITE + "data/recent.json").loadJSON();
  const since = new Date(); since.setMonth(since.getMonth() - 3);
  const cut = since.toISOString().slice(0,10).replace(/-/g, "");
  const size = config.widgetFamily || "large";
  const max = size === "small" ? 3 : size === "medium" ? 4 : 7;
  for (const c of LIST.slice(0, max)) {
    const rows = (data.rates[c] || []).filter(r => pick(r));
    if (rows.length < 2) continue;
    const vals = rows.filter(r => r[0] >= cut).map(pick);
    const last = pick(rows[rows.length-1]), prev = pick(rows[rows.length-2]);
    const ch = (last - prev) / prev * 100;
    const col = ch > 0 ? UP : ch < 0 ? DOWN : GREY;
    const s = w.addStack(); s.centerAlignContent();
    const l = s.addStack(); l.layoutVertically(); l.size = new Size(size === "small" ? 50 : 70, 0);
    const t = l.addText(c); t.font = Font.boldSystemFont(14); t.textColor = Color.white();
    if (size !== "small") { const d = l.addText(NAME[c] || ""); d.font = Font.systemFont(10); d.textColor = GREY; }
    if (size !== "small") { s.addSpacer(6); const im = s.addImage(spark(vals, vals[vals.length-1] >= vals[0] ? UP : DOWN)); im.imageSize = new Size(110, 26); }
    s.addSpacer();
    const r = s.addStack(); r.layoutVertically();
    const pv = r.addText(fmt(last)); pv.font = Font.semiboldMonospacedSystemFont(13); pv.textColor = Color.white(); pv.rightAlignText();
    const pc = r.addText((ch > 0 ? "+" : "") + ch.toFixed(2) + "%"); pc.font = Font.boldSystemFont(11); pc.textColor = col; pc.rightAlignText();
    w.addSpacer(5);
  }
  w.addSpacer();
  const f = w.addText("臺灣銀行・更新 " + data.updated.slice(5)); f.font = Font.systemFont(9); f.textColor = GREY;
} catch (e) {
  const t = w.addText("讀不到資料：" + e); t.font = Font.systemFont(11); t.textColor = GREY;
}
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w); else await w.presentLarge();
Script.complete();
