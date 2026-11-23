"""
myTube 下載伺服器（放在你自己的 Windows / Mac 電腦執行）
- 用 yt-dlp 下載 YouTube，輸出 MP4（iPhone 相容的 H.264 + AAC）或 MP3
- 同時提供 myTube 網頁本身：在電腦執行後，手機開 http://電腦IP:8000 也能用

執行：python server.py      （預設 port 8000，可用環境變數 PORT 改）
"""
import os
import re
import shutil
import socket
import tempfile
import threading
import time
import urllib.request
import uuid
from pathlib import Path

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent          # myTube 網頁檔案所在資料夾
WORK = Path(os.environ.get("MYTUBE_WORK", str(Path(tempfile.gettempdir()) / "mytube-dl")))   # 暫存下載檔
WORK.mkdir(parents=True, exist_ok=True)
# 啟動時清掉上次留下的暫存檔
for _old in WORK.iterdir():
    shutil.rmtree(_old, ignore_errors=True) if _old.is_dir() else _old.unlink(missing_ok=True)
MIN_FREE_GB = float(os.environ.get("MYTUBE_MIN_FREE_GB", "3"))       # 硬碟剩不到這麼多就不接新下載，保護其他程式
MAX_FILE_MB = int(os.environ.get("MYTUBE_MAX_FILE_MB", "1500"))      # 單一檔案上限
MAX_PARALLEL = int(os.environ.get("MYTUBE_PARALLEL", "3"))
TOKEN = os.environ.get("MYTUBE_TOKEN", "").strip()            # 下載密碼（雲端伺服器一定要設）
API_ONLY = os.environ.get("MYTUBE_API_ONLY", "") == "1"       # 只提供下載 API，不提供網頁檔案
COOKIES = Path(os.environ.get("MYTUBE_COOKIES", str(Path(__file__).resolve().parent / "cookies.txt")))
KEEP_SECONDS = 30 * 60     # 手機沒來拿的檔案，30 分鐘後自動刪除

app = FastAPI(title="myTube Server")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Disposition"],
)


