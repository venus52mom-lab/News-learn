#!/usr/bin/env python3
"""第三輪：測試歷史資料來源（玉山指定日期、比率網歷史走勢）。"""
import datetime as dt, json, os, re, time, urllib.parse, urllib.request
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept-Language": "zh-TW,zh;q=0.9"}
out = {"time": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%F %R"), "results": {}}
os.makedirs("fx-rates/data/probe_raw", exist_ok=True)

def fetch(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.status, r.read().decode("utf-8", "replace")

# 玉山：指定日期時間
ESUN = "https://www.esunbank.com/api/client/ExchangeRate/RateInfo?sc_lang=zh-TW"
REF = {"Referer": "https://www.esunbank.com/zh-tw/personal/deposit/rate/forex/foreign-exchange-rates",
       "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest"}
for d in ["2026-11-13 15:30:00", "2025-11-14 15:30:00", "2023-11-14 15:30:00", "2020-01-06 15:30:00", "2016-01-04 15:30:00", "2010-01-04 15:30:00", "2005-01-04 15:30:00"]:
    for extra in [{}, {"itemId": "8DA931CD4C4149CD92131370424212EC"}]:
        body = urllib.parse.urlencode({"datetime": d, **extra}).encode()
        k = f"玉山 {d} {'item' if extra else ''}"
        try:
            st, t = fetch(ESUN, body, REF)
            out["results"][k] = {"status": st, "len": len(t), "head": t[:900]}
        except Exception as e:  # noqa: BLE001
            out["results"][k] = {"error": str(e)[:200]}
        time.sleep(0.4)
# 比率網歷史
for u in ["https://historical.findrate.tw/graph.php?cur=JPY&m=3m", "https://historical.findrate.tw/graph.php?cur=JPY&m=10y",
          "https://historical.findrate.tw/JPY/", "https://historical.findrate.tw/currencyhis.php?c=JPY&year=2026&month=11&day=13",
          "https://historical.findrate.tw/currencyhis.php?c=JPY&year=2016&month=1&day=4"]:
    try:
        st, t = fetch(u)
        name = re.sub(r"[^A-Za-z0-9]", "_", u.split("findrate.tw/")[1])[:60]
        open(f"fx-rates/data/probe_raw/fr_{name}.html", "w", encoding="utf-8").write(t)
        out["results"][u] = {"status": st, "len": len(t), "head": re.sub(r"\s+", " ", t[:400])}
    except Exception as e:  # noqa: BLE001
        out["results"][u] = {"error": str(e)[:200]}
    time.sleep(0.5)
json.dump(out, open("fx-rates/data/probe.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for k, v in out["results"].items():
    print(k, v.get("status"), v.get("len"), v.get("error", ""))
