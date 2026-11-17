#!/usr/bin/env python3
"""全台灣上市、上櫃股票（含 ETF）名單 → data/twstocks.json
一天更新一次就夠；新上市、上櫃的股票會自動出現在 App 的「可加入」清單。
來源：證交所 OpenAPI、櫃買中心 OpenAPI；失敗時改用 FinMind。"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone, timedelta

TPE = timezone(timedelta(hours=8))
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "twstocks.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

IND = {"01":"水泥","02":"食品","03":"塑膠","04":"紡織纖維","05":"電機機械","06":"電器電纜","08":"玻璃陶瓷",
       "09":"造紙","10":"鋼鐵","11":"橡膠","12":"汽車","14":"建材營造","15":"航運","16":"觀光餐旅",
       "17":"金融保險","18":"貿易百貨","19":"綜合","20":"其他","21":"化學","22":"生技醫療","23":"油電燃氣",
       "24":"半導體","25":"電腦及週邊","26":"光電","27":"通信網路","28":"電子零組件","29":"電子通路",
       "30":"資訊服務","31":"其他電子","32":"文化創意","33":"農業科技","34":"電子商務","35":"綠能環保",
       "36":"數位雲端","37":"運動休閒","38":"居家生活","80":"管理股票","91":"存託憑證"}

def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8-sig"))
        except Exception as e:
            print("  retry", url, e); time.sleep(3 + i * 5)
    return None

def is_etf(code):   # 00 開頭（0050、00631L、00400A…）
    return code.startswith("00")

def official():
    L, O = {}, {}
    a = get("https://openapi.twse.com.tw/v1/opendata/t187ap03_L") or []
    for r in a:
        c = (r.get("公司代號") or "").strip()
        if c: L[c] = [(r.get("公司簡稱") or r.get("公司名稱") or c).strip(), IND.get((r.get("產業別") or "").strip(), "其他")]
    b = get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O") or []
    for r in b:
        c = (r.get("SecuritiesCompanyCode") or "").strip()
        if c: O[c] = [(r.get("CompanyAbbreviation") or r.get("CompanyName") or c).strip(), IND.get((r.get("SecuritiesIndustryCode") or "").strip(), "其他")]
    # ETF 不在公司名單裡：從每日收盤行情補
    for r in get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL") or []:
        c = (r.get("Code") or "").strip()
        if c and is_etf(c) and c not in L: L[c] = [(r.get("Name") or c).strip(), "ETF"]
        elif c and re.fullmatch(r"\d{4}", c) and c not in L: L[c] = [(r.get("Name") or c).strip(), "其他"]
    for r in get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes") or []:
        c = (r.get("SecuritiesCompanyCode") or "").strip()
        if c and is_etf(c) and len(c) <= 6 and c not in O: O[c] = [(r.get("CompanyName") or c).strip(), "ETF"]
        elif c and re.fullmatch(r"\d{4}", c) and c not in O: O[c] = [(r.get("CompanyName") or c).strip(), "其他"]
    return L, O, len(a) > 500 and len(b) > 300

def finmind(L, O):
    j = get("https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo") or {}
    for r in j.get("data") or []:
        c, n, t = r.get("stock_id", ""), r.get("stock_name", ""), r.get("type", "")
        if not (re.fullmatch(r"\d{4}", c) or (is_etf(c) and len(c) <= 6)): continue
        ind = "ETF" if is_etf(c) else re.sub(r"(工業|業)$", "", r.get("industry_category") or "其他")
        d = L if t == "twse" else O if t == "tpex" else None
        if d is not None and c not in d: d[c] = [n, ind]

def main():
    force = "--force" in sys.argv
    if os.path.exists(OUT) and not force:
        try:
            old = json.load(open(OUT))
            if old.get("date") == datetime.now(TPE).strftime("%Y-%m-%d") and len(old.get("L", [])) > 500: print("今天已更新過"); return
        except Exception: pass
    L, O, ok = official()
    if not ok: print("官方來源不完整，改用 FinMind 補"); finmind(L, O)
    if len(L) < 500 or len(O) < 300: print("名單太少，不覆蓋", len(L), len(O)); return
    key = lambda kv: (kv[0].isdigit() is False, kv[0])
    out = {"date": datetime.now(TPE).strftime("%Y-%m-%d"),
           "L": [[c, n, i] for c, (n, i) in sorted(L.items(), key=key)],
           "O": [[c, n, i] for c, (n, i) in sorted(O.items(), key=key)]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print("上市", len(L), "上櫃", len(O))

if __name__ == "__main__":
    main()
