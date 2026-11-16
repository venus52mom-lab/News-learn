#!/usr/bin/env python3
"""第四輪：比率網歷史頁的深度、走勢圖是哪家銀行。"""
import datetime as dt, json, os, re, time, urllib.request
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"}
def fetch(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=25) as r:
        return r.read().decode("utf-8", "replace")
def rows(html):
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
    return re.findall(r"([一-鿿A-Za-z]{2,10}) (\S+) (\S+) (\S+) (\S+) (\d{4}-\d{2}-\d{2})", t)
out = {}
for d in ["2025-11-13", "2026-06-26", "2026-06-30", "2026-03-02", "2024-01-03", "2022-01-04", "2020-01-03", "2018-01-03"]:
    y, m, dd = d.split("-")
    try:
        r = rows(fetch(f"https://historical.findrate.tw/currencyhis.php?c=JPY&year={y}&month={int(m)}&day={int(dd)}"))
        out[f"his {d}"] = r[:45]
    except Exception as e:  # noqa: BLE001
        out[f"his {d}"] = str(e)
    time.sleep(0.5)
for c in ["USD", "KRW", "THB", "AUD", "VND"]:
    try:
        g = fetch(f"https://historical.findrate.tw/graph.php?cur={c}&m=10y")
        L = re.search(r"labels:\s*\[([^\]]*)\]", g).group(1).split(",")
        out[f"graph {c}"] = [len(L), L[:1], L[-1:], re.search(r'label:\s*"現金賣出".*?data:\s*\[([^\]]*)\]', g, re.S).group(1).split(",")[-1]]
    except Exception as e:  # noqa: BLE001
        out[f"graph {c}"] = str(e)
    time.sleep(0.5)
for u in ["https://historical.findrate.tw/graph.php?cur=JPY&m=1y", "https://www.findrate.tw/bank/1/", "https://historical.findrate.tw/bank.php?b=1&c=JPY"]:
    try:
        g = fetch(u); L = re.search(r"labels:\s*\[([^\]]*)\]", g)
        out[u] = [len(g), (L.group(1).split(",")[-1] if L else None), re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", g))[:600]]
    except Exception as e:  # noqa: BLE001
        out[u] = str(e)
os.makedirs("fx-rates/data", exist_ok=True)
json.dump({"time": dt.datetime.now().isoformat(), "results": out}, open("fx-rates/data/probe.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("ok")
