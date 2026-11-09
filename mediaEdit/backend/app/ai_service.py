from __future__ import annotations

import re
from typing import Any, Dict


def parse_command(text: str, clip: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """规则式对话式编辑：把自然语言指令解析为工程 JSON 操作（无需外部 API，绝不报错）。
    对应技术方案 6.2/6.3：AI 产出是工程 JSON 节点，预览管线无需 special case。"""
    t = (text or "").lower()
    ops: Dict[str, Any] = {}

    # 变速：加速/减速/2x/0.5x
    m = re.search(r"(\d+(?:\.\d+)?)\s*[xX倍]", t)
    if "加速" in t or "快" in t:
        ops["speed"] = 2.0
    elif "减速" in t or "慢" in t:
        ops["speed"] = 0.5
    elif m:
        ops["speed"] = float(m.group(1))

    # 音量
    m = re.search(r"音量[为到]?\s*(\d+(?:\.\d+)?)", t)
    if m:
        ops["volume"] = float(m.group(1))
        if ops["volume"] > 1.5:  # 允许百分比式写法
            ops["volume"] = ops["volume"] / 100.0
    elif "静音" in t or "无声" in t:
        ops["volume"] = 0.0
    elif "大声" in t or "调大" in t:
        ops["volume"] = 1.5

    # 淡入 / 淡出
    if "淡入" in t:
        ops["fadeIn"] = 1.0
    if "淡出" in t:
        ops["fadeOut"] = 1.0

    # 透明度
    m = re.search(r"透明[度]?[为到]?\s*(\d+(?:\.\d+)?)", t)
    if m:
        v = float(m.group(1))
        ops["opacity"] = v / 100.0 if v > 1 else v

    # 调色
    if "变亮" in t or "提亮" in t:
        ops.setdefault("effects", []).append({"type": "brightness", "params": {"value": 0.2}})
    if "变暗" in t:
        ops.setdefault("effects", []).append({"type": "brightness", "params": {"value": -0.2}})
    if "加对比" in t:
        ops.setdefault("effects", []).append({"type": "contrast", "params": {"value": 0.2}})
    if "更鲜艳" in t or "饱和" in t:
        ops.setdefault("effects", []).append({"type": "saturation", "params": {"value": 0.3}})

    if "删除" in t or "移除" in t or "去掉" in t:
        ops["remove"] = True

    return {"ops": ops, "ok": True}
