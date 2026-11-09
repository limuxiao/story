from __future__ import annotations

import os
import subprocess
import uuid

from . import config


def _url_to_local(url: str) -> str:
    p = url
    if p.startswith("http"):
        from urllib.parse import urlparse

        p = urlparse(p).path
    if p.startswith("/storage/"):
        p = os.path.join(config.STORAGE, p[len("/storage/") :])
    return p


_dims_cache: dict = {}


def _probe_dims(path: str) -> tuple[int, int]:
    if path in _dims_cache:
        return _dims_cache[path]
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_entries",
                "stream=width,height",
                "-select_streams",
                "v:0",
                path,
            ]
        )
        info = json.loads(out)
        w = h = 0
        for s in info.get("streams", []):
            w = s.get("width") or w
            h = s.get("height") or h
        res = (int(w or 0), int(h or 0))
    except Exception:
        res = (0, 0)
    _dims_cache[path] = res
    return res


def _atempo_chain(speed: float) -> str:
    """atempo 仅支持 0.5~2.0；超出则链式拼接。返回形如 'atempo=1.5,' 的片段（无前导逗号）。"""
    if speed == 1.0:
        return ""
    parts: list[str] = []
    remaining = speed
    while remaining > 2.0:
        parts.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        parts.append("atempo=0.5")
        remaining *= 2.0
    parts.append(f"atempo={remaining:.3f}")
    return ",".join(parts) + ","


def export_project(project: dict) -> str:
    seq = project.get("sequence", {}) or {}
    W = int(seq.get("width", 1280))
    H = int(seq.get("height", 720))
    fps = int(seq.get("fps", 30))
    tracks = project.get("tracks", []) or []

    clips: list[dict] = []
    for tr in tracks:
        ttype = (tr.get("type") or "video").lower()
        for c in tr.get("clips", []) or []:
            c = dict(c)
            c["_type"] = ttype
            clips.append(c)
    if not clips:
        raise ValueError("工程为空，没有可导出的片段")

    inputs: list[str] = []
    vfilters: list[str] = []
    afilters: list[str] = []
    voverlays: list[tuple[str, str]] = []
    amap_labels: list[str] = []
    idx = 0
    DUR = 0.1

    for c in clips:
        src = c.get("url") or c.get("src")
        if not src:
            continue
        local = _url_to_local(src)
        if not os.path.exists(local):
            raise ValueError(f"找不到素材文件: {src}")
        ss = float(c.get("srcIn", 0) or 0)
        to = float(c.get("srcOut", 0) or 0)
        dur = max(0.1, to - ss)
        sp = float(c.get("speed", 1.0) or 1.0)
        ts = float(c.get("timelineStart", 0.0) or 0.0)
        te = ts + dur / sp
        DUR = max(DUR, te)
        fi = float(c.get("fadeIn", 0) or 0)
        fo = float(c.get("fadeOut", 0) or 0)

        inputs += ["-i", local]

        if c["_type"] != "audio":
            # 视频：trim 源区间 → 0 基准变速 → 淡入淡出 → contain 缩放到整数尺寸 →
            # 平移到时间轴位置（用整数居中偏移，避免 ffmpeg 表达式解析问题）。
            sw, sh = _probe_dims(local)
            if sw and sh:
                sc = min(W / sw, H / sh)
                dw = max(1, round(sw * sc))
                dh = max(1, round(sh * sc))
            else:
                dw, dh = W, H
            xoff = float(c.get("x", 0) or 0)
            yoff = float(c.get("y", 0) or 0)
            cx = round((W - dw) / 2 + xoff)
            cy = round((H - dh) / 2 + yoff)
            clip_dur = dur / sp  # 变速后的片段时长
            filt = (
                f"trim=start={ss:.3f}:end={to:.3f},"
                f"setpts=(1/{sp:.4f})*(PTS-STARTPTS)"
            )
            if fi > 0:
                filt += f",fade=t=in:st=0:d={fi:.3f}"
            if fo > 0:
                filt += f",fade=t=out:st={max(0.0, clip_dur - fo):.3f}:d={fo:.3f}"
            filt += f",scale={dw}:{dh},setsar=1"
            op = float(c.get("opacity", 1.0) or 1.0)
            if op < 1:
                filt += f",format=rgba,colorchannelmixer=aa={op:.3f}"
            for e in c.get("effects", []) or []:
                t = e.get("type")
                v = (e.get("params") or {}).get("value", 0)
                if t == "brightness":
                    filt += f",eq=brightness={v:.3f}"
                elif t == "contrast":
                    filt += f",eq=contrast={v:.3f}"
                elif t == "saturation":
                    filt += f",eq=saturation={v:.3f}"
            # 平移到时间轴位置（用 setpts 把片段首帧放到 timelineStart）
            filt += f",setpts=PTS+{ts:.3f}/TB"
            vlabel = f"v{idx}"
            vfilters.append(f"[{idx}:v]{filt}[{vlabel}]")
            ov = f"overlay=x={cx}:y={cy}"
            voverlays.append((vlabel, ov))

        # 音频：剪裁源区间 → 0 基准 → 淡入淡出 → 音量 → 变速 → 延到时间轴位置
        at = _atempo_chain(sp)
        af = f"atrim=start={ss:.3f}:end={to:.3f},asetpts=PTS-STARTPTS"
        if fi > 0:
            af += f",afade=t=in:st=0:d={fi:.3f}"
        if fo > 0:
            af += f",afade=t=out:st={max(0.0, dur - fo):.3f}:d={fo:.3f}"
        af += f",volume={float(c.get('volume', 1.0) or 1.0):.3f},{at}adelay={int(ts * 1000)}|{int(ts * 1000)}"
        alabel = f"a{idx}"
        afilters.append(f"[{idx}:a]{af}[{alabel}]")
        amap_labels.append(alabel)
        idx += 1

    if not voverlays:
        raise ValueError("没有视频片段可合成")

    # 视频链：以黑底为基，按时间窗叠加各片段（轨道/时间轴靠 enable 控制出现时机）
    vgraph = f"color=c=black:s={W}x{H}:d={DUR:.3f}[base0]"
    prev = "base0"
    for k, (vlabel, ov) in enumerate(voverlays):
        nxt = f"vb{k}"
        vgraph += f";[{prev}][{vlabel}]{ov}[{nxt}]"
        prev = nxt
    vout = prev

    parts = [vgraph]
    if afilters:
        parts.append(";".join(afilters))
        parts.append(
            f"[{']['.join(amap_labels)}]amix=inputs={len(amap_labels)}:dropout_transition=0[aout]"
        )
    filter_complex = ";".join(parts)

    out_path = os.path.join(config.EXPORT_DIR, f"result_{uuid.uuid4().hex}.mp4")
    cmd = [
        "ffmpeg",
        "-y",
        *inputs,
        "-filter_complex",
        filter_complex,
        "-map",
        f"[{vout}]",
    ]
    if amap_labels:
        cmd += ["-map", "[aout]"]
    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(fps),
        "-t",
        f"{DUR:.3f}",
    ]
    if amap_labels:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    cmd += [out_path]

    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if res.returncode != 0:
        err = res.stderr.decode("utf-8", "ignore")
        raise RuntimeError(f"ffmpeg 导出失败 (code {res.returncode}): {err[-2000:]}")
    return out_path
