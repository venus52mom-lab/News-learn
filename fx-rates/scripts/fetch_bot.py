#!/usr/bin/env python3
"""抓取台灣銀行牌告匯率，存成 JSON 給 App 使用。

用法：
  python scripts/fetch_bot.py update      # 每天/盤中：抓最近 7 天收盤 + 目前即時牌價
  python scripts/fetch_bot.py backfill    # 一次性：往回抓完整歷史（可重跑，會從上次停下的地方接續）

資料格式 data/hist/{CCY}.json：
  [["YYYYMMDD", 現金買入, 現金賣出, 即期買入, 即期賣出], ...]  （無報價為 null）
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.request

BASE = "https://rate.bot.com.tw/xrt/flcsv/0/"
CCYS = ["USD", "HKD", "GBP", "AUD", "CAD", "SGD", "CHF", "JPY", "ZAR", "SEK",
        "NZD", "THB", "PHP", "IDR", "EUR", "KRW", "VND", "MYR", "CNY"]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
HIST = os.path.join(ROOT, "hist")
TPE = dt.timezone(dt.timedelta(hours=8))
RECENT_DAYS = 120          # 首頁縮圖用：約 4 個月
UA = {"User-Agent": "Mozilla/5.0 (fx-rates personal app)"}


def today_tpe():
    return dt.datetime.now(TPE).date()


DIAG = []


def http_get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                raw = r.read()
                DIAG.append({"url": url, "status": r.status, "bytes": len(raw), "head": raw[:160].decode("utf-8", "replace")})
            for enc in ("utf-8-sig", "big5", "cp950"):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    pass
            return raw.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            DIAG.append({"url": url, "error": str(e)[:200]})
            print(f"  ! {url} ({e}), retry {i + 1}", file=sys.stderr)
            time.sleep(2 * (i + 1))
    return ""


def num(x):
    try:
        v = float(x)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def parse_csv(text, default_date=None):
    """回傳 [(date, ccy, cb, cs, sb, ss)]。用「本行買入/本行賣出」位置定位欄位，不怕欄位順序變動。"""
    out = []
    for rec in csv.reader(io.StringIO(text)):
        rec = [c.strip() for c in rec]
        if "本行買入" not in rec or "本行賣出" not in rec:
            continue
        b, s = rec.index("本行買入"), rec.index("本行賣出")
        ccy = next((c for c in rec if c in CCYS), None)
        if not ccy:
            m = next((re.search(r"\(([A-Z]{3})\)", c) for c in rec if re.search(r"\(([A-Z]{3})\)", c)), None)
            ccy = m.group(1) if m else None
        if not ccy:
            continue
        d = next((c.replace("/", "") for c in rec if re.fullmatch(r"\d{8}|\d{4}/\d{2}/\d{2}", c)), default_date)
        if not d:
            continue
        row = (d, ccy, num(rec[b + 1]), num(rec[s + 1]), num(rec[b + 2]), num(rec[s + 2]))
        if any(v is not None for v in row[2:]):
            out.append(row)
    return out


def load_hist(ccy):
    p = os.path.join(HIST, f"{ccy}.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return {r[0]: r for r in json.load(f)}
    return {}


def save_hist(ccy, rows):
    os.makedirs(HIST, exist_ok=True)
    data = [rows[k] for k in sorted(rows)]
    with open(os.path.join(HIST, f"{ccy}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


def merge(store, parsed):
    changed = 0
    for d, ccy, cb, cs, sb, ss in parsed:
        row = [d, cb, cs, sb, ss]
        h = store.setdefault(ccy, {})
        if h.get(d) != row:
            h[d] = row
            changed += 1
    return changed


def write_recent(store, note="", source="bot"):
    cutoff = (today_tpe() - dt.timedelta(days=RECENT_DAYS)).strftime("%Y%m%d")
    out = {"updated": dt.datetime.now(TPE).strftime("%Y-%m-%d %H:%M"), "source": source, "yv": 3, "note": note, "rates": {}}
    for ccy in CCYS:
        h = store.get(ccy) or {}
        rows = [h[k] for k in sorted(h) if k >= cutoff]
        if rows:
            out["rates"][ccy] = rows
            out.setdefault("first", {})[ccy] = min(h)
    with open(os.path.join(ROOT, "recent.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


def load_all():
    return {c: load_hist(c) for c in CCYS}


def write_diag(extra=None):
    d = {"time": dt.datetime.now(TPE).strftime("%Y-%m-%d %H:%M"), "log": DIAG[-12:]}
    if extra:
        d.update(extra)
    with open(os.path.join(ROOT, "debug.json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def probe():
    """診斷：看看從 GitHub 的主機能不能連到各個來源。"""
    for u in ["https://rate.bot.com.tw/xrt/flcsv/0/day",
              "https://rate.bot.com.tw/xrt/fltxt/0/day",
              "https://govdata.bot.com.tw/v3/api-docs",
              "https://query1.finance.yahoo.com/v8/finance/chart/JPYTWD=X?range=5d&interval=1d"]:
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
                raw = r.read()
                DIAG.append({"probe": u, "status": r.status, "bytes": len(raw), "head": raw[:3000].decode("utf-8", "replace")})
        except Exception as e:  # noqa: BLE001
            DIAG.append({"probe": u, "error": str(e)[:200]})


YQ = "https://query1.finance.yahoo.com/v8/finance/chart/"


def is_challenge(text):
    return (not text) or text.lstrip().lower().startswith("<!doctype html") or "<html" in text[:200].lower()


def yahoo_series(sym, full):
    q = "?period1=0&period2=9999999999&interval=1d" if full else "?range=1mo&interval=1d"
    txt = http_get(YQ + sym + q)
    try:
        res = json.loads(txt)["chart"]["result"][0]
    except Exception:  # noqa: BLE001
        return {}
    off = res["meta"].get("gmtoffset", 0)
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    out = {}
    for t, c in zip(ts, closes):
        if c and c > 0:
            out[dt.datetime.fromtimestamp(t + off, dt.timezone.utc).strftime("%Y%m%d")] = c
    return out


def yahoo_ccy(ccy, full):
    """回傳 {date: 1 外幣 = ? 台幣}。先試直接匯率，沒有就用美金交叉換算。"""
    d = yahoo_series(f"{ccy}TWD=X", full)
    if len(d) >= 5:
        return d
    usd_twd = yahoo_series("TWD=X", full)          # 1 USD = ? TWD
    if ccy == "USD":
        return usd_twd
    usd_ccy = yahoo_series(f"{ccy}=X", full)        # 1 USD = ? CCY
    cross = {k: usd_twd[k] / v for k, v in usd_ccy.items() if k in usd_twd and v}
    return cross if len(cross) >= 5 else d


def cmd_update_yahoo(store):
    """台銀擋掉時的備援：Yahoo 市場匯率（中間價，非台銀牌價）。"""
    changed = 0
    for ccy in CCYS:
        h = store.setdefault(ccy, {})
        full = len(h) < 200
        rows = yahoo_ccy(ccy, full)
        for d, v in rows.items():
            v = float(f"{v:.6g}")
            row = [d, v, v, v, v]
            if h.get(d) != row:
                h[d] = row
                changed += 1
        time.sleep(0.3)
    return changed


def current_source():
    p = os.path.join(ROOT, "recent.json")
    try:
        with open(p, encoding="utf-8") as f:
            r = json.load(f)
            return r.get("source", "") + str(r.get("yv", ""))
    except Exception:  # noqa: BLE001
        return ""


def cmd_update():
    store = load_all()
    t = today_tpe()
    changed = 0
    test = http_get(BASE + "day")
    if is_challenge(test):
        print("臺灣銀行擋掉了（回傳驗證頁），改用 Yahoo 市場匯率")
        if current_source() != "yahoo3":
            store = {c: {} for c in CCYS}   # 不混用兩種來源
        changed = cmd_update_yahoo(store)
        for c in CCYS:
            if store.get(c):
                save_hist(c, store[c])
        write_recent(store, source="yahoo")
        probe()
        write_diag({"source": "yahoo", "rows_changed": changed})
        print(f"update done (yahoo), {changed} rows changed")
        return
    if current_source().startswith("yahoo"):
        store = {c: {} for c in CCYS}
    # 1) 最近 7 天的收盤牌價（一次請求含全部幣別）
    for i in range(7, -1, -1):
        d = t - dt.timedelta(days=i)
        if d.weekday() >= 5:
            continue
        txt = http_get(BASE + d.strftime("%Y-%m-%d"))
        changed += merge(store, parse_csv(txt, d.strftime("%Y%m%d")))
        time.sleep(0.5)
    # 2) 目前即時牌價：跟最後一筆不同才當作今天的暫時資料
    live = parse_csv(http_get(BASE + "day"), t.strftime("%Y%m%d"))
    if t.weekday() < 5:
        fresh = []
        for row in live:
            h = store.get(row[1]) or {}
            if h:
                last = h[max(h)]
                if last[0] < row[0] and list(row[2:]) == last[1:]:
                    continue  # 假日：牌價沒變，不新增
            fresh.append(row)
        changed += merge(store, fresh)
    for c in CCYS:
        if store.get(c):
            save_hist(c, store[c])
    write_recent(store)
    if not any(store.values()):
        probe()
    write_diag({"rows_changed": changed, "ccys_with_data": [c for c in CCYS if store.get(c)]})
    print(f"update done, {changed} rows changed")


def month_iter(start, stop):
    y, m = start
    while (y, m) >= stop:
        yield y, m
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)


def cmd_backfill(max_minutes=330):
    """先試「單一幣別月份 CSV」（快），失敗再改用「逐日全幣別 CSV」（慢但確定可用）。"""
    if is_challenge(http_get(BASE + "day")):
        print("臺灣銀行擋掉了，改用 Yahoo（更新時就會一次抓完整歷史）")
        return cmd_update()
    t0 = time.time()
    store = load_all()
    t = today_tpe()

    probe = parse_csv(http_get(f"{BASE}{t:%Y-%m}/USD"))
    if probe:
        print("使用月份 CSV 模式")
        for ccy in CCYS:
            empty = 0
            for y, m in month_iter((t.year, t.month), (1990, 1)):
                key = f"{y:04d}{m:02d}"
                h = store.get(ccy) or {}
                if any(k.startswith(key) for k in h) and (y, m) != (t.year, t.month):
                    empty = 0
                    continue  # 已經有了
                rows = parse_csv(http_get(f"{BASE}{y:04d}-{m:02d}/{ccy}"))
                rows = [r for r in rows if r[1] == ccy]
                merge(store, rows)
                empty = 0 if rows else empty + 1
                if empty >= 6:
                    break
                time.sleep(0.4)
                if time.time() - t0 > max_minutes * 60:
                    break
            print(f"  {ccy}: {len(store.get(ccy) or {})} 筆，最早 {min(store[ccy]) if store.get(ccy) else '-'}")
            save_hist(ccy, store.get(ccy) or {})
            if time.time() - t0 > max_minutes * 60:
                print("時間到，先存檔；再跑一次 backfill 會接續")
                break
    else:
        print("月份 CSV 不可用，改用逐日模式")
        have = set().union(*[set(h) for h in store.values()]) if any(store.values()) else set()
        d, empty = t, 0
        while empty < 60 and time.time() - t0 < max_minutes * 60:
            if d.weekday() < 5:
                key = d.strftime("%Y%m%d")
                if key in have:
                    empty = 0
                else:
                    rows = parse_csv(http_get(BASE + d.strftime("%Y-%m-%d")), key)
                    merge(store, rows)
                    empty = 0 if rows else empty + 1
                    time.sleep(0.4)
                    if d.day == 1:
                        print(f"  {key} …")
                        for c in CCYS:
                            if store.get(c):
                                save_hist(c, store[c])
            d -= dt.timedelta(days=1)
        for c in CCYS:
            if store.get(c):
                save_hist(c, store[c])
    write_recent(store)
    print("backfill done")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "update"
    {"update": cmd_update, "backfill": cmd_backfill}[mode]()
