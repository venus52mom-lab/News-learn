#!/usr/bin/env python3
"""台指期（全日盤）備援資料：App 平常直接向鉅亨網拿即時報價；
鉅亨網掛掉時改讀這裡存的 data/txf.json。
來源順序：鉅亨網 → 期交所即時行情（夜盤／日盤）。"""
import datetime as dt
import json
import os
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
TPE = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Accept": "application/json"}
CNYES = "https://ws.api.cnyes.com/ws/api/v1"
LOG = []


def get(url, body=None):
    for i in range(2):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                         headers={**UA, **({"Content-Type": "application/json"} if body else {})})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            LOG.append({"url": url[:90], "error": str(e)[:150]})
            time.sleep(2)
    return None


def day_of(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y%m%d")


def from_cnyes():
    q = get(f"{CNYES}/quote/quotes/TWF:TXF:FUTURES")
    try:
        q = q["data"][0]
        quote = {"last": q["6"], "chg": q["11"], "pct": q["56"], "ref": q["21"], "open": q.get("19"),
                 "high": q.get("12"), "low": q.get("13"), "time": q["200007"], "sessions": q.get("800003")}
    except Exception:  # noqa: BLE001
        return None, None
    now = int(time.time())
    h = get(f"{CNYES}/charting/history?symbol=TWF:TXF:FUTURES&resolution=D&quote=1&from={now}&to=0")
    daily = {}
    try:
        d = h["data"]
        for t, c in zip(d["t"], d["c"]):
            if c:
                daily[day_of(t)] = c
    except Exception:  # noqa: BLE001
        pass
    return quote, daily


def from_taifex():
    """期交所即時行情：夜盤時段（MarketType=1）有價就用夜盤，否則日盤。"""
    best = None
    for mt in ("1", "0"):
        j = get("https://mis.taifex.com.tw/futures/api/getQuoteList",
                {"MarketType": mt, "SymbolType": "F", "KindID": "1", "CID": "TXF", "ExpireMonth": "",
                 "RowSize": "全部", "PageNo": "", "SortColumn": "", "AscDesc": "A"})
        try:
            rows = [r for r in j["RtData"]["QuoteList"] if r["SymbolID"].startswith("TXF") and r["SymbolID"].endswith("-F")
                    and r.get("CLastPrice")]
        except Exception:  # noqa: BLE001
            continue
        if rows:
            r = rows[0]   # 近月
            last, ref = float(r["CLastPrice"]), float(r["CRefPrice"] or 0)
            tm = dt.datetime.strptime(r["CDate"] + r["CTime"].zfill(6), "%Y%m%d%H%M%S").replace(tzinfo=TPE)
            best = {"last": last, "ref": ref, "chg": round(last - ref, 2) if ref else None,
                    "pct": round((last - ref) / ref * 100, 2) if ref else None,
                    "open": float(r["COpenPrice"] or 0) or None, "high": float(r["CHighPrice"] or 0) or None,
                    "low": float(r["CLowPrice"] or 0) or None, "time": int(tm.timestamp()), "session": "夜盤" if mt == "1" else "日盤"}
            break
    return best


def main():
    p = os.path.join(ROOT, "txf.json")
    try:
        old = json.load(open(p, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        old = {}
    daily = {r[0]: r[1] for r in old.get("daily", [])}
    quote, d2 = from_cnyes()
    src = "鉅亨網"
    if d2:
        daily.update(d2)
    if not quote:
        quote, src = from_taifex(), "期交所"
    if quote:
        # 交易日：15:00 以後的夜盤算隔天
        t = dt.datetime.fromtimestamp(quote["time"], TPE)
        td = (t + dt.timedelta(days=1)) if t.hour >= 15 else t
        while td.weekday() >= 5:
            td += dt.timedelta(days=1)
        daily[td.strftime("%Y%m%d")] = quote["last"]
    out = {"updated": dt.datetime.now(TPE).strftime("%Y-%m-%d %H:%M"), "source": src if quote else old.get("source"),
           "quote": quote or old.get("quote"), "daily": [[k, daily[k]] for k in sorted(daily)], "log": LOG[-10:]}
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(src, quote and quote["last"], len(daily))


if __name__ == "__main__":
    main()
