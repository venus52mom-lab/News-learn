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
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent          # myTube 網頁檔案所在資料夾
WORK = Path(tempfile.gettempdir()) / "mytube-dl"       # 暫存下載檔
WORK.mkdir(parents=True, exist_ok=True)
MAX_PARALLEL = int(os.environ.get("MYTUBE_PARALLEL", "3"))
KEEP_SECONDS = 2 * 3600

app = FastAPI(title="myTube Server")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Disposition"],
)


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
    }
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
                raise RuntimeError("找不到下載好的檔案")
            path = max(match, key=lambda f: f.stat().st_size)
            job.update(path=str(path), filename=path.name, size=path.stat().st_size, progress=1.0, status="done")
        except Exception as e:  # noqa
            msg = str(e)
            msg = re.sub(r"\x1b\[[0-9;]*m", "", msg).replace("ERROR: ", "")
            if "ffmpeg" in msg.lower():
                msg = "需要安裝 ffmpeg 才能轉 MP3 / 合併高畫質影片。" + msg
            job.update(status="error", error=msg[:400])


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
def health():
    return {"ok": True, "ytdlp": yt_dlp.version.__version__,
            "ffmpeg": bool(shutil.which("ffmpeg")), "deno": bool(shutil.which("deno"))}


@app.post("/api/jobs")
def create_job(req: JobReq):
    if not YT_RE.match(req.url.strip()):
        raise HTTPException(400, "只支援 YouTube 網址")
    if req.format not in ("mp4", "mp3"):
        raise HTTPException(400, "格式只能是 mp4 或 mp3")
    if req.quality not in ("best", "1080", "720", "480", "360"):
        req.quality = "720"
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


# 同時提供 myTube 網頁（index.html 等）
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
    if not shutil.which("ffmpeg"):
        print("⚠️  找不到 ffmpeg：MP3 和高畫質影片會失敗，請先安裝 ffmpeg")
    if not shutil.which("deno"):
        print("⚠️  找不到 Deno：YouTube 下載可能失敗，請先安裝 Deno（見 README）")
    print()
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
