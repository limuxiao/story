from __future__ import annotations

import os
import re
import shutil
import subprocess
import uuid
from typing import Optional

from fastapi import BackgroundTasks, Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config, db, projects, transcode
from .ai_service import parse_command
from .exporter import export_project
from .schemas import ProjectModel

app = FastAPI(title="新形态 AI 音视频剪辑 · 后端（组合 B 全自托管）")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=config.STORAGE), name="storage")


def _safe_ext(name: str) -> str:
    _, ext = os.path.splitext(name)
    return ext.lower() or ".mp4"


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/sources")
def list_sources():
    return db.list_sources()


@app.get("/api/poster/{sid}")
def poster(sid: str):
    """素材卡片缩略图：从已有 720p 代理按需抽首帧并缓存，不改 db / 上传 / 导出链路。"""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", sid):
        raise HTTPException(status_code=404, detail="bad source id")
    mp4_dir = os.path.join(config.MP4_DIR, sid)
    proxy = os.path.join(mp4_dir, "clip_720.mp4")
    out = os.path.join(mp4_dir, "poster.jpg")
    if not os.path.exists(proxy):
        raise HTTPException(status_code=404, detail="proxy not found")
    if not os.path.exists(out):
        subprocess.run(
            ["ffmpeg", "-y", "-ss", "0", "-i", proxy, "-frames:v", "1",
             "-vf", "scale=320:-1", "-q:v", "4", out],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    if not os.path.exists(out):
        raise HTTPException(status_code=404, detail="poster failed")
    return FileResponse(out, media_type="image/jpeg")


def _check_sid(sid: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", sid):
        raise HTTPException(status_code=404, detail="bad source id")
    return os.path.join(config.MP4_DIR, sid, "clip_720.mp4")


@app.get("/api/thumbs/{sid}/meta")
def thumbs_meta(sid: str):
    """该素材缩略图的元信息（张数 / 间隔 / 尺寸）。首次调用按秒抽帧并落盘。"""
    proxy = _check_sid(sid)
    meta = transcode.ensure_thumbnails(sid, proxy)
    if not meta:
        raise HTTPException(status_code=404, detail="thumbnails not available")
    return meta


@app.get("/api/thumb/{sid}/{name}")
def thumb(sid: str, name: str):
    """按编号取单张缩略图：0001.jpg 对应源时间 0 秒，0002 对应 1 秒 ..."""
    proxy = _check_sid(sid)
    if not re.fullmatch(r"\d{4,}", name):
        raise HTTPException(status_code=404, detail="bad thumb number")
    n = int(name)
    path = os.path.join(transcode.thumb_dir(sid), f"{n:04d}.jpg")
    if not os.path.isfile(path):
        meta = transcode.ensure_thumbnails(sid, proxy)
        if not meta or n < 1 or n > meta["count"]:
            raise HTTPException(status_code=404, detail="thumb out of range")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="thumb not found")
    return FileResponse(
        path, media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
# 单次 Range 上限：足够容纳超长素材的 moov 索引，但绝不可能把整段 mdat 拉回来。
_MEDIA_MAX_RANGE = 16 * 1024 * 1024


@app.get("/api/media/{sid}/{tag}")
def media_range(sid: str, tag: str, request: Request):
    """按字节范围返回代理 MP4。

    前端解码 Worker 拿到 moov 索引后，按 5 秒窗口计算样本字节偏移，
    每次只请求该窗口的数据（数百 KB），而非把整段视频（可达数百 MB）拉进浏览器。
    Starlette 的 StaticFiles 不处理 Range，所以这里单独实现 206 Partial Content。
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]+", sid) or tag not in ("720", "480"):
        raise HTTPException(status_code=404, detail="bad media path")
    path = os.path.join(config.MP4_DIR, sid, f"clip_{tag}.mp4")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="media not found")
    total = os.path.getsize(path)
    m = _RANGE_RE.fullmatch(request.headers.get("range", "").strip())
    if not m:
        raise HTTPException(status_code=416, detail="Range header required")
    first, last = m.group(1), m.group(2)
    if not first:
        if not last:
            raise HTTPException(status_code=416, detail="bad range")
        length = min(int(last), total, _MEDIA_MAX_RANGE)
        start, end = total - length, total - 1
    else:
        start = int(first)
        end = int(last) if last else total - 1
        if start >= total or end < start:
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{total}", "Accept-Ranges": "bytes"},
            )
        end = min(end, total - 1, start + _MEDIA_MAX_RANGE - 1)
    with open(path, "rb") as f:
        f.seek(start)
        data = f.read(end - start + 1)
    return Response(
        content=data,
        status_code=206,
        media_type="video/mp4",
        headers={
            "Content-Range": f"bytes {start}-{end}/{total}",
            "Content-Length": str(len(data)),
            "Accept-Ranges": "bytes",
            "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/upload")
async def upload(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    sid = uuid.uuid4().hex
    ext = _safe_ext(file.filename or "video.mp4")
    stored = f"{sid}{ext}"
    origin_path = os.path.join(config.ORIGIN_DIR, stored)
    with open(origin_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    info = transcode.probe(origin_path)
    mp4_dir = os.path.join(config.MP4_DIR, sid)
    transcode.make_proxy(origin_path, mp4_dir)

    preview_url = f"/storage/mp4/{sid}/clip_720.mp4"
    original_url = f"/storage/origin/{stored}"
    source = {
        "id": sid,
        "name": file.filename or stored,
        "width": info["width"],
        "height": info["height"],
        "duration": info["duration"],
        "preview_url": preview_url,
        "original_url": original_url,
    }
    db.insert_source(source)
    # 响应返回后台预热缩略图；首次打开时间轴不必等 ffmpeg 抽帧。
    background_tasks.add_task(
        transcode.ensure_thumbnails, sid, os.path.join(mp4_dir, "clip_720.mp4")
    )
    return source


@app.post("/api/export")
def export(project: ProjectModel):
    try:
        out_path = export_project(project.model_dump())
    except Exception as e:
        return {"ok": False, "error": str(e)}
    rel = os.path.relpath(out_path, config.STORAGE)
    return {"ok": True, "url": f"/storage/{rel}"}


@app.post("/api/ai/command")
def ai_command(payload: dict):
    text = payload.get("text", "")
    clip = payload.get("clip")
    return parse_command(text, clip)


# ---- 工程：以 XML 文件为唯一数据源，元数据写在 <timelines> 根属性上 ----

def _check_pid(pid: str) -> str:
    if not projects.valid_pid(pid):
        raise HTTPException(status_code=404, detail="bad project id")
    return pid


@app.get("/api/projects")
def project_list():
    return projects.list_projects()


@app.post("/api/projects")
def project_create(payload: Optional[dict] = Body(default=None)):
    name = str((payload or {}).get("name") or "未命名项目").strip() or "未命名项目"
    return projects.create_project(name)


@app.get("/api/projects/{pid}")
def project_get(pid: str):
    _check_pid(pid)
    doc = projects.get_project(pid)
    if not doc:
        raise HTTPException(status_code=404, detail="project not found")
    return doc


@app.get("/api/projects/{pid}/xml")
def project_xml(pid: str):
    _check_pid(pid)
    text = projects.get_xml(pid)
    if text is None:
        raise HTTPException(status_code=404, detail="project not found")
    return Response(content=text, media_type="application/xml; charset=utf-8")


@app.put("/api/projects/{pid}")
def project_update(pid: str, payload: Optional[dict] = Body(default=None)):
    _check_pid(pid)
    doc = projects.save_project(pid, payload or {})
    if not doc:
        raise HTTPException(status_code=404, detail="project not found")
    return doc


@app.delete("/api/projects/{pid}")
def project_delete(pid: str):
    _check_pid(pid)
    if not projects.delete_project(pid):
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True}
