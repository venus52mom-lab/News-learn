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
        pip_main(["install", "-q", "-U"] + missing)
    except Exception as e:
        print("   自動安裝失敗：", e)
        print("   請手動執行：python3 -m pip install -U " + " ".join(NEEDED))
    importlib.invalidate_caches()


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
CLIENTS = [None, "android_vr", "tv", "web_safari", "mweb", "ios", "web_embedded"]


def download(url, audio):
    last = None
    for i, client in enumerate(CLIENTS):
        try:
            if i:
                print(f"   ↻ 換方法再試（{i + 1}/{len(CLIENTS)}：{client}）…")
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
        if d.get("status") == "finished" and d.get("filename"):
            saved.append(d["filename"])

    opts = {
        "outtmpl": os.path.join(folder, "%(title).100B.%(ext)s"),
        "noplaylist": True,
        "windowsfilenames": True,
        "format": AUDIO_FMT if audio else VIDEO_FMT,
        "progress_hooks": [hook],
        # 允許從 GitHub 下載 YouTube 解題腳本（就是錯誤訊息建議的 --remote-components ejs:github）
        "remote_components": ["ejs:github"],
        "quiet": client is not None,
        "no_warnings": client is not None,
    }
    if client:
        opts["extractor_args"] = {"youtube": {"player_client": [client]}}
    if client is None:
        print(f"\n▶ {'音樂' if audio else '影片'}：{url}")
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for p in saved:
        if os.path.exists(p) and is_ts(p):
            os.remove(p)
            raise RuntimeError("YouTube 只給了串流格式（iPhone 網頁播不了），已刪除。"
                               "請執行：python3 -m pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi 再試一次")
    return saved


def main():
    text = " ".join(sys.argv[1:])
    if not re.search(r"https?://", text):
        text = input("貼上 YouTube 網址（可以貼很多個，用空白隔開）：")
    jobs = parse(text)
    if not jobs:
        sys.exit("沒有看到網址")

    ok = {"影片": 0, "音樂": 0}
    for url, audio in jobs:
        try:
            download(url, audio)
            ok["音樂" if audio else "影片"] += 1
        except Exception as e:
            msg = str(e)
            print("\n❌ 失敗：", url, "\n  ", msg[:300])
            if "format is not available" in msg:
                print("   請執行：python3 -m pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi 再試一次")

    print(f"\n✅ 完成：影片 {ok['影片']} 個、音樂 {ok['音樂']} 個（共 {len(jobs)} 個）")
    print("回到 myTube 按「匯入手機檔案」，到 a-Shell → myTube 選檔案，會自動分到影片或音樂。")


if __name__ == "__main__":
    main()
