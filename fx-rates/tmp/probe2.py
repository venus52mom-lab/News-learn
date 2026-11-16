import json, urllib.request
H={"User-Agent":"Mozilla/5.0","Content-Type":"application/json"}
def post(u,b):
    with urllib.request.urlopen(urllib.request.Request(u,data=json.dumps(b).encode(),headers=H),timeout=20) as r: return json.load(r)
out={}
for sid,mt in [("TXFK6-F","0"),("TXFK6-M","1")]:
    j=post("https://mis.taifex.com.tw/futures/api/getChartData1M",{"SymbolID":sid,"MarketType":mt})
    rd=j["RtData"]; out[sid]={k:(v if not isinstance(v,list) else {"len":len(v),"first":v[:3],"last":v[-2:]}) for k,v in rd.items()}
with urllib.request.urlopen(urllib.request.Request("https://query1.finance.yahoo.com/v7/finance/spark?symbols=AAPL,2330.TW&range=1d&interval=5m",headers=H),timeout=20) as r:
    j=json.load(r); x=j["spark"]["result"][0]["response"][0]; out["spark7"]={"meta":x["meta"],"keys":list(x.keys()),"ind":list(x["indicators"]["quote"][0].keys())}
json.dump(out,open("fx-rates/tmp/probe2.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
