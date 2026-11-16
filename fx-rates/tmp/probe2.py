import json, urllib.request, time
H={"User-Agent":"Mozilla/5.0","Origin":"https://venus52mom-lab.github.io","Content-Type":"application/json"}
def get(u, body=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, data=json.dumps(body).encode() if body else None, headers=H), timeout=20) as r:
            return r.status, r.headers.get("Access-Control-Allow-Origin"), r.read().decode("utf-8","replace")
    except Exception as e: return None, None, str(e)[:150]
out={}
syms="AAPL,2330.TW,^GDAXI,ETH-USD,CL=F,^TNX,EURUSD=X,0050.TW,^TWOII,000001.SS"
for q in ["range=1d&interval=5m","range=5d&interval=30m","range=3mo&interval=1d"]:
    for host in ["query1","query2"]:
        st,c,t=get(f"https://{host}.finance.yahoo.com/v8/finance/spark?symbols={syms}&{q}")
        out[f"spark8 {host} {q}"]=[st,t[:600]]
        st,c,t=get(f"https://{host}.finance.yahoo.com/v7/finance/spark?symbols={syms}&{q}")
        out[f"spark7 {host} {q}"]=[st,t[:600]]
        time.sleep(1)
for s in ["TWS:2330:STOCK","USS:AAPL:STOCK","TWS:0050:STOCK","TWS:0050:ETF","TWS:OTC01:INDEX","USS:SPY:ETF","USS:SPY:STOCK","GI:GDAXI:INDEX","GI:DAX:INDEX","GI:FTSE:INDEX","GI:N225:INDEX","GI:NKY:INDEX","GI:SSEC:INDEX","GI:SHCOMP:INDEX"]:
    st,c,t=get(f"https://ws.api.cnyes.com/ws/api/v1/quote/quotes/{s}"); out["cn "+s]=[st,c,t[:260]]; time.sleep(0.3)
st,c,t=get("https://ws.api.cnyes.com/ws/api/v1/quote/quotes/TWS:2330:STOCK,USS:AAPL:STOCK,GI:DJI:INDEX"); out["cn batch"]=[st,c,t[:900]]
# 期交所近月代號＋1分線
st,c,t=get("https://mis.taifex.com.tw/futures/api/getQuoteList",{"MarketType":"0","SymbolType":"F","KindID":"1","CID":"TXF","ExpireMonth":"","RowSize":"全部","PageNo":"","SortColumn":"","AscDesc":"A"})
sid=None
try: sid=[r["SymbolID"] for r in json.loads(t)["RtData"]["QuoteList"] if r["SymbolID"].endswith("-F")][0]
except Exception: pass
out["mis sid"]=sid
for path,body in [("getChartData1M",{"SymbolID":sid}),("getChartData1M",{"SymbolID":sid,"MarketType":"0"}),("getChartData",{"SymbolID":sid}),("getChartData1M",{"SymbolID":(sid or "").replace("-F","-M"),"MarketType":"1"})]:
    st,c,t=get(f"https://mis.taifex.com.tw/futures/api/{path}",body); out[f"mis {path} {body}"]=[st,t[:500]]
json.dump(out,open("fx-rates/tmp/probe2.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
