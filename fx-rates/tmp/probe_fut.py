import json, time, urllib.request, datetime as dt
now = int(time.time())
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
     "Origin": "https://venus52mom-lab.github.io", "Accept": "application/json, text/plain, */*"}
C = {
 "cnyes_D": ("GET", f"https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWF:TXF:FUTURES&resolution=D&quote=1&from={now}&to={now-86400*120}", None),
 "cnyes_5": ("GET", f"https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWF:TXF:FUTURES&resolution=5&quote=1&from={now}&to={now-86400*2}", None),
 "cnyes_1": ("GET", f"https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWF:TXF:FUTURES&resolution=1&quote=1&from={now}&to={now-86400}", None),
 "cnyes_quote": ("GET", "https://ws.api.cnyes.com/ws/api/v1/quote/quotes/TWF:TXF:FUTURES", None),
 "cnyes_D_all": ("GET", f"https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWF:TXF:FUTURES&resolution=D&from={now}&to=0", None),
 "taifex_openapi": ("GET", "https://openapi.taifex.com.tw/v1/DailyMarketReportFut", None),
 "taifex_mis_day": ("POST", "https://mis.taifex.com.tw/futures/api/getQuoteList", {"MarketType":"0","SymbolType":"F","KindID":"1","CID":"TXF","ExpireMonth":"","RowSize":"全部","PageNo":"","SortColumn":"","AscDesc":"A"}),
 "taifex_mis_night": ("POST", "https://mis.taifex.com.tw/futures/api/getQuoteList", {"MarketType":"1","SymbolType":"F","KindID":"1","CID":"TXF","ExpireMonth":"","RowSize":"全部","PageNo":"","SortColumn":"","AscDesc":"A"}),
 "taifex_report": ("GET", "https://www.taifex.com.tw/cht/3/futDailyMarketReport", None),
 "yahoo_WTX": ("GET", "https://query1.finance.yahoo.com/v8/finance/chart/WTX%26.TW?range=5d&interval=5m", None),
 "yahoo_TWII": ("GET", "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?range=5d&interval=1d", None),
 "yahoo_tw_page": ("GET", "https://tw.stock.yahoo.com/future/WTX&", None),
}
out = {"time": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%F %T")}
for k, (m, u, body) in C.items():
    try:
        data = json.dumps(body).encode() if body else None
        hd = {**H, **({"Content-Type": "application/json"} if body else {})}
        with urllib.request.urlopen(urllib.request.Request(u, data=data, headers=hd, method=m), timeout=25) as r:
            raw = r.read()
            out[k] = {"status": r.status, "cors": r.headers.get("Access-Control-Allow-Origin"), "type": r.headers.get("Content-Type"),
                      "len": len(raw), "head": raw[:1500].decode("utf-8", "replace"), "tail": raw[-400:].decode("utf-8", "replace")}
    except Exception as e:
        out[k] = {"error": str(e)[:200]}
    time.sleep(0.5)
json.dump(out, open("fx-rates/tmp/probe_fut.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
