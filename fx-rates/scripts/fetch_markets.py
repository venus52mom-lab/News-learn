#!/usr/bin/env python3
"""目錄（catalog.json）裡的所有市場項目：每小時存一份給 App。
有鉅亨網代號的項目，App 會在手機上再即時更新；沒有的就靠這份。
來源：Yahoo 批次（spark，一次 15 個代號）→ 抓不到的再用鉅亨網。

輸出：
  data/markets.json   每個項目：最新報價、近 3 個月日線、今天的走勢
  data/week.json      每個項目：近 5 個交易日 30 分鐘走勢（選「1週」時才讀）
  data/mkt/{ID}.json  完整日線歷史 [[YYYYMMDD, 收盤], ...]
"""
import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
APP = os.path.join(ROOT, "..")
MKT = os.path.join(ROOT, "mkt")
TPE = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0"}
LOG = []
FULL_PER_RUN = 25          # 每次最多替幾個新項目抓完整歷史（避免被 Yahoo 限流）


def get(url, tries=2):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            LOG.append({"url": url[:110], "error": str(e)[:100]})
            time.sleep(3 * (i + 1))
    return None


def yq(sym):
    return urllib.parse.quote(sym, safe="=^")


def spark(symbols, q):
    """Yahoo 批次：{代號: (meta, [(ts, close)])}"""
    out = {}
    for i in range(0, len(symbols), 15):
        part = symbols[i:i + 15]
        j = None
        for host in ("query1", "query2"):
            j = get(f"https://{host}.finance.yahoo.com/v7/finance/spark?symbols={','.join(yq(s) for s in part)}&{q}")
            if j:
                break
        try:
            for r in j["spark"]["result"]:
                x = r["response"][0]
                pts = [(t, c) for t, c in zip(x.get("timestamp") or [], x["indicators"]["quote"][0].get("close") or []) if c]
                out[r["symbol"]] = (x["meta"], pts)
        except Exception as e:  # noqa: BLE001
            LOG.append({"spark": ",".join(part)[:80], "error": str(e)[:80]})
        time.sleep(1)
    return out


def chart(sym, q):
    for host in ("query1", "query2"):
        j = get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{yq(sym)}{q}")
        try:
            return j["chart"]["result"][0]
        except Exception:  # noqa: BLE001
            continue
    return None


def day_key(ts, off):
    return dt.datetime.fromtimestamp(ts + off, dt.timezone.utc).strftime("%Y%m%d")


def thin(pts, n):
    if len(pts) <= n:
        return pts
    step = len(pts) / n
    out = [pts[int(i * step)] for i in range(n)]
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def full_history(sym):
    daily = {}
    for q in ("?period1=0&period2=9999999999&interval=1d", "?range=max&interval=1d", "?range=10y&interval=1d"):
        r = chart(sym, q)
        if r:
            off = r["meta"].get("gmtoffset", 0)
            for t, c in zip(r.get("timestamp") or [], r["indicators"]["quote"][0].get("close") or []):
                if c:
                    daily[day_key(t, off)] = round(c, 4)
        if len(daily) > 300:
            break
        time.sleep(1)
    return daily


def cnyes(sym):
    base = "https://ws.api.cnyes.com/ws/api/v1"
    j = get(f"{base}/quote/quotes/{sym}")
    try:
        q = j["data"][0]
        return {"last": q["6"], "chg": q.get("11"), "pct": q.get("56"), "prev": q.get("21"), "open": q.get("19"),
                "high": q.get("12"), "low": q.get("13"), "time": q.get("200007"), "src": "鉅亨網"}
    except Exception:  # noqa: BLE001
        return None


def main():
    cat = json.load(open(os.path.join(APP, "catalog.json"), encoding="utf-8"))["items"]
    os.makedirs(MKT, exist_ok=True)
    try:
        old = json.load(open(os.path.join(ROOT, "markets.json"), encoding="utf-8")).get("items", {})
    except Exception:  # noqa: BLE001
        old = {}
    tried_p = os.path.join(ROOT, "fullhist_tried.json")   # 抓過完整歷史但 Yahoo 沒有的（例如滬深300）
    try:
        tried = json.load(open(tried_p, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        tried = {}
    syms = [c["y"] for c in cat if c.get("y")]
    today = spark(syms, "range=1d&interval=5m")
    week = spark(syms, "range=5d&interval=30m")
    mo3 = spark(syms, "range=3mo&interval=1d")
    out, wk, full_done = {}, {}, 0
    for c in cat:
        mid, ysym = c["id"], c.get("y")
        p = os.path.join(MKT, f"{mid}.json")
        try:
            hist = {r[0]: r[1] for r in json.load(open(p, encoding="utf-8"))}
        except Exception:  # noqa: BLE001
            hist = {}
        quote, intra = None, []
        if ysym in today:
            m, pts = today[ysym]
            last = m.get("regularMarketPrice") or (pts[-1][1] if pts else None)
            prev = m.get("previousClose") or m.get("chartPreviousClose")
            if last:
                quote = {"last": round(last, 4), "prev": prev, "chg": round(last - prev, 4) if prev else None,
                         "pct": round((last - prev) / prev * 100, 2) if prev else None,
                         "high": m.get("regularMarketDayHigh"), "low": m.get("regularMarketDayLow"),
                         "time": m.get("regularMarketTime"), "src": "Yahoo"}
                intra = [[t, round(v, 4)] for t, v in thin(pts, 90)]
                if pts:
                    quote["open"] = round(pts[0][1], 4)
        if not quote and c.get("cn"):
            quote = cnyes(c["cn"])
        if ysym in mo3:
            m, pts = mo3[ysym]
            off = m.get("gmtoffset", 0)
            for t, v in pts:
                hist[day_key(t, off)] = round(v, 4)
        if ysym and len(hist) < 300 and full_done < FULL_PER_RUN and mid not in tried:
            hist.update(full_history(ysym))
            full_done += 1
            if len(hist) < 300:
                tried[mid] = 1
        if hist:
            with open(p, "w", encoding="utf-8") as f:
                json.dump([[k, hist[k]] for k in sorted(hist)], f, separators=(",", ":"))
        if ysym in week:
            wk[mid] = [[t, round(v, 4)] for t, v in thin(week[ysym][1], 130)]
        if quote:
            out[mid] = {"quote": quote, "daily": [[k, hist[k]] for k in sorted(hist)][-66:], "intra": intra}
        elif mid in old:
            out[mid] = old[mid]          # 這次抓不到就留上次的
    now = dt.datetime.now(TPE).strftime("%Y-%m-%d %H:%M")
    with open(os.path.join(ROOT, "markets.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "items": out, "log": LOG[-15:]}, f, ensure_ascii=False, separators=(",", ":"))
    if wk:
        with open(os.path.join(ROOT, "week.json"), "w", encoding="utf-8") as f:
            json.dump({"updated": now, "items": wk}, f, separators=(",", ":"))
    with open(tried_p, "w", encoding="utf-8") as f:
        json.dump(tried, f)
    print(len(out), "items;", full_done, "full histories;", len(LOG), "errors")


if __name__ == "__main__":
    main()
