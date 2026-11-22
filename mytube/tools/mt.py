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

try:
    import yt_dlp
except ImportError:
    sys.exit("找不到 yt-dlp，請先執行：python3 -m pip install -U yt-dlp yt-dlp-apple-webkit-jsi")

try:
    import importlib.metadata as md
    md.version("yt-dlp-apple-webkit-jsi")
except Exception:
    print("⚠️  還沒安裝 iPhone 用的 JavaScript 外掛，影片可能只能抓到無法播放的格式。")
    print("   請先執行：python3 -m pip install -U yt-dlp-apple-webkit-jsi\n")

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


def download(url, audio):
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
    }
    print(f"\n▶ {'音樂' if audio else '影片'}：{url}")
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for p in saved:
        if os.path.exists(p) and is_ts(p):
            os.remove(p)
            raise RuntimeError("YouTube 只給了串流格式（iPhone 網頁播不了），已刪除。"
                               "請執行：python3 -m pip install -U yt-dlp yt-dlp-apple-webkit-jsi 再試一次")
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
                print("   請執行：python3 -m pip install -U yt-dlp yt-dlp-apple-webkit-jsi 再試一次")

    print(f"\n✅ 完成：影片 {ok['影片']} 個、音樂 {ok['音樂']} 個（共 {len(jobs)} 個）")
    print("回到 myTube 按「匯入手機檔案」，到 a-Shell → myTube 選檔案，會自動分到影片或音樂。")


if __name__ == "__main__":
    main()
