from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from typing import Any, Dict

from . import config

# 时间轴缩略图规格：每秒一张，高度固定 60px、宽度按素材比例自动缩放。
THUMB_INTERVAL = 1.0
THUMB_HEIGHT = 60
THUMB_META = "meta.json"


def probe(path: str) -> Dict[str, Any]:
    """ffprobe 取宽/高/时长。"""
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
    ]
    out = subprocess.check_output(cmd)
    info = json.loads(out)
    w = h = 0
    for s in info.get("streams", []):
        if s.get("codec_type") == "video":
            w = s.get("width") or w
            h = s.get("height") or h
    dur = float(info.get("format", {}).get("duration", 0) or 0)
    return {"width": int(w or 0), "height": int(h or 0), "duration": dur}


def make_proxy(origin_path: str, mp4_dir: str) -> Dict[str, str]:
    """ffmpeg 出两档单文件代理 MP4（H.264+AAC，faststart），供前端 mp4box 解封装。
    对应技术方案 4.2/7.3：预览用代理分辨率，原片仅导出时引用。"""
    os.makedirs(mp4_dir, exist_ok=True)
    outs: Dict[str, str] = {}
    for tag, height in (("720", 720), ("480", 480)):
        out = os.path.join(mp4_dir, f"clip_{tag}.mp4")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            origin_path,
            "-vf",
            f"scale=-2:{height}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            out,
        ]
        subprocess.run(
            cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        outs[tag] = out
    return outs


_thumb_locks: Dict[str, threading.Lock] = {}
_thumb_locks_guard = threading.Lock()


def thumb_dir(sid: str) -> str:
    """同一素材的所有缩略图集中在一个文件夹下。"""
    return os.path.join(config.THUMB_DIR, sid)


def _thumb_lock(sid: str) -> threading.Lock:
    with _thumb_locks_guard:
        return _thumb_locks.setdefault(sid, threading.Lock())


def _probe_image_size(path: str) -> Dict[str, int]:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        w, h = out.split("x")[:2]
        return {"width": int(w), "height": int(h)}
    except Exception:
        return {"width": 0, "height": THUMB_HEIGHT}


def ensure_thumbnails(sid: str, proxy_path: str) -> Dict[str, Any] | None:
    """按 1 秒间隔抽帧，等比缩放到 60px 高，输出 0001.jpg / 0002.jpg ...

    meta.json 既是元信息也是「生成完成」标记：写它之前请求方会一直等待锁，
    避免并发抽帧或读到半成品目录。生成一次后落盘复用，后续请求零 ffmpeg 开销。
    """
    out_dir = thumb_dir(sid)
    meta_path = os.path.join(out_dir, THUMB_META)
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    if not os.path.isfile(proxy_path):
        return None

    with _thumb_lock(sid):
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        os.makedirs(out_dir, exist_ok=True)
        # fps=1 → 第 n 张对应源时间 (n-1) 秒；scale=-2:60 等比缩放且宽度为偶数。
        subprocess.run(
            ["ffmpeg", "-y", "-i", proxy_path,
             "-vf", f"fps={1 / THUMB_INTERVAL:g},scale=-2:{THUMB_HEIGHT}",
             "-q:v", "5", "-start_number", "1",
             os.path.join(out_dir, "%04d.jpg")],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        files = [f for f in os.listdir(out_dir) if re.fullmatch(r"\d{4,}\.jpg", f)]
        if not files:
            return None
        size = _probe_image_size(os.path.join(out_dir, sorted(files)[0]))
        meta = {
            "count": len(files),
            "interval": THUMB_INTERVAL,
            "width": size["width"],
            "height": size["height"],
        }
        tmp = meta_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(meta, f)
        os.replace(tmp, meta_path)
        return meta
