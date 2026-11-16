#!/usr/bin/env python3
"""試各家匯率來源能不能從 GitHub 主機連到，結果存 data/probe.json。"""
import datetime as dt, json, os, re, time, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
RAW = ["玉山 E.SUN", "FindRate 日圓", "FindRate 手機", "FindRate 台銀", "玉山 JS"]
SRC = {
  "FindRate 手機":   "https://m.findrate.tw/currency.php?c=JPY",
  "FindRate 台銀":   "https://www.findrate.tw/bank/8/",
  # 銀行
  "永豐 SinoPac":    "https://mma.sinopac.com/ws/share/rate/ws_exchange.ashx?exchangeType=REMIT",
  "永豐 SinoPac 現鈔": "https://mma.sinopac.com/ws/share/rate/ws_exchange.ashx?exchangeType=CASH",
  "玉山 E.SUN":      "https://www.esunbank.com/zh-tw/personal/deposit/rate/forex/foreign-exchange-rates",
  "玉山 E.SUN API":  "https://www.esunbank.com/api/client/ExchangeRate/LastRateInfo",
  "國泰 Cathay":     "https://www.cathaybk.com.tw/cathaybk/personal/product/deposit/currency-billboard/",
  "兆豐 Mega":       "https://www.megabank.com.tw/personal/foreign-exchange-rate",
  "第一 FirstBank":  "https://ibank.firstbank.com.tw/NetBank/7/0201.html?sh=none",
  "中信 CTBC":       "https://www.ctbcbank.com/twrbo/zh_tw/dep_index/dep_ratequery/dep_foreign_rates.html",
  "台新 Taishin":    "https://www.taishinbank.com.tw/TSB/personal/deposit/lookup/realtime/",
  "華南 HNCB":       "https://www.hncb.com.tw/wps/portal/HNCB/exchange-rate",
  "彰銀 CHB":        "https://www.bankchb.com/frontend/G0100_query.jsp",
  "土銀 LandBank":   "https://www.landbank.com.tw/Category/Items/%E5%8C%AF%E7%8E%87",
  "合庫 TCB":        "https://www.tcb-bank.com.tw/personal-banking/deposit-exchange/exchange-rate/spot",
  "富邦 Fubon":      "https://www.fubon.com/banking/personal/deposit/exchange_rate/exchange_rate1.htm",
  "上海 SCSB":       "https://ibank.scsb.com.tw/netbank.portal?_nfpb=true&_pageLabel=page_other12",
  "台銀 BOT(對照)":  "https://rate.bot.com.tw/xrt/flcsv/0/day",
  # 比價／彙整網站
  "FindRate 日圓":   "https://www.findrate.tw/JPY/",
  "FindRate 首頁":   "https://www.findrate.tw/",
  "比率網 rter":     "https://tw.rter.info/capi.php",
  "央行 CBC 美元":   "https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day",
  # 國際中間價
  "currency-api":    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/twd.json",
  "open.er-api":     "https://open.er-api.com/v6/latest/TWD",
}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    t = time.time()
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
        return r.status, r.headers.get("Content-Type", ""), raw, round(time.time() - t, 1)

out = {"time": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%F %R"), "results": {}}
for name, url in SRC.items():
    rec = {"url": url}
    try:
        st, ct, raw, sec = get(url)
        txt = None
        for enc in ("utf-8", "big5", "cp950"):
            try:
                txt = raw.decode(enc); break
            except UnicodeDecodeError:
                pass
        txt = txt or raw.decode("utf-8", "replace")
        low = txt.lower()
        rec.update(status=st, type=ct, bytes=len(raw), sec=sec,
                   challenge=("challenge" in low[:3000] or "captcha" in low[:5000] or "just a moment" in low[:3000]),
                   has_JPY=("JPY" in txt), has_日圓=("日圓" in txt or "日幣" in txt), has_現金=("現金" in txt))
        i = txt.find("JPY")
        if i < 0: i = txt.find("日圓")
        rec["around_JPY"] = re.sub(r"\s+", " ", txt[max(0, i - 600): i + 900]) if i >= 0 else ""
        rec["head"] = re.sub(r"\s+", " ", txt[:700])
        # 找可能的 API／JSON 網址，方便下一步
        rec["api_hints"] = sorted(set(re.findall(r"""["'](/[^"' ]*(?:api|Api|API|rate|Rate|json|ashx|ajax)[^"' ]*)["']""", txt)))[:25]
    except Exception as e:  # noqa: BLE001
        rec["error"] = str(e)[:300]
    if name in RAW and "error" not in rec:
        os.makedirs("fx-rates/data/probe_raw", exist_ok=True)
        with open(f"fx-rates/data/probe_raw/{re.sub(r'[^A-Za-z]', '_', name)}.html", "w", encoding="utf-8") as f:
            f.write(txt)
    out["results"][name] = rec
    time.sleep(0.5)

# 玉山網頁的 JS（找 API 用法）
try:
    page = open("fx-rates/data/probe_raw/____E_SUN.html", encoding="utf-8").read()
    js = [u for u in re.findall(r'src="([^"]+\.js[^"]*)"', page)]
    out["esun_js"] = js
    for u in js:
        full = u if u.startswith("http") else "https://www.esunbank.com" + u
        try:
            st, ct, raw, sec = get(full)
            t = raw.decode("utf-8", "replace")
            if "ExchangeRate" in t or "RateInfo" in t:
                with open("fx-rates/data/probe_raw/esun_" + re.sub(r"[^A-Za-z0-9]", "_", u)[-60:] + ".js", "w", encoding="utf-8") as f:
                    f.write(t)
        except Exception as e:  # noqa: BLE001
            pass
except Exception as e:  # noqa: BLE001
    out["esun_js_error"] = str(e)
# 玉山 API 試幾種 POST
for path in ["ForeignExchangeRates", "RateInfo", "LastRateInfo", "GetRateQuoteTime"]:
    for body in [b"{}", b'{"Currency":"JPY","Day":"90"}']:
        try:
            req = urllib.request.Request(f"https://www.esunbank.com/api/client/ExchangeRate/{path}?sc_lang=zh-TW", data=body,
                                         headers={**UA, "Content-Type": "application/json", "Referer": "https://www.esunbank.com/zh-tw/personal/deposit/rate/forex/foreign-exchange-rates"})
            with urllib.request.urlopen(req, timeout=20) as r:
                out["results"][f"玉山POST {path} {body.decode()}"] = {"status": r.status, "head": r.read()[:1500].decode("utf-8", "replace")}
        except Exception as e:  # noqa: BLE001
            out["results"][f"玉山POST {path} {body.decode()}"] = {"error": str(e)[:200]}

os.makedirs("fx-rates/data", exist_ok=True)
with open("fx-rates/data/probe.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
for k, v in out["results"].items():
    print(k, v.get("status"), v.get("bytes"), "challenge" if v.get("challenge") else "", "JPY" if v.get("has_JPY") else "", v.get("error", ""))
