import json, urllib.request, time
out={}
for sym in ["000300.SS","EU500.AS","^N100","^STOXX","^STOXX50E","000300.SZ","399300.SZ"]:
    for q in ["?range=1y&interval=1d","?range=2y&interval=1wk","?range=max&interval=1mo","?range=6mo&interval=1d&includePrePost=false"]:
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}{q}",headers={"User-Agent":"Mozilla/5.0"}),timeout=20) as r:
                j=json.load(r)["chart"]["result"][0]; c=j["indicators"]["quote"][0].get("close") or []
                out[sym+q]=[len(j.get("timestamp") or []), sum(1 for x in c if x), j["meta"].get("dataGranularity"), j["meta"].get("validRanges")]
        except Exception as e: out[sym+q]=str(e)[:80]
        time.sleep(0.7)
json.dump(out,open("fx-rates/tmp/probe_y.json","w"),indent=1)
