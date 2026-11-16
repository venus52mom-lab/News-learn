#!/usr/bin/env python3
"""抓銀行牌告匯率，存成 JSON 給 App 用。

臺灣銀行網站會擋自動抓取，所以改用：
  - 歷史（2016/11 ~ 2026/6/26）：比率網整理的臺灣銀行牌價走勢（每幣別 1 次請求）
  - 之後到昨天：比率網每日歷史頁裡的玉山銀行牌價（玉山沒有的幣別改用其他銀行）
  - 今天／即時：玉山銀行官網介面（一次請求含全部幣別）

用法：python fetch_bot.py update   （排程每 30 分鐘；第一次會自動補完整歷史）

資料 data/hist/{CCY}.json：[["YYYYMMDD", 現金買入, 現金賣出, 即期買入, 即期賣出, 銀行], ...]
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

CCYS = ["USD", "HKD", "GBP", "AUD", "CAD", "SGD", "CHF", "JPY", "ZAR", "SEK",
        "NZD", "THB", "PHP", "IDR", "EUR", "KRW", "VND", "MYR", "CNY"]
BANK_PREF = ["玉山銀行", "臺灣企銀", "第一銀行", "兆豐銀行", "永豐銀行", "國泰世華", "臺灣銀行"]
SHORT = {"玉山銀行": "玉山", "臺灣銀行": "台銀", "臺灣企銀": "台企銀", "第一銀行": "一銀",
         "兆豐銀行": "兆豐", "永豐銀行": "永豐", "國泰世華": "國泰"}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
HIST = os.path.join(ROOT, "hist")
TPE = dt.timezone(dt.timedelta(hours=8))
RECENT_DAYS = 120
DATA_VERSION = "bank1"
METALS = ["XAU", "XAG"]          # 黃金、白銀
OZ = 31.1034768                  # 1 金衡盎司 = 31.1 公克
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept-Language": "zh-TW,zh;q=0.9"}
ESUN = "https://www.esunbank.com/api/client/ExchangeRate/LastRateInfo?sc_lang=zh-TW"
ESUN_REF = "https://www.esunbank.com/zh-tw/personal/deposit/rate/forex/foreign-exchange-rates"
FR_HIS = "https://historical.findrate.tw/currencyhis.php?c={c}&year={y}&month={m}&day={d}"
FR_GRAPH = "https://historical.findrate.tw/graph.php?cur={c}&m=10y"
DIAG = []
T0 = time.time()


def now_tpe():
    return dt.datetime.now(TPE)


def http(url, data=None, headers=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            DIAG.append({"url": url, "error": str(e)[:200]})
            time.sleep(2 * (i + 1))
    return ""


def num(x):
    try:
        v = float(str(x).replace(",", ""))
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


# ---------- 來源 ----------
def esun_now():
    """玉山即時牌告：{CCY: [date, cb, cs, sb, ss, '玉山']}"""
    txt = http(ESUN, b"", {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                           "X-Requested-With": "XMLHttpRequest", "Referer": ESUN_REF})
    out = {}
    try:
        for r in json.loads(txt)["Rates"]:
            ccy = r["CCY"].split("/")[0]
            ms = re.search(r"\d+", r.get("UpdateTime") or "")
            d = (dt.datetime.fromtimestamp(int(ms.group()) / 1000, TPE) if ms else now_tpe()).strftime("%Y%m%d")
            row = [d, num(r.get("CashBBoardRate")), num(r.get("CashSBoardRate")),
                   num(r.get("BBoardRate")), num(r.get("SBoardRate")), "玉山"]
            if ccy in CCYS and any(row[1:5]):
                out[ccy] = row
    except Exception as e:  # noqa: BLE001
        DIAG.append({"esun_parse": str(e)[:200], "head": txt[:300]})
    return out


def findrate_day(ccy, day):
    """比率網某天某幣別各銀行牌價：{銀行: [cb, cs, sb, ss]}"""
    html = http(FR_HIS.format(c=ccy, y=day.year, m=day.month, d=day.day))
    if "<html" not in html.lower():
        return None          # 抓取失敗（不是「那天沒資料」）
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
    out = {}
    want = day.strftime("%Y-%m-%d")
    for bank, cb, cs, sb, ss, d in re.findall(
            r"([一-鿿A-Za-z]{2,10}) (\S+) (\S+) (\S+) (\S+) (\d{4}-\d{2}-\d{2})", t):
        if d == want and bank not in out:
            vals = [num(cb), num(cs), num(sb), num(ss)]
            if any(vals):
                out[bank] = vals
    return out


def pick_bank(banks, need_cash=True):
    """依偏好順序挑銀行；需要現鈔牌價時，先挑有現鈔賣出的銀行。"""
    if need_cash:
        for b in BANK_PREF + sorted(banks):
            if b in banks and banks[b][1]:
                return b, banks[b]
    for b in BANK_PREF:
        if b in banks:
            return b, banks[b]
    return (next(iter(banks.items())) if banks else (None, None))


def findrate_now(ccy):
    """比率網即時頁：{銀行: [cb, cs, sb, ss]}（今天的資料）"""
    html = http(f"https://www.findrate.tw/{ccy}/")
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
    out = {}
    for bank, cb, cs, sb, ss in re.findall(
            r"([\u4e00-\u9fffA-Za-z]{2,10}) (\S+) (\S+) (\S+) (\S+) \d{1,2}:\d{2}", t):
        vals = [num(cb), num(cs), num(sb), num(ss)]
        if any(vals) and bank not in out:
            out[bank] = vals
    return out


def findrate_graph(ccy):
    """比率網 10 年走勢（臺灣銀行牌價，到 2026/6/26）：{date: [d, cb, cs, sb, ss, '台銀']}"""
    g = http(FR_GRAPH.format(c=ccy))
    try:
        labels = [x.strip().strip('"') for x in re.search(r"labels:\s*\[([^\]]*)\]", g).group(1).split(",")]
        cols = []
        for lab in ["現金買入", "現金賣出", "即期買入", "即期賣出"]:
            m = re.search(r'label:\s*"' + lab + r'".*?data:\s*\[([^\]]*)\]', g, re.S)
            cols.append(m.group(1).split(",") if m else [])
    except Exception as e:  # noqa: BLE001
        DIAG.append({"graph": ccy, "error": str(e)[:200]})
        return {}
    out = {}
    for i, lab in enumerate(labels):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", lab):
            continue
        vals = [num(c[i]) if i < len(c) else None for c in cols]
        if any(vals):
            d = lab.replace("-", "")
            out[d] = [d, *vals, "台銀"]
    return out


def sinopac_now():
    """永豐銀行官網：{CCY: [cb, cs, sb, ss]}"""
    out = {}
    for typ, idx in (("CASH", 0), ("REMIT", 2)):
        txt = http(f"https://mma.sinopac.com/ws/share/rate/ws_exchange.ashx?exchangeType={typ}")
        try:
            for r in json.loads(txt)[0]["SubInfo"]:
                c = r.get("DataValue4")
                if c in CCYS:
                    v = out.setdefault(c, [None, None, None, None])
                    v[idx], v[idx + 1] = num(r.get("DataValue2")), num(r.get("DataValue3"))
        except Exception as e:  # noqa: BLE001
            DIAG.append({"sinopac": typ, "error": str(e)[:150]})
    return {c: v for c, v in out.items() if any(v)}


def yahoo(sym, full):
    q = "?period1=0&period2=9999999999&interval=1d" if full else "?range=1mo&interval=1d"
    try:
        res = json.loads(http("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(sym, safe="=^") + q))["chart"]["result"][0]
        off = res["meta"].get("gmtoffset", 0)
        return {dt.datetime.fromtimestamp(t + off, dt.timezone.utc).strftime("%Y%m%d"): c
                for t, c in zip(res.get("timestamp") or [], res["indicators"]["quote"][0].get("close") or []) if c and c > 0}
    except Exception as e:  # noqa: BLE001
        DIAG.append({"yahoo": sym, "error": str(e)[:150]})
        return {}


def stooq(sym):
    """備援：stooq.com 每日 CSV"""
    out = {}
    for line in http(f"https://stooq.com/q/d/l/?s={sym}&i=d").splitlines()[1:]:
        p = line.split(",")
        if len(p) >= 5 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p[0]) and num(p[4]):
            out[p[0].replace("-", "")] = num(p[4])
    return out


def series(yahoo_sym, stooq_sym, full):
    """先 Yahoo，抓不到換 stooq。"""
    d = yahoo(yahoo_sym, full)
    if len(d) < 5:
        d2 = stooq(stooq_sym)
        if len(d2) > len(d):
            DIAG.append({"fallback": f"{yahoo_sym} -> stooq {stooq_sym}"})
            d = d2 if full else dict(sorted(d2.items())[-25:])
    return d


def market_fx(ccy, full):
    """國際市場價：1 外幣 = ? 台幣"""
    d = series(f"{ccy}TWD=X", f"{ccy.lower()}twd", full)
    if len(d) >= 5:
        return {k: float(f"{v:.6g}") for k, v in d.items()}
    usd_twd = series("TWD=X", "usdtwd", full)
    if ccy == "USD":
        return usd_twd
    usd_c = series(f"{ccy}=X", f"usd{ccy.lower()}", full)
    return {k: float(f"{usd_twd[k] / v:.6g}") for k, v in usd_c.items() if k in usd_twd and v}


def metal_twd_per_gram(m, full):
    """黃金 GC=F／白銀 SI=F（美元／盎司）× 美元匯率 ÷ 31.1 = 台幣／公克"""
    ysym, ssym = {"XAU": ("GC=F", "xauusd"), "XAG": ("SI=F", "xagusd")}[m]
    px = series(ysym, ssym, full)
    fx = series("TWD=X", "usdtwd", full)
    out, last_fx = {}, None
    for d in sorted(set(px) | set(fx)):
        last_fx = fx.get(d, last_fx)
        if d in px and last_fx:
            out[d] = round(px[d] * last_fx / OZ, 2 if m == "XAU" else 3)
    return out


# ---------- 儲存 ----------
def load_hist(ccy):
    p = os.path.join(HIST, f"{ccy}.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return {r[0]: r for r in json.load(f)}
    return {}


def save_hist(ccy, rows):
    os.makedirs(HIST, exist_ok=True)
    with open(os.path.join(HIST, f"{ccy}.json"), "w", encoding="utf-8") as f:
        json.dump([rows[k] for k in sorted(rows)], f, ensure_ascii=False, separators=(",", ":"))


def read_recent():
    try:
        with open(os.path.join(ROOT, "recent.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def write_recent(store):
    cutoff = (now_tpe().date() - dt.timedelta(days=RECENT_DAYS)).strftime("%Y%m%d")
    out = {"updated": now_tpe().strftime("%Y-%m-%d %H:%M"), "source": "bank", "version": DATA_VERSION,
           "rates": {}, "first": {}}
    for ccy in CCYS + METALS:
        h = store.get(ccy) or {}
        rows = [h[k] for k in sorted(h) if k >= cutoff]
        if rows:
            out["rates"][ccy] = rows
            out["first"][ccy] = min(h)
    with open(os.path.join(ROOT, "recent.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


def write_diag(extra):
    with open(os.path.join(ROOT, "debug.json"), "w", encoding="utf-8") as f:
        json.dump({"time": now_tpe().strftime("%Y-%m-%d %H:%M"), **extra, "log": DIAG[-20:]},
                  f, ensure_ascii=False, indent=1)


# ---------- 主流程 ----------
def update(max_minutes=45):
    fresh_start = read_recent().get("version") != DATA_VERSION
    store = {c: ({} if fresh_start else load_hist(c)) for c in CCYS}
    stats = {"graph": 0, "gap_days": 0, "today": 0}
    fails = {}
    today = now_tpe().date()

    # 1) 沒有歷史的幣別：先抓比率網 10 年走勢（臺灣銀行）
    for ccy in CCYS:
        if not store[ccy]:
            store[ccy].update(findrate_graph(ccy))
            stats["graph"] += 1
            time.sleep(0.6)
            if not store[ccy]:   # 比率網抓不到 → 先用國際市場價頂著
                for d, v in market_fx(ccy, full=True).items():
                    store[ccy][d] = [d, v, v, v, v, "市場"]

    # 2) 補洞：臺灣銀行資料結束後到昨天，用比率網每日歷史頁（有現鈔牌價的銀行優先，玉山第一）
    empty_p = os.path.join(ROOT, "empty_days.json")
    try:
        empty = json.load(open(empty_p, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        empty = {}
    for ccy in CCYS:
        if fails.get("findrate_his", 0) >= 5:
            break
        h = store[ccy]
        bot_days = [k for k, r in h.items() if r[5] == "台銀"]
        has_cash = any(h[k][2] for k in bot_days[-20:])
        # 以前挑到沒有現鈔牌價的銀行 → 刪掉重抓
        for k in [k for k, r in h.items() if r[5] != "台銀" and has_cash and not r[2]]:
            del h[k]
        start = (dt.datetime.strptime(max(bot_days), "%Y%m%d").date() + dt.timedelta(days=1)) if bot_days \
            else today - dt.timedelta(days=120)
        skip = set(empty.get(ccy, []))
        day = start
        while day < today and time.time() - T0 < max_minutes * 60:
            d = day.strftime("%Y%m%d")
            if day.weekday() < 5 and d not in h and d not in skip:
                banks = findrate_day(ccy, day)
                if banks is None:
                    fails["findrate_his"] = fails.get("findrate_his", 0) + 1
                    if fails["findrate_his"] >= 5:
                        break        # 比率網掛了，下次再補
                    day += dt.timedelta(days=1)
                    continue
                bank, vals = pick_bank(banks, need_cash=has_cash)
                if vals:
                    h[d] = [d, *vals, SHORT.get(bank, bank[:2])]
                    stats["gap_days"] += 1
                elif (today - day).days > 3:
                    empty.setdefault(ccy, []).append(d)   # 假日，記起來不再重抓
                time.sleep(0.6)
            day += dt.timedelta(days=1)
        save_hist(ccy, h)
    with open(empty_p, "w", encoding="utf-8") as f:
        json.dump(empty, f, separators=(",", ":"))

    # 3) 今天：玉山即時牌告；玉山沒有的幣別改抓比率網今天的頁面
    live = esun_now()
    sino, used = None, {}
    if today.weekday() < 5:
        for ccy in CCYS:
            h = store[ccy]
            has_cash = any(r[2] for r in list(h.values())[-30:])
            row = live.get(ccy)
            if row and has_cash and not row[2]:
                row = None        # 玉山沒有這個幣別的現鈔牌價，改找別家
            d = today.strftime("%Y%m%d")
            if not row:                                   # 第 2 家：比率網（30 幾家銀行）
                bank, vals = pick_bank(findrate_now(ccy), need_cash=has_cash)
                if vals:
                    row = [d, *vals, SHORT.get(bank, bank[:2])]
                time.sleep(0.6)
            if not row:                                   # 第 3 家：永豐銀行官網
                if sino is None:
                    sino = sinopac_now()
                v = sino.get(ccy)
                if v and (v[1] or not has_cash):
                    row = [d, *v, "永豐"]
            if not row:                                   # 最後：國際市場價
                mk = market_fx(ccy, full=False)
                if mk and max(mk) >= (today - dt.timedelta(days=3)).strftime("%Y%m%d"):
                    v = mk[max(mk)]
                    row = [d, v, v, v, v, "市場"]
            if row:
                used[row[5]] = used.get(row[5], 0) + 1
            if row and row[0] == today.strftime("%Y%m%d"):
                h[row[0]] = row
                stats["today"] += 1

    for ccy in CCYS:
        if store[ccy]:
            save_hist(ccy, store[ccy])

    # 4) 黃金、白銀：國際價格換算成「台幣／公克」
    for m in METALS:
        h = {} if fresh_start else load_hist(m)
        rows = metal_twd_per_gram(m, full=len(h) < 200)
        for d, v in rows.items():
            h[d] = [d, v, v, v, v, "國際"]
        if h:
            save_hist(m, h)
            store[m] = h
        stats[m] = len(rows)

    write_recent(store)
    write_diag({**stats, "esun_ccys": sorted(live), "today_sources": used, "fails": fails,
                "minutes": round((time.time() - T0) / 60, 1), "rows": {c: len(store.get(c) or {}) for c in CCYS + METALS}})
    print(stats, "esun:", sorted(live))


if __name__ == "__main__":
    update()
