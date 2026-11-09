from typing import List, Optional, Union
from pydantic import BaseModel


class ClipModel(BaseModel):
    sourceId: Optional[str] = None
    url: Optional[str] = None  # 导出用：原片 URL（/storage/origin/...）
    srcIn: float = 0.0
    srcOut: float = 0.0
    timelineStart: float = 0.0
    speed: float = 1.0
    volume: float = 1.0
    fadeIn: float = 0.0
    fadeOut: float = 0.0
    opacity: float = 1.0
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
    rotate: float = 0.0
    # 轨道 id：新前端用字符串（动态轨道，数量不限），旧工程可能是数字编号。
    # 导出层只按 tracks 顺序决定层序，不依赖该字段的值。
    track: Union[int, str] = 0
    effects: List[dict] = []
    transitions: List[dict] = []


class TrackModel(BaseModel):
    type: str = "video"
    clips: List[ClipModel] = []


class ProjectModel(BaseModel):
    sequence: dict = {"width": 1280, "height": 720, "fps": 30}
    tracks: List[TrackModel] = []
