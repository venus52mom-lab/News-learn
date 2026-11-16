#!/usr/bin/env python3
"""股市指數、美元指數、比特幣、海外期貨：每小時存一份給 App。
手機上有鉅亨網代號的項目會再即時更新；沒有的（日經、VIX、比特幣…）就靠這份。
來源順序：Yahoo（query1 → query2）→ 鉅亨網。

輸出：
  data/markets.json      每個項目的最新報價、近 130 天日線、今天的 5 分鐘走勢
  data/mkt/{ID}.json     完整日線歷史 [[YYYYMMDD, 收盤], ...]
"""
import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MKT = os.path.join(ROOT, "mkt")
TPE = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0"}
# ID: (Yahoo 代號, 鉅亨網代號)
ITEMS = {
    "DJI": ("^DJI", "GI:DJI:INDEX"), "TWII": ("^TWII", "TWS:TSE01:INDEX"), "SPX": ("^GSPC", "GI:INX:INDEX"),
    "IXIC": ("^IXIC", "GI:IXIC:INDEX"), "SOX": ("^SOX", "GI:SOX:INDEX"), "N225": ("^N225", None),
    "HSI": ("^HSI", "GI:HSI:INDEX"), "CSI300": ("000300.SS", None), "KOSPI": ("^KS11", "GI:KOSPI:INDEX"),
    "EU500": ("EU500.AS", None), "VIX": ("^VIX", None), "UTEN": ("UTEN", "USS:UTEN:STOCK"),
    "DXY": ("DX-Y.NYB", "GI:DXY:INDEX"), "BTC": ("BTC-USD", None), "NQ": ("NQ=F", None),
    "Z3N": ("Z3N=F", None), "GC": ("GC=F", None), "SI": ("SI=F", None),
}
LOG = []


def get(url):
    for i in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            LOG.append({"url": url[:100], "error": str(e)[:120]})
            time.sleep(2)
    return None


def yahoo(sym, q):
    for host in ("query1", "query2"):
        j = get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym, safe='=^')}{q}")
        try:
            return j["chart"]["result"][0]
        except Exception:  # noqa: BLE001
            continue
    return None


def local_day(ts, off):
    return dt.datetime.fromtimestamp(ts + off, dt.timezone.utc).strftime("%Y%m%d")


def from_yahoo(sym, full):
    r = yahoo(sym, "?range=1d&interval=5m")
    if not r:
        return None
    m = r["meta"]
    off = m.get("gmtoffset", 0)
    last = m.get("regularMarketPrice")
    prev = m.get("previousClose") or m.get("chartPreviousClose")
    quote = {"last": last, "prev": prev, "chg": round(last - prev, 4) if last and prev else None,
             "pct": round((last - prev) / prev * 100, 2) if last and prev else None,
             "high": m.get("regularMarketDayHigh"), "low": m.get("regularMarketDayLow"),
             "time": m.get("regularMarketTime"), "src": "Yahoo"}
    q = r["indicators"]["quote"][0]
    intra = [[t, c] for t, c in zip(r.get("timestamp") or [], q.get("close") or []) if c]
    if intra:
        quote["open"] = next((o for o in q.get("open") or [] if o), None)
    time.sleep(0.8)
    w = yahoo(sym, "?range=5d&interval=30m")
    week = []
    if w:
        week = [[t, round(c, 4)] for t, c in zip(w.get("timestamp") or [], w["indicators"]["quote"][0].get("close") or []) if c]
    time.sleep(0.8)
    daily = {}
    tries = ["?period1=0&period2=9999999999&interval=1d", "?range=max&interval=1d", "?range=10y&interval=1d", "?range=5y&interval=1d"] if full else ["?range=3mo&interval=1d"]
    for q in tries:                # 有些代號不接受「全部歷史」，就改要 max／10 年／5 年
        d = yahoo(sym, q)
        if d:
            off = d["meta"].get("gmtoffset", off)
            for t, c in zip(d.get("timestamp") or [], d["indicators"]["quote"][0].get("close") or []):
                if c:
                    daily[local_day(t, off)] = round(c, 4)
        if len(daily) > 300 or not full:
            break
        time.sleep(0.8)
    return {"quote": quote, "daily": daily, "intra": intra, "week": week}


def from_cnyes(sym):
    base = "https://ws.api.cnyes.com/ws/api/v1"
    j = get(f"{base}/quote/quotes/{sym}")
    try:
        q = j["data"][0]
        quote = {"last": q["6"], "chg": q.get("11"), "pct": q.get("56"), "prev": q.get("21"), "open": q.get("19"),
                 "high": q.get("12"), "low": q.get("13"), "time": q.get("200007"), "src": "鉅亨網"}
    except Exception:  # noqa: BLE001
        return None
    now = int(time.time())
    h = get(f"{base}/charting/history?symbol={sym}&resolution=D&from={now}&to=0")
    daily = {}
    try:
        for t, c in zip(h["data"]["t"], h["data"]["c"]):
            if c:
                daily[dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y%m%d")] = c
    except Exception:  # noqa: BLE001
        pass
    return {"quote": quote, "daily": daily, "intra": [], "week": []}


def main():
    os.makedirs(MKT, exist_ok=True)
    out = {"updated": dt.datetime.now(TPE).strftime("%Y-%m-%d %H:%M"), "items": {}}
    try:
        old = json.load(open(os.path.join(ROOT, "markets.json"), encoding="utf-8")).get("items", {})
    except Exception:  # noqa: BLE001
        old = {}
    for mid, (ysym, csym) in ITEMS.items():
        p = os.path.join(MKT, f"{mid}.json")
        try:
            hist = {r[0]: r[1] for r in json.load(open(p, encoding="utf-8"))}
        except Exception:  # noqa: BLE001
            hist = {}
        res = from_yahoo(ysym, full=len(hist) < 300)
        if (not res or not res["quote"].get("last")) and csym:
            res = from_cnyes(csym)
        if res:
            hist.update(res["daily"])
            with open(p, "w", encoding="utf-8") as f:
                json.dump([[k, hist[k]] for k in sorted(hist)], f, separators=(",", ":"))
            out["items"][mid] = {"quote": res["quote"], "daily": [[k, hist[k]] for k in sorted(hist)][-130:],
                                 "intra": res["intra"], "week": res.get("week", [])}
        elif mid in old:
            out["items"][mid] = old[mid]          # 這次抓不到就留上次的
        time.sleep(0.8)
    out["log"] = LOG[-15:]
    with open(os.path.join(ROOT, "markets.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(len(out["items"]), "items;", len(LOG), "errors")


if __name__ == "__main__":
    main()