@app.middleware("http")
async def check_token(request: Request, call_next):
    # 有設密碼時，除了 /api/health 以外的 API 都要帶正確密碼
    p = request.url.path
    if TOKEN and p.startswith("/api/") and p != "/api/health" and request.method != "OPTIONS":
        key = request.headers.get("x-mytube-key") or request.query_params.get("key", "")
        if key != TOKEN:
            return JSONResponse({"detail": "下載密碼不正確"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def private_network(request: Request, call_next):
    # 讓 Chrome 允許 https 網頁連到區域網路的伺服器
    resp = await call_next(request)
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


JOBS: dict[str, dict] = {}
SEM = threading.Semaphore(MAX_PARALLEL)
YT_RE = re.compile(r"^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/", re.I)


class JobReq(BaseModel):
    url: str
    format: str = "mp4"      # mp4 | mp3
    quality: str = "720"     # best | 1080 | 720 | 480 | 360


def video_format(q: str) -> str:
    h = "" if q == "best" else f"[height<={int(q)}]"
    # 優先 H.264(avc1)+AAC，iPhone / 所有瀏覽器都能播
    return (f"bv*[vcodec^=avc1]{h}+ba[ext=m4a]/"
            f"bv*[ext=mp4]{h}+ba[ext=m4a]/"
            f"b[ext=mp4]{h}/b{h}/b")


def run_job(job: dict):
    folder = WORK / job["id"]
    folder.mkdir(parents=True, exist_ok=True)

    def hook(p):
        if p.get("status") == "downloading":
            total = p.get("total_bytes") or p.get("total_bytes_estimate") or 0
            if total:
                frac = min(1.0, (p.get("downloaded_bytes") or 0) / total)
                job["progress"] = round((job["phase"] + frac) / job["phases"], 3)
        elif p.get("status") == "finished":
            job["phase"] = min(job["phase"] + 1, job["phases"])

    def pp_hook(p):
        if p.get("status") == "started":
            job["status"] = "processing"

    opts = {
        "outtmpl": str(folder / "%(title).120B.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "progress_hooks": [hook],
        "postprocessor_hooks": [pp_hook],
        "concurrent_fragment_downloads": 4,
        "remote_components": ["ejs:github"],   # YouTube 驗證需要的解題腳本
        "max_filesize": MAX_FILE_MB * 1024 * 1024,
    }
    if COOKIES.exists():
        opts["cookiefile"] = str(COOKIES)       # 雲端主機常被 YouTube 擋，用登入的 cookies 比較不會
    if job["format"] == "mp3":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    else:
        opts["format"] = video_format(job["quality"])
        opts["merge_output_format"] = "mp4"

    with SEM:
        try:
            job["status"] = "downloading"
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(job["url"], download=False)
                job["title"] = info.get("title") or "myTube"
                job["duration"] = info.get("duration") or 0
                vid = info.get("id")
                job["thumb_url"] = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else info.get("thumbnail")
                job["phases"] = len(info.get("requested_formats") or []) or 1
                ydl.process_ie_result(info, download=True)

            want = ".mp3" if job["format"] == "mp3" else ".mp4"
            files = [f for f in folder.iterdir() if f.is_file() and not f.name.endswith((".part", ".ytdl"))]
            match = [f for f in files if f.suffix.lower() == want] or files
            if not match:
                raise RuntimeError(f"沒有下載到檔案（可能影片超過 {MAX_FILE_MB} MB 上限，請改選較低畫質）")
            path = max(match, key=lambda f: f.stat().st_size)
            job.update(path=str(path), filename=path.name, size=path.stat().st_size, progress=1.0, status="done")
        except Exception as e:  # noqa
            msg = str(e)
            msg = re.sub(r"\x1b\[[0-9;]*m", "", msg).replace("ERROR: ", "")
            if "File is larger than max-filesize" in msg or "max-filesize" in msg:
                msg = f"影片太大（超過 {MAX_FILE_MB} MB），為了保護伺服器不下載。可以改選較低畫質。"
            elif "ffmpeg" in msg.lower():
                msg = "需要安裝 ffmpeg 才能轉 MP3 / 合併高畫質影片。" + msg
            job.update(status="error", error=msg[:400])
            shutil.rmtree(folder, ignore_errors=True)   # 失敗的暫存檔馬上刪掉


def cleanup_loop():
    while True:
        time.sleep(600)
        now = time.time()
        for jid, job in list(JOBS.items()):
            if now - job["created"] > KEEP_SECONDS:
                shutil.rmtree(WORK / jid, ignore_errors=True)
                JOBS.pop(jid, None)


threading.Thread(target=cleanup_loop, daemon=True).start()


@app.get("/api/health")
def health(request: Request):
    key = request.headers.get("x-mytube-key", "")
    return {"ok": True, "ytdlp": yt_dlp.version.__version__,
            "ffmpeg": bool(shutil.which("ffmpeg")), "deno": bool(shutil.which("deno")),
            "cookies": COOKIES.exists(), "auth": (not TOKEN) or key == TOKEN, "needToken": bool(TOKEN)}


@app.post("/api/jobs")
def create_job(req: JobReq):
    if not YT_RE.match(req.url.strip()):
        raise HTTPException(400, "只支援 YouTube 網址")
    if req.format not in ("mp4", "mp3"):
        raise HTTPException(400, "格式只能是 mp4 或 mp3")
    if req.quality not in ("best", "1080", "720", "480", "360"):
        req.quality = "720"
    free_gb = shutil.disk_usage(WORK).free / 1024 ** 3
    if free_gb < MIN_FREE_GB:
        raise HTTPException(507, f"伺服器硬碟空間不夠（剩 {free_gb:.1f} GB），為了保護其他程式暫停下載")
    busy = sum(1 for j in JOBS.values() if j["status"] in ("queued", "downloading", "processing"))
    if busy >= 10:
        raise HTTPException(429, "伺服器正在忙，請等一下再下載")
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "url": req.url.strip(), "format": req.format, "quality": req.quality,
           "status": "queued", "progress": 0.0, "phase": 0, "phases": 1, "created": time.time(),
           "title": None, "error": None}
    JOBS[jid] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return {"id": jid}


def get_job(jid: str) -> dict:
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "找不到這個下載工作（可能已過期）")
    return job


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    j = get_job(jid)
    return {k: j.get(k) for k in ("id", "status", "progress", "title", "error", "filename", "size", "duration")}


@app.get("/api/jobs/{jid}/file")
def job_file(jid: str):
    j = get_job(jid)
    if j["status"] != "done":
        raise HTTPException(409, "還沒下載完成")
    media = "audio/mpeg" if j["format"] == "mp3" else "video/mp4"
    return FileResponse(j["path"], media_type=media, filename=j["filename"])


@app.get("/api/jobs/{jid}/thumb")
def job_thumb(jid: str):
    j = get_job(jid)
    if not j.get("thumb_url"):
        raise HTTPException(404, "沒有縮圖")
    try:
        req = urllib.request.Request(j["thumb_url"], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return Response(r.read(), media_type=r.headers.get("Content-Type", "image/jpeg"))
    except Exception:
        raise HTTPException(404, "縮圖下載失敗")


@app.delete("/api/jobs/{jid}")
def job_delete(jid: str):
    JOBS.pop(jid, None)
    shutil.rmtree(WORK / jid, ignore_errors=True)
    return {"ok": True}


# ================= 電子書：翻譯 / 朗讀 / 抓網頁 =================
import ipaddress
import json as _json
import urllib.parse
from html.parser import HTMLParser

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
VOICES = {
    "zh-TW": "zh-TW-HsiaoChenNeural", "zh-CN": "zh-CN-XiaoxiaoNeural", "en": "en-US-AriaNeural",
    "ja": "ja-JP-NanamiNeural", "ko": "ko-KR-SunHiNeural", "de": "de-DE-KatjaNeural",
    "fr": "fr-FR-DeniseNeural", "es": "es-ES-ElviraNeural", "it": "it-IT-ElsaNeural",
    "pt": "pt-BR-FranciscaNeural", "ru": "ru-RU-SvetlanaNeural", "th": "th-TH-PremwadeeNeural",
    "vi": "vi-VN-HoaiMyNeural",
}


class TransReq(BaseModel):
    q: list[str]
    tl: str = "zh-TW"
    sl: str = "auto"


def _gtx(text: str, tl: str, sl: str = "auto"):
    data = urllib.parse.urlencode({"q": text}).encode()
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={urllib.parse.quote(sl)}&tl={urllib.parse.quote(tl)}&dt=t"
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=20) as r:
        j = _json.loads(r.read().decode("utf-8"))
    return "".join(x[0] for x in (j[0] or []) if x and x[0]), (j[2] if len(j) > 2 else None)


@app.post("/api/translate")
def translate(req: TransReq):
    lines = [x.replace("\n", " ") for x in req.q][:200]
    try:
        text, src = _gtx("\n".join(lines), req.tl, req.sl)
        out = text.split("\n")
        if len(out) != len(lines):
            out = [_gtx(l, req.tl, req.sl)[0] if l.strip() else "" for l in lines]
        return {"lines": [o.strip() for o in out], "src": src}
    except Exception as e:  # noqa
        raise HTTPException(502, f"翻譯失敗：{e}")


@app.get("/api/tts")
async def tts(text: str, lang: str = "en"):
    try:
        import edge_tts
    except ImportError:
        raise HTTPException(501, "伺服器沒有安裝 edge-tts")
    voice = VOICES.get(lang) or VOICES.get(lang.split("-")[0], VOICES["en"])
    buf = bytearray()
    try:
        async for chunk in edge_tts.Communicate(text[:1200], voice).stream():
            if chunk["type"] == "audio":
                buf.extend(chunk["data"])
    except Exception as e:  # noqa
        raise HTTPException(502, f"語音產生失敗：{e}")
    return Response(bytes(buf), media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=604800"})


def _safe_url(url: str):
    """只允許抓公開網站，避免碰到伺服器內部的服務（例如你的交易程式）"""
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(400, "網址格式不對")
    try:
        infos = socket.getaddrinfo(p.hostname, None)
    except Exception:
        raise HTTPException(400, "找不到這個網站")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(400, "不允許的網址")


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg"}
    BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "div", "br", "tr", "section", "article"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0; self.buf = []; self.paras = []; self.title = ""; self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.skip += 1
        if tag == "title": self.in_title = True
        if tag in self.BLOCK: self._flush()

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip: self.skip -= 1
        if tag == "title": self.in_title = False
        if tag in self.BLOCK: self._flush()

    def handle_data(self, d):
        if self.in_title: self.title += d; return
        if not self.skip: self.buf.append(d)

    def _flush(self):
        t = " ".join("".join(self.buf).split())
        if len(t) > 1: self.paras.append(t)
        self.buf = []


@app.get("/api/fetch")
def fetch_page(url: str, raw: int = 0):
    _safe_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            data = r.read(30 * 1024 * 1024)
            ctype = r.headers.get("Content-Type", "")
    except Exception as e:  # noqa
        raise HTTPException(502, f"抓不到這個網頁：{e}")
    if raw or not ctype.startswith("text/html"):
        return Response(data, media_type=ctype or "application/octet-stream")
    m = re.search(r"charset=([\w-]+)", ctype)
    html = data.decode(m.group(1) if m else "utf-8", errors="replace")
    t = _Text(); t.feed(html); t._flush()
    paras = [p for p in t.paras if len(p) > 1]
    return {"title": " ".join(t.title.split()), "paras": paras}


# 同時提供 myTube 網頁（只有在 myTube 資料夾裡執行時；雲端只開 API）
if not API_ONLY and (ROOT / "index.html").exists():
    app.mount("/", StaticFiles(directory=ROOT, html=True), name="web")


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    print("\n=== myTube 下載伺服器已啟動 ===")
    print(f"電腦上開：  http://localhost:{port}")
    print(f"手機（同一個 Wi-Fi）開：  http://{lan_ip()}:{port}")
    print("下載密碼：", TOKEN or "（沒有設定）")
    print("YouTube cookies：", "有" if COOKIES.exists() else "沒有（雲端主機建議放 cookies.txt）")
    if not shutil.which("ffmpeg"):
        print("⚠️  找不到 ffmpeg：MP3 和高畫質影片會失敗，請先安裝 ffmpeg")
    if not shutil.which("deno"):
        print("⚠️  找不到 Deno：YouTube 下載可能失敗，請先安裝 Deno（見 README）")
    print()
    host = os.environ.get("MYTUBE_HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port, log_level="warning")
