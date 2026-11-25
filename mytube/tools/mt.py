"""
myTube 手機下載小工具（在 iPhone 的 a-Shell App 裡執行）

用法（只要記這一個）：
  python3 mt.py
  → 貼上網址（可以一次貼很多個），自動判斷：
     music.youtube.com 的連結 → 音樂（m4a）
     其他 YouTube 連結        → 影片（mp4）
  想把一般影片只存聲音：網址前面打 mp3，例如  mp3 https://youtu.be/xxxx

檔案會存到「檔案」App → 我的 iPhone → a-Shell → myTube → 影片 / 音樂
"""
import os
import re
import sys

MT_URL = "https://raw.githubusercontent.com/venus52mom-lab/News-learn/main/mytube/tools/mt.py"


def self_update():
    """每次執行先看 GitHub 上有沒有新版，有就自動換成新版（朋友不用自己更新）"""
    if os.environ.get("MT_UPDATED") or "__file__" not in globals():
        return  # 用 myTube 複製的指令時，本來就是直接跑 GitHub 上的最新版
    try:
        import urllib.request
        with urllib.request.urlopen(MT_URL, timeout=6) as r:
            new = r.read()
        me = os.path.abspath(__file__)
        with open(me, "rb") as f:
            old = f.read()
        if new and new != old and b"def main" in new:
            with open(me, "wb") as f:
                f.write(new)
            print("🔄 下載程式已自動更新到最新版\n")
            os.environ["MT_UPDATED"] = "1"
            import runpy
            runpy.run_path(me, run_name="__main__")
            sys.exit(0)
    except SystemExit:
        raise
    except Exception:
        pass


self_update()

# 第一次使用：缺少的工具自動安裝（不用自己打指令）
NEEDED = ["yt-dlp", "yt-dlp-ejs", "yt-dlp-apple-webkit-jsi"]


def ensure_tools():
    import importlib
    import importlib.metadata as md
    missing = []
    for p in NEEDED:
        try:
            md.version(p)
        except Exception:
            missing.append(p)
    if not missing:
        return
    print("📦 第一次使用，正在安裝下載工具（約 1 分鐘，只有第一次）…")
    try:
        from pip._internal.cli.main import main as pip_main
        pip_main(["install", "-qq", "-U", "--disable-pip-version-check"] + missing)
    except Exception as e:
        print("   自動安裝失敗：", e)
        print("   請手動執行：python3 -m pip install -U " + " ".join(NEEDED))
    importlib.invalidate_caches()


TTS_MODE = len(sys.argv) > 1 and sys.argv[1] == "tts"     # 電子書離線朗讀：不需要 yt-dlp
if not TTS_MODE:
    ensure_tools()
    try:
        import yt_dlp
    except ImportError:
        sys.exit("找不到 yt-dlp，請執行：python3 -m pip install -U " + " ".join(NEEDED))

BASE = os.path.expanduser("~/Documents/myTube")

# 只選「一般下載」的格式（不要 m3u8 串流，那種存下來 iPhone 網頁播不了），也不用 ffmpeg 合併
VIDEO_FMT = ("b[ext=mp4][vcodec^=avc1][protocol^=http]"
             "/b[ext=mp4][protocol^=http]"
             "/18"
             "/b[protocol^=http]")
AUDIO_FMT = ("bestaudio[ext=m4a][protocol^=http]"
             "/bestaudio[protocol^=http]"
             "/b[ext=mp4][protocol^=http]")


def parse(text):
    """把輸入拆成 [(網址, 是否只要聲音)]"""
    jobs, force_audio = [], False
    for tok in text.split():
        low = tok.lower()
        if low in ("mp3", "m4a", "audio", "music", "音樂"):
            force_audio = True
            continue
        if low in ("mp4", "video", "影片"):
            force_audio = False
            continue
        m = re.match(r"^([vm]):([\w-]{11})$", tok)   # myTube 傳來的影片代號（畫面上不出現網址，避免誤點跳到 YouTube）
        if m:
            vid = m.group(2)
            audio = force_audio or m.group(1) == "m"
            url = f"https://music.youtube.com/watch?v={vid}" if m.group(1) == "m" else f"https://www.youtube.com/watch?v={vid}"
            jobs.append((url, audio))
            continue
        if re.match(r"https?://", tok):
            audio = force_audio or "music.youtube.com" in low
            jobs.append((tok, audio))
    return jobs


def is_ts(path):
    try:
        with open(path, "rb") as f:
            b = f.read(377)
        return len(b) > 188 and b[0] == 0x47 and b[188] == 0x47
    except Exception:
        return False


