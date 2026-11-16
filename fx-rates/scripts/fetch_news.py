#!/usr/bin/env python3
"""每個觀察項目的最新相關新聞（優先中文，不夠再補英文）→ data/news.json
來源：Google 新聞 RSS（中文：台灣版；英文：美國版）。"""
import datetime as dt
import email.utils
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
TPE = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"}

# ID: (中文關鍵字, 英文關鍵字)
Q = {
    "USD": ("美元 匯率", "US dollar exchange rate"), "JPY": ("日圓 匯率", "Japanese yen"), "AUD": ("澳幣 匯率", "Australian dollar"),
    "THB": ("泰銖 匯率", "Thai baht"), "KRW": ("韓元 匯率", "Korean won"), "EUR": ("歐元 匯率", "euro exchange rate"),
    "HKD": ("港幣 匯率", "Hong Kong dollar"), "GBP": ("英鎊 匯率", "British pound"), "CAD": ("加幣 匯率", "Canadian dollar"),
    "SGD": ("新加坡幣 匯率", "Singapore dollar"), "CHF": ("瑞士法郎 匯率", "Swiss franc"), "ZAR": ("南非幣 匯率", "South African rand"),
    "SEK": ("瑞典克朗 匯率", "Swedish krona"), "NZD": ("紐幣 匯率", "New Zealand dollar"), "PHP": ("菲律賓比索 匯率", "Philippine peso"),
    "IDR": ("印尼盾 匯率", "Indonesian rupiah"), "VND": ("越南盾 匯率", "Vietnamese dong"), "MYR": ("馬幣 匯率", "Malaysian ringgit"),
    "CNY": ("人民幣 匯率", "Chinese yuan"),
    "XAU": ("黃金 金價", "gold price"), "XAG": ("白銀 銀價", "silver price"), "GC": ("黃金期貨", "gold futures"), "SI": ("白銀期貨", "silver futures"),
    "TXF": ("台指期", "Taiwan futures"), "TWII": ("台股 加權指數", "Taiwan stocks TAIEX"), "DJI": ("道瓊", "Dow Jones"),
    "SPX": ("標普500", "S&P 500"), "IXIC": ("那斯達克", "Nasdaq"), "SOX": ("費城半導體", "Philadelphia semiconductor index"),
    "N225": ("日經指數", "Nikkei 225"), "HSI": ("恆生指數", "Hang Seng"), "CSI300": ("滬深300", "CSI 300"),
    "KOSPI": ("韓股 KOSPI", "KOSPI"), "EU500": ("歐股", "European stocks"), "VIX": ("VIX 恐慌指數", "VIX volatility"),
    "UTEN": ("美債 殖利率", "10-year Treasury"), "DXY": ("美元指數", "dollar index"), "BTC": ("比特幣", "Bitcoin"),
    "NQ": ("那斯達克期貨", "Nasdaq futures"), "Z3N": ("美國公債期貨", "Treasury futures"),
}


def rss(query, lang):
    if lang == "zh":
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": query + " when:2d", "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"})
    else:
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": query + " when:2d", "hl": "en-US", "gl": "US", "ceid": "US:en"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            root = ET.fromstring(r.read())
    except Exception as e:  # noqa: BLE001
        return [], str(e)[:100]
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src = (it.findtext("source") or "").strip()
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        try:
            ts = int(email.utils.parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:  # noqa: BLE001
            ts = 0
        desc = re.sub(r"<[^>]+>", " ", it.findtext("description") or "")
        desc = re.sub(r"\s+", " ", desc).strip()
        out.append({"t": title, "u": it.findtext("link"), "s": src, "ts": ts, "lang": lang,
                    "d": "" if desc.startswith(title[:20]) else desc[:160]})
    out.sort(key=lambda x: -x["ts"])
    return out, None


def main():
    news, errs = {}, {}
    for mid, (zq, eq) in Q.items():
        items, e = rss(zq, "zh")
        if e:
            errs[mid] = e
        seen, pick = set(), []
        for x in items:
            k = x["t"][:18]
            if k not in seen:
                seen.add(k)
                pick.append(x)
        if len(pick) < 3:            # 中文不夠 → 補英文
            en, e2 = rss(eq, "en")
            pick += en[: 3 - len(pick) + 2]
            time.sleep(0.5)
        news[mid] = pick[:5]
        time.sleep(0.6)
    out = {"updated": dt.datetime.now(TPE).strftime("%Y-%m-%d %H:%M"), "news": news, "errors": errs}
    with open(os.path.join(ROOT, "news.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(sum(len(v) for v in news.values()), "news;", len(errs), "errors")


if __name__ == "__main__":
    main()
