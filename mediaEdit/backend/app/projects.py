from __future__ import annotations

import os
import re
import time
import uuid
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

from . import config

# 与参考工程一致：XML 里所有时间点都是微秒整数（1 秒 = 1_000_000）。
US = 1_000_000
_SAFE_ID = re.compile(r"[A-Za-z0-9_-]+")
_EMPTY_TRACKS = (
    "timelineVideoFxTracks", "captionTracks", "compoundCaptionTracks",
    "stickerTracks", "musicLyricsTracks",
)
_FX_EFFECT_KEYS = {
    "Brightness": "brightness",
    "Contrast": "contrast",
    "Saturation": "saturation",
}


def valid_pid(pid: str) -> bool:
    return bool(_SAFE_ID.fullmatch(pid or ""))


def _project_dir(pid: str) -> str:
    return os.path.join(config.PROJECT_DIR, pid)


def _xml_path(pid: str) -> str:
    return os.path.join(_project_dir(pid), "project.xml")


def _us(v: Any) -> str:
    try:
        return str(int(round(float(v or 0) * US)))
    except (TypeError, ValueError):
        return "0"


def _sec(v: Any, default: float = 0.0) -> float:
    try:
        return float(v or 0) / US
    except (TypeError, ValueError):
        return default


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _bool(v: Any, default: bool = False) -> bool:
    if v is None:
        return default
    return str(v).lower() in ("true", "1", "yes")


def default_doc(pid: str, name: str, now: Optional[float] = None) -> Dict[str, Any]:
    now = now if now is not None else time.time()
    return {
        "id": pid,
        "name": name or "未命名项目",
        "createdAt": now,
        "updatedAt": now,
        "duration": 0.0,
        "sequence": {"width": 1280, "height": 720, "fps": 30},
        "sources": [],
        "tracks": [],
        "clips": [],
    }


def _fx_params(clip: Dict[str, Any]) -> List[tuple]:
    params = [
        ("Scale X", clip.get("scale", 1)),
        ("Scale Y", clip.get("scale", 1)),
        ("Rotation", clip.get("rotate", 0)),
        ("Trans X", clip.get("x", 0)),
        ("Trans Y", clip.get("y", 0)),
        ("Opacity", clip.get("opacity", 1)),
        ("Anchor X", 0),
        ("Anchor Y", 0),
        ("Scan Value", 0),
    ]
    for e in clip.get("effects") or []:
        for key, kind in _FX_EFFECT_KEYS.items():
            if e.get("type") == kind:
                params.append((key, (e.get("params") or {}).get("value", 0)))
    params.append(("Background Mode", "Color Solid"))
    params.append(("Background Color", "#00000000"))
    params.append(("Fill Mode", "AspectFit"))
    return params