# 向 YouTube 要影片的不同「身分」：一個不給，就自動換下一個
# 第一階段：完全不用外掛（不會碰到 iPhone 的網頁元件）
SAFE_CLIENTS = ["android_vr", "ios"]
# 第二階段：需要外掛幫忙解 YouTube 驗證
JS_CLIENTS = [None, "tv", "web_safari", "mweb", "web_embedded"]
CLIENTS = SAFE_CLIENTS + JS_CLIENTS
os.environ["YTDLP_NO_PLUGINS"] = "1"   # 一開始先關掉外掛


def enable_plugins():
    if not os.environ.pop("YTDLP_NO_PLUGINS", None):
        return
    try:
        from yt_dlp.globals import all_plugins_loaded
        all_plugins_loaded.value = False   # 下次建立下載器時重新載入外掛
    except Exception:
        pass
    print("   ⚠️ 改用需要外掛的方法。如果跳到 YouTube App，請馬上按左上角「◀ a-Shell」回來。")


def download(url, audio):
    last = None
    for i, client in enumerate(CLIENTS):
        try:
            if client in JS_CLIENTS:
                enable_plugins()
            if i:
                print(f"   ↻ 換方法再試（{i + 1}/{len(CLIENTS)}）…")
            return download_once(url, audio, client)
        except Exception as e:
            last = e
            msg = str(e)
            retry = ("format is not available" in msg or "串流格式" in msg
                     or "Sign in" in msg or "login" in msg.lower() or "403" in msg)
            if not retry:
                raise
    raise last


def download_once(url, audio, client):
    folder = os.path.join(BASE, "音樂" if audio else "影片")
    os.makedirs(folder, exist_ok=True)
    saved = []

    def hook(d):
        if d.get("status") == "downloading":
            tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if tot:
                pct = int(d.get("downloaded_bytes", 0) * 100 / tot)
                if pct // 10 != hook.last // 10:
                    hook.last = pct
                    print(f"   下載中 {pct}%")
        if d.get("status") == "finished" and d.get("filename"):
            saved.append(d["filename"])
    hook.last = -10

    opts = {
        "outtmpl": os.path.join(folder, "%(title).100B.%(ext)s"),
        "noplaylist": True,
        "windowsfilenames": True,
        "format": AUDIO_FMT if audio else VIDEO_FMT,
        "progress_hooks": [hook],
        # 允許從 GitHub 下載 YouTube 解題腳本（就是錯誤訊息建議的 --remote-components ejs:github）
        "remote_components": ["ejs:github"],
        "quiet": True,           # 不印出 YouTube 網址，避免不小心點到跳去 YouTube App
        "no_warnings": True,
        "noprogress": True,
        "continuedl": True,   # 之前下載到一半（.part）會接著下載
    }
    if client:
        opts["extractor_args"] = {"youtube": {"player_client": [client]}}
    if client == CLIENTS[0]:
        print(f"\n▶ 第 {download.n} 個（{'音樂' if audio else '影片'}）準備下載…")
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for p in saved:
        if os.path.exists(p) and is_ts(p):
            os.remove(p)
            raise RuntimeError("YouTube 只給了串流格式（iPhone 網頁播不了），已刪除。"
                               "請執行：python3 -m pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi 再試一次")
    return saved


# ---------------- 電子書離線朗讀：把整本書的語音下載成一個 zip，再匯入 myTube ----------------
TTS_BASE = os.environ.get("MT_TTS_BASE") or "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl={lang}&q={q}"


