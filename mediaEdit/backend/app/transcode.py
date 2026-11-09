from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Dict

from . import config


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