def to_xml(doc: Dict[str, Any]) -> str:
    """把工程状态序列化成参考工程结构的 XML（微秒时间轴 + resources/videoTracks/audioTracks）。"""
    tracks: List[Dict[str, Any]] = doc.get("tracks") or []
    clips: List[Dict[str, Any]] = doc.get("clips") or []
    sources: List[Dict[str, Any]] = doc.get("sources") or []
    seq = doc.get("sequence") or {"width": 1280, "height": 720, "fps": 30}
    used = {c.get("sourceId") for c in clips}

    root = ET.Element("timelines", {
        "output": "16:9",
        "projectId": str(doc.get("id", "")),
        "name": str(doc.get("name") or "未命名项目"),
        "createdAt": str(float(doc.get("createdAt") or 0)),
        "updatedAt": str(float(doc.get("updatedAt") or 0)),
    })
    tl = ET.SubElement(root, "timeline", {
        "resWidth": str(seq.get("width", 1280)),
        "resHeight": str(seq.get("height", 720)),
        "duration": _us(doc.get("duration", 0)),
        "videoSize": "16:9", "autoCompose": "true", "subtitleEnable": "true",
        "controlSpeed": "1", "trackCount": str(len(tracks)),
        "noCaptions": "false", "sizeLevel": "-1", "outputStart": "0",
        "outputEnd": "-1", "enableRenderOrderByZValue": "true",
        "fps": str(seq.get("fps", 30)), "volume": "1", "outputType": "",
        "nvenc": "undefined", "encoderMode": "undefined",
        "isShowSection": "false", "sectionInPoint": "0",
        "sectionOutPoint": "0", "dbLimitValue": "0",
    })

    resources = ET.SubElement(tl, "resources")
    for s in sources:
        if s.get("id") not in used:
            continue
        ET.SubElement(resources, "resource", {
            "id": str(s.get("id", "")),
            "path": str(s.get("originalUrl") or s.get("previewUrl") or ""),
            "previewUrl": str(s.get("previewUrl") or ""),
            "originalUrl": str(s.get("originalUrl") or ""),
            "name": str(s.get("name") or ""),
            "width": str(s.get("width", 0)),
            "height": str(s.get("height", 0)),
            "duration": _us(s.get("duration", 0)),
        })

    video_tracks = ET.SubElement(tl, "videoTracks")
    audio_tracks = ET.SubElement(tl, "audioTracks")
    for index, tr in enumerate(tracks):
        is_audio = tr.get("type") == "audio"
        parent = audio_tracks if is_audio else video_tracks
        track_el = ET.SubElement(parent, "audioTrack" if is_audio else "videoTrack", {
            "index": str(index),
            "typeFlag": "bgm" if is_audio else "video",
            "volume": "1", "showVolume": "1",
            "show": "false" if tr.get("hidden") else "true",
            "uuid": str(tr.get("id", "")),
            "name": str(tr.get("name") or ""),
            "trackId": str(tr.get("id", "")),
            "locked": str(bool(tr.get("locked"))).lower(),
            "muted": str(bool(tr.get("muted"))).lower(),
            "color": str(tr.get("color") or ""),
        })
        items = ET.SubElement(track_el, "audios" if is_audio else "videos")
        own = [c for c in clips if c.get("track") == tr.get("id")]
        for ci, clip in enumerate(own):
            src = next((s for s in sources if s.get("id") == clip.get("sourceId")), {})
            speed = _num(clip.get("speed"), 1) or 1
            start = _num(clip.get("timelineStart"))
            src_in = _num(clip.get("srcIn"))
            src_out = _num(clip.get("srcOut"))
            end = start + (src_out - src_in) / speed
            attrs = {
                "id": str(clip.get("sourceId", "")),
                "uuid": str(clip.get("id", "")),
                "index": str(ci),
                "type": "2" if is_audio else "1",
                "typeFlag": "bgm" if is_audio else "video",
                "path": str(src.get("originalUrl") or src.get("previewUrl") or ""),
                "inPoint": _us(start),
                "outPoint": _us(end),
                "trimIn": _us(src_in),
                "trimOut": _us(src_out),
                "orgDuration": _us(src.get("duration", 0)),
                "volume": str(clip.get("volume", 1)),
                "speed": str(speed),
                "fadeInDuration": _us(clip.get("fadeIn", 0)),
                "fadeOutDuration": _us(clip.get("fadeOut", 0)),
                "title": str(src.get("name") or ""),
                "width": str(src.get("width", 0)),
                "height": str(src.get("height", 0)),
                "isAudio": str(bool(clip.get("isAudio"))).lower(),
            }
            item = ET.SubElement(items, "audio" if is_audio else "video", attrs)
            if not is_audio:
                fx = ET.SubElement(ET.SubElement(item, "videoFxs"), "videoFx", {
                    "index": "0", "type": "property", "name": "", "videoFxType": "",
                    "animationType": "", "isPostInAnimation": "false",
                    "isPostOutAnimation": "false", "intensity": "1", "isRaw": "false",
                    "shape": "rect", "isRegional": "false", "isIgnoreBackground": "false",
                    "isInverseRegion": "false", "regionalFeatherWidth": "0",
                })
                params_el = ET.SubElement(fx, "fxParams")
                for key, value in _fx_params(clip):
                    kind = "menu" if key in ("Background Mode", "Fill Mode") else (
                        "color" if key == "Background Color" else "float"
                    )
                    ET.SubElement(params_el, "fxParam", {
                        "type": kind, "key": key, "value": str(value),
                    })

    for tag in _EMPTY_TRACKS:
        ET.SubElement(tl, tag)

    ET.indent(root, space="\t")
    body = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n"