def read_clipboard():
    try:
        t = os.popen("pbpaste").read()
        if t:
            return t
    except Exception:
        pass
    tmp = os.path.expanduser("~/Documents/.mtjob.txt")
    try:
        os.system(f"pbpaste > '{tmp}'")
        with open(tmp, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def tts_fetch(lang, text):
    import urllib.parse
    import urllib.request
    url = TTS_BASE.format(lang=urllib.parse.quote(lang), q=urllib.parse.quote(text))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    if len(data) < 300:
        raise RuntimeError("聲音檔太小")
    return data


def tts_job():
    import json
    import time
    import zipfile
    from concurrent.futures import ThreadPoolExecutor
    raw = ""
    if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
        raw = open(sys.argv[2], encoding="utf-8").read()
    for _ in range(5):
        if raw.startswith("MYTUBE-TTS1"):
            break
        print("\n" + "=" * 34)
        print("👉 回到 myTube，按「② 複製書的內容」，")
        print("   再回到這裡，按鍵盤的「換行／return」。")
        print("=" * 34)
        input("（好了就按換行）")
        raw = read_clipboard()
        if not raw.startswith("MYTUBE-TTS1"):
            print("❌ 剪貼簿裡不是書的內容，請再按一次 myTube 的「② 複製書的內容」")
    else:
        sys.exit("沒有拿到書的內容，請重新來一次")
    job = json.loads(raw.split("\n", 1)[1])
    items = job["items"]
    title = re.sub(r'[\\/:*?"<>|]', "_", job.get("title") or "book")[:60]
    work = os.path.join(BASE, ".tts", job["book"])
    os.makedirs(work, exist_ok=True)
    todo = [it for it in items if not os.path.exists(os.path.join(work, it[0] + ".mp3"))]
    print(f"\n📖 {job.get('title')}：共 {len(items)} 段聲音，要下載 {len(todo)} 段")
    print("💡 下載時請停在 a-Shell，不要切到別的 App。中斷了再貼一次指令會接著下載。")
    done = [len(items) - len(todo)]
    fails = []

    def one(it):
        h, lang, text = it
        for k in range(4):
            try:
                data = tts_fetch(lang, text)
                with open(os.path.join(work, h + ".mp3"), "wb") as f:
                    f.write(data)
                break
            except Exception as e:
                if k == 3:
                    fails.append((h, str(e)[:80]))
                time.sleep(1.5 * (k + 1))
        done[0] += 1
        if done[0] % 10 == 0 or done[0] == len(items):
            print(f"   {done[0]} / {len(items)}")

    with ThreadPoolExecutor(3) as ex:
        list(ex.map(one, todo))
    have = [it[0] for it in items if os.path.exists(os.path.join(work, it[0] + ".mp3"))]
    out_dir = os.path.join(BASE, "朗讀")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{title}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        z.writestr("info.json", json.dumps({"book": job["book"], "title": job.get("title"), "keys": have}, ensure_ascii=False))
        for h in have:
            z.write(os.path.join(work, h + ".mp3"), h + ".mp3")
    print("\n" + "=" * 34)
    if fails:
        print(f"⚠️ 有 {len(fails)} 段下載失敗（再貼一次指令可以補下載），其他 {len(have)} 段已完成。")
    else:
        print(f"✅ 完成！{len(have)} 段聲音都下載好了。")
    print("👉 回到 myTube，按「③ 匯入下載好的朗讀聲音」，")
    print("   選：我的 iPhone › a-Shell › myTube › 朗讀 ›")
    print(f"   「{title}.zip」")
    print("=" * 34)


def main():
    if TTS_MODE:
        return tts_job()
    text = " ".join(sys.argv[1:])
    if text.strip().lower() == "setup":
        # 安裝頁的「一鍵準備下載工具」：工具已在上面自動裝好，這裡只確認
        try:
            import importlib.metadata as md
            vers = {p: md.version(p) for p in NEEDED}
        except Exception as e:
            sys.exit(f"❌ 工具沒有裝好：{e}\n請再貼一次同樣的指令試試看")
        print("\n" + "=" * 34)
        print("✅ 準備好了！下載工具已安裝：")
        for p, v in vers.items():
            print(f"   • {p} {v}")
        print("\n👉 回到 myTube（按最左上角「◀」或從桌面打開），")
        print("   到「下載」頁貼 YouTube 網址就可以下載了。")
        print("=" * 34)
        return
    if not re.search(r"https?://|\b[vm]:[\w-]{11}\b", text):
        text = input("貼上 YouTube 網址（可以貼很多個，用空白隔開）：")
    jobs = parse(text)
    if not jobs:
        sys.exit("沒有看到網址")
    print("💡 下載時請停在 a-Shell，不要切到別的 App，不然 iPhone 會暫停下載。")

    ok = {"影片": 0, "音樂": 0}
    for i, (url, audio) in enumerate(jobs, 1):
        download.n = i
        try:
            download(url, audio)
            ok["音樂" if audio else "影片"] += 1
        except Exception as e:
            msg = str(e)
            msg = re.sub(r"https?://\S+", "", msg)
            print(f"\n❌ 第 {i} 個失敗：", msg[:300])
            if "format is not available" in msg:
                print("   請執行：python3 -m pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi 再試一次")

    print(f"\n✅ 完成：影片 {ok['影片']} 個、音樂 {ok['音樂']} 個（共 {len(jobs)} 個）")
    if ok["影片"] + ok["音樂"] < len(jobs):
        print("沒下載完的檔案（.part）：再貼一次同樣的指令，會從中斷的地方接著下載。")
    print("\n" + "=" * 34)
    print("👉 按螢幕最左上角的「◀ myTube」回到 myTube")
    print("   myTube 會自動跳出「匯入」按鈕，點檔案就好")
    print("=" * 34)


if __name__ == "__main__":
    main()
