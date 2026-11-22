"""
myTube 手機下載小工具（在 iPhone 的 a-Shell App 裡執行）
用法：
  python3 mt.py                      → 會問你網址，預設下載影片
  python3 mt.py 網址1 網址2           → 一次下載多個影片
  python3 mt.py mp3 網址              → 只下載聲音（存成 m4a，myTube 可以直接播）
檔案會存到「檔案」App → a-Shell → myTube → 影片 / 音樂
"""
import os
import re
import sys

try:
    import yt_dlp
except ImportError:
    sys.exit("找不到 yt-dlp，請先執行：python3 -m pip install -U yt-dlp")

args = sys.argv[1:]
audio = False
if args and args[0].lower() in ("mp3", "m4a", "audio", "music"):
    audio = True
    args = args[1:]
elif args and args[0].lower() in ("mp4", "video"):
    args = args[1:]

text = " ".join(args)
if not re.search(r"https?://", text):
    text = input("貼上 YouTube 網址（可以貼很多個，用空白隔開）：")
urls = re.findall(r"https?://[^\s]+", text)
if not urls:
    sys.exit("沒有看到網址")

base = os.path.expanduser("~/Documents/myTube")
folder = os.path.join(base, "音樂" if audio else "影片")
os.makedirs(folder, exist_ok=True)

opts = {
    "outtmpl": os.path.join(folder, "%(title).100B.%(ext)s"),
    "noplaylist": True,
    "windowsfilenames": True,
    # a-Shell 沒有 ffmpeg，所以只選「本來就是一個檔案」的格式，不需要合併
    "format": "bestaudio[ext=m4a]/bestaudio" if audio else "b[ext=mp4][height<=720]/b[ext=mp4]/b",
}

ok = 0
for u in urls:
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([u])
        ok += 1
    except Exception as e:
        print("\n❌ 失敗：", u, "\n  ", str(e)[:300])
        if "JavaScript" in str(e) or "runtime" in str(e):
            print("   提示：試試 python3 -m pip install -U yt-dlp-apple-webkit-jsi")

print(f"\n完成 {ok}/{len(urls)} 個。")
print("到「檔案」App → a-Shell → myTube →", "音樂" if audio else "影片")
print("回 myTube 按「載入手機裡的" + ("音樂" if audio else "影片") + "」選它們就能看了。")