def from_xml(text: str) -> Dict[str, Any]:
    """反序列化 XML → 工程状态。缺字段一律走默认值，兼容手写/外部工程。"""
    root = ET.fromstring(text)
    tl = root.find("timeline")
    if tl is None:
        tl = root
    seq = {
        "width": int(_num(tl.get("resWidth"), 1280)),
        "height": int(_num(tl.get("resHeight"), 720)),
        "fps": int(_num(tl.get("fps"), 30)) or 30,
    }
    doc = default_doc(root.get("projectId") or "", root.get("name") or "未命名项目")
    doc.update({
        "createdAt": _num(root.get("createdAt"), doc["createdAt"]),
        "updatedAt": _num(root.get("updatedAt"), doc["updatedAt"]),
        "duration": _sec(tl.get("duration")),
        "sequence": seq,
        "sources": [],
        "tracks": [],
        "clips": [],
    })

    for r in root.iter("resource"):
        sid = r.get("id")
        if not sid:
            continue
        doc["sources"].append({
            "id": sid,
            "name": r.get("name") or r.get("title") or sid,
            "width": int(_num(r.get("width"), 0)),
            "height": int(_num(r.get("height"), 0)),
            "duration": _sec(r.get("duration")),
            "previewUrl": r.get("previewUrl") or r.get("path") or "",
            "originalUrl": r.get("originalUrl") or r.get("path") or "",
        })

    for ti, group in enumerate((tl.find("videoTracks"), tl.find("audioTracks"))):
        if group is None:
            continue
        is_audio = ti == 1
        for el in list(group):
            track_id = el.get("trackId") or el.get("uuid") or f"t{ti}-{len(doc['tracks']) + 1}"
            show = el.get("show")
            doc["tracks"].append({
                "id": track_id,
                "name": el.get("name") or ("音频轨" if is_audio else "视频轨"),
                "type": "audio" if is_audio else "video",
                "color": el.get("color") or ("#a855f7" if is_audio else "#3b82f6"),
                "locked": _bool(el.get("locked")),
                "hidden": (show is not None and not _bool(show, True)),
                "muted": _bool(el.get("muted")),
            })
            item_tag = "audio" if is_audio else "video"
            for item in el.iter(item_tag):
                fx_values: Dict[str, float] = {}
                for p in item.iter("fxParam"):
                    fx_values[p.get("key") or ""] = _num(p.get("value"), 0)
                speed = _num(item.get("speed"), 1) or 1
                src_in = _sec(item.get("trimIn"))
                src_out = _sec(item.get("trimOut"))
                effects = [
                    {"type": kind, "params": {"value": fx_values[key]}}
                    for key, kind in _FX_EFFECT_KEYS.items()
                    if key in fx_values and fx_values[key] != 0
                ]
                doc["clips"].append({
                    "id": item.get("uuid") or f"c{len(doc['clips']) + 1}",
                    "sourceId": item.get("id") or "",
                    "srcIn": src_in,
                    "srcOut": src_out,
                    "timelineStart": _sec(item.get("inPoint")),
                    "speed": speed,
                    "volume": _num(item.get("volume"), 1),
                    "fadeIn": _sec(item.get("fadeInDuration")),
                    "fadeOut": _sec(item.get("fadeOutDuration")),
                    "opacity": _num(fx_values.get("Opacity"), 1),
                    "x": _num(fx_values.get("Trans X"), 0),
                    "y": _num(fx_values.get("Trans Y"), 0),
                    "scale": _num(fx_values.get("Scale X"), 1) or 1,
                    "rotate": _num(fx_values.get("Rotation"), 0),
                    "track": track_id,
                    "isAudio": _bool(item.get("isAudio"), is_audio),
                    "effects": effects,
                })
    return doc


def _read(pid: str) -> Optional[Dict[str, Any]]:
    path = _xml_path(pid)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            doc = from_xml(f.read())
        doc["id"] = pid
        return doc
    except (ET.ParseError, OSError, ValueError):
        return None


def _write(doc: Dict[str, Any]) -> Dict[str, Any]:
    pid = doc["id"]
    os.makedirs(_project_dir(pid), exist_ok=True)
    path = _xml_path(pid)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(to_xml(doc))
    os.replace(tmp, path)
    return doc


def list_projects() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for pid in os.listdir(config.PROJECT_DIR):
        if not valid_pid(pid):
            continue
        doc = _read(pid)
        if not doc:
            continue
        out.append({
            "id": doc["id"],
            "name": doc["name"],
            "createdAt": doc["createdAt"],
            "updatedAt": doc["updatedAt"],
            "duration": doc["duration"],
            "trackCount": len(doc["tracks"]),
            "clipCount": len(doc["clips"]),
        })
    out.sort(key=lambda d: d["updatedAt"], reverse=True)
    return out


def create_project(name: str) -> Dict[str, Any]:
    pid = uuid.uuid4().hex
    return _write(default_doc(pid, name))


def get_project(pid: str) -> Optional[Dict[str, Any]]:
    return _read(pid)


def get_xml(pid: str) -> Optional[str]:
    path = _xml_path(pid)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def save_project(pid: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    doc = _read(pid)
    if not doc:
        return None
    if "name" in patch and patch["name"] is not None:
        doc["name"] = str(patch["name"]).strip() or "未命名项目"
    incoming = patch.get("project")
    if isinstance(incoming, dict):
        for key in ("sequence", "tracks", "clips", "sources", "duration"):
            if key in incoming:
                doc[key] = incoming[key]
    doc["updatedAt"] = time.time()
    return _write(doc)


def delete_project(pid: str) -> bool:
    path = _xml_path(pid)
    if not os.path.isfile(path):
        return False
    try:
        os.remove(path)
        try:
            os.rmdir(_project_dir(pid))
        except OSError:
            pass  # 目录里还有其它文件时，XML 已删就算删除成功
    except OSError:
        return False
    return True
