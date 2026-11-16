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
    for ccy in CCYS:
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
    today = now_tpe().date()

    # 1) 沒有歷史的幣別：先抓比率網 10 年走勢（臺灣銀行）
    for ccy in CCYS:
        if not store[ccy]:
            store[ccy].update(findrate_graph(ccy))
            stats["graph"] += 1
            time.sleep(0.6)

    # 2) 補洞：臺灣銀行資料結束後到昨天，用比率網每日歷史頁（有現鈔牌價的銀行優先，玉山第一）
    empty_p = os.path.join(ROOT, "empty_days.json")
    try:
        empty = json.load(open(empty_p, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        empty = {}
    for ccy in CCYS:
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
                bank, vals = pick_bank(findrate_day(ccy, day), need_cash=has_cash)
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
    if today.weekday() < 5:
        for ccy in CCYS:
            h = store[ccy]
            has_cash = any(r[2] for r in list(h.values())[-30:])
            row = live.get(ccy)
            if row and has_cash and not row[2]:
                row = None        # 玉山沒有這個幣別的現鈔牌價，改找別家
            if not row:
                bank, vals = pick_bank(findrate_now(ccy), need_cash=has_cash)
                if vals:
                    d = today.strftime("%Y%m%d")
                    row = [d, *vals, SHORT.get(bank, bank[:2])]
                time.sleep(0.6)
            if row and row[0] == today.strftime("%Y%m%d"):
                h[row[0]] = row
                stats["today"] += 1

    for ccy in CCYS:
        if store[ccy]:
            save_hist(ccy, store[ccy])
    write_recent(store)
    write_diag({**stats, "esun_ccys": sorted(live), "minutes": round((time.time() - T0) / 60, 1),
                "rows": {c: len(store[c]) for c in CCYS}})
    print(stats, "esun:", sorted(live))


if __name__ == "__main__":
    update()
