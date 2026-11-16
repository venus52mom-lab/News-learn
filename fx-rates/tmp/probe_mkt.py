import json, time, urllib.request, urllib.parse
H = {"User-Agent": "Mozilla/5.0", "Origin": "https://venus52mom-lab.github.io"}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=20) as r:
            return r.status, r.headers.get("Access-Control-Allow-Origin"), r.read().decode("utf-8", "replace")
    except Exception as e:
        return None, None, str(e)[:120]
out = {"search": {}, "quote": {}, "yahoo": {}}
for q in ["道瓊", "加權指數", "S&P", "那斯達克", "費城半導體", "日經", "恆生", "滬深300", "KOSPI", "VIX", "美元指數", "比特幣", "那斯達克期", "黃金期貨", "白銀期貨", "UTEN", "Euronext", "美國3年期公債期貨"]:
    for u in [f"https://ess.api.cnyes.com/ess/api/v1/siteSearch/main?q={urllib.parse.quote(q)}",
              f"https://ws.api.cnyes.com/ws/api/v1/search/quote?q={urllib.parse.quote(q)}"]:
        st, c, t = get(u)
        out["search"][q + " | " + u.split('/')[2]] = [st, c, t[:1200]]
        time.sleep(0.3)
cands = ["GI:DJI:INDEX", "TWS:TSE01:INDEX", "GI:SPX:INDEX", "GI:INX:INDEX", "GI:IXIC:INDEX", "GI:SOX:INDEX", "GI:N225:INDEX", "GI:NI225:INDEX",
         "GI:HSI:INDEX", "GI:KOSPI:INDEX", "GI:KS11:INDEX", "GI:VIX:INDEX", "GI:DXY:INDEX", "GI:USDX:INDEX", "CC:BTCUSD:CRYPTO", "CC:BTC:CRYPTO",
         "GF:NQ:FUTURES", "CME:NQ:FUTURES", "GF:GC:FUTURES", "GF:SI:FUTURES", "USS:UTEN:STOCK", "CNS:000300:INDEX", "CNS:SHSE000300:INDEX", "GI:SHSZ300:INDEX"]
for c in cands:
    st, a, t = get(f"https://ws.api.cnyes.com/ws/api/v1/quote/quotes/{c}")
    out["quote"][c] = [st, a, t[:300]]
    time.sleep(0.3)
for y in ["^DJI", "^TWII", "^GSPC", "^IXIC", "^SOX", "^N225", "^HSI", "000300.SS", "^KS11", "^VIX", "DX-Y.NYB", "EU500.AS", "BTC-USD", "UTEN", "NQ=F", "Z3N=F", "GC=F", "SI=F"]:
    for host in ("query1", "query2"):
        st, a, t = get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(y, safe='=^')}?range=5d&interval=1d")
        if st == 200: break
        time.sleep(1)
    out["yahoo"][y] = [st, host, t[:200]]
    time.sleep(0.5)
json.dump(out, open("fx-rates/tmp/probe_mkt.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
