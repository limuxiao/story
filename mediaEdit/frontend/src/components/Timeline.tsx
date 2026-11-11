import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { canRedo, canUndo, useEditor } from "../store";
import { ClipFilmstrip } from "./timeline/ClipFilmstrip";
import { MEDIA_MIME } from "./MediaLibrary";
import { fmtTime } from "../utils/time";
import {
  alignToFrame,
  clipDuration,
  clipEnd,
  FPS,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  pxToTime,
  SNAP_PX,
  snapCandidates,
  snapClipRange,
  snapTime,
  tickStep,
} from "../utils/timelineTime";
import type { Clip, Source, Track } from "../types";

// 视觉规范对齐 mobvoi_media_editor/src/components/timeline/*.vue。
// 静态色值统一走 tailwind.config.js 的 me.* token / className；
// 仅轨道色、片段坐标等运行时数值保留 inline style（Tailwind 无法静态扫描动态类名）。

const TOOLBAR_H = 40;
const HEAD_W = 148;
const RULER_H = 20;
const TOP_GAP = 12;
const HOLDER_H = 8;
const TRACK_VIEWPORT_H = 264;
// 刻度槽位池上限，与 tickStride 的抽稀目标一致：缩放时只更新坐标/文本，不增删节点。
const MAX_TICKS = 400;
// 兼容旧交互：拖到轨道行上边缘同样视为插入（holder 是 8px，边缘容差给到 9px）。
const INSERT_EDGE_PX = 9;
// 空时间轴：整块虚线框占满轨道区（参考 trackPanelEmpty），不渲染任何轨道头/轨道行。
const EMPTY_H = 200;

const trackHeight = (t: Track) => (t.type === "audio" ? 40 : 52);
// 缩略图可视窗口左右各多算一段，滚动时不会出现空白闪烁。
const FILMSTRIP_OVERSCAN = 160;

type IconName =
  | "undo" | "redo" | "cut" | "audio" | "copy" | "trash"
  | "plusV" | "plusA" | "magnet" | "zoomIn" | "zoomOut" | "box";

const ICONS: Record<IconName, React.ReactNode> = {
  undo: <><path d="M3 9h11a5 5 0 1 1 0 10H9" /><path d="m7 5-4 4 4 4" /></>,
  redo: <><path d="M21 9H10a5 5 0 1 0 0 10h5" /><path d="m17 5 4 4-4 4" /></>,
  cut: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="m8 8 12 12M20 4 8 16" /></>,
  audio: <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  trash: <><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" /></>,
  plusV: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M19 9v6M16 12h6" /></>,
  plusA: <><path d="M4 12v-2a2 2 0 0 1 4 0v6a2 2 0 0 1-4 0v-2M8 10l6-4v12l-6-4" /><path d="M18 9v6M15 12h6" /></>,
  magnet: <><path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3H6z" /><path d="M6 7h4M14 7h4" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M8 10.5h5M15.5 15.5l5 5" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M8 10.5h5M15.5 15.5l5 5" /></>,
  box: <><path d="m3 7 9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></>,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function ToolButton({ icon, label, disabled, active, onClick }: {
  icon: IconName; label: string; disabled?: boolean; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`mr-4 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] p-0 ${
        active ? "bg-me-border" : "bg-transparent"
      } ${disabled ? "cursor-not-allowed text-me-disabled" : "cursor-pointer text-me-text"}`}
    >
      <Icon name={icon} />
    </button>
  );
}

const TEXT_BTN = "cursor-pointer whitespace-nowrap rounded border border-me-border bg-transparent px-2 py-[2px] text-[11px] text-[#c8c8cc]";
const HEAD_BTN = "h-4 min-w-[18px] cursor-pointer rounded-[3px] border px-[2px] text-[10px] leading-[14px]";

const trimHandleClass = (side: "left" | "right", w: number, selected: boolean) =>
  `absolute bottom-0 top-0 z-10 cursor-ew-resize ${w >= 30 ? "w-[14px]" : "w-[2px]"} ${
    side === "left" ? "left-0" : "right-0"
  } ${selected ? "bg-white/50" : "bg-transparent"}`;

const fmtTick = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(Number.isInteger(t) ? 0 : 1).padStart(Number.isInteger(t) ? 2 : 4, "0")}`;
};

type DragMode = "move" | "trimLeft" | "trimRight";
type InsertHint = { index: number; kind: "edge" | "holder" } | null;
type CtxMenu = { x: number; y: number; trackId: string | null; clipId: string | null } | null;

export default function Timeline() {
  const clips = useEditor((s) => s.clips);
  const sources = useEditor((s) => s.sources);
  const tracks = useEditor((s) => s.tracks);
  const time = useEditor((s) => s.time);
  const duration = useEditor((s) => s.duration);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const selectedTrackId = useEditor((s) => s.selectedTrackId);

  const setTime = useEditor((s) => s.setTime);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPxPerSec = useEditor((s) => s.setPxPerSec);
  const addClip = useEditor((s) => s.addClip);
  const addTrack = useEditor((s) => s.addTrack);
  const removeTrack = useEditor((s) => s.removeTrack);
  const updateTrack = useEditor((s) => s.updateTrack);
  const moveTrack = useEditor((s) => s.moveTrack);
  const selectTrack = useEditor((s) => s.selectTrack);
  const updateClip = useEditor((s) => s.updateClip);
  const selectClip = useEditor((s) => s.selectClip);
  const setSelection = useEditor((s) => s.setSelection);
  const beginEdit = useEditor((s) => s.beginEdit);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const splitAt = useEditor((s) => s.splitAt);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const copySelected = useEditor((s) => s.copySelected);
  const pasteAt = useEditor((s) => s.pasteAt);

  const laneRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const insertRef = useRef<InsertHint>(null);
  const heldSnap = useRef<number | null>(null);
  // 时间区横向可视窗口（内容坐标）。缩略图只在这个范围内建 DOM / 发请求。
  const [viewport, setViewport] = useState({ left: 0, width: 1200 });
  const sourceById = useMemo(
    () => new Map<string, Source>(sources.map((s) => [s.id, s])),
    [sources]
  );

  // 滚动 / 尺寸变化时才更新可视窗口：48px 阈值配合 overscan，
  // 小幅滚动不触发整棵时间轴重渲染。
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const left = el.scrollLeft;
        const width = el.clientWidth;
        setViewport((prev) =>
          prev.width === width && Math.abs(prev.left - left) < 48 ? prev : { left, width }
        );
      });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [insertHint, setInsertHint] = useState<InsertHint>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [ctx, setCtx] = useState<CtxMenu>(null);

  const isEmpty = tracks.length === 0;
  const step = tickStep(pxPerSec);
  const total = Math.max(duration, 10);
  const width = total * pxPerSec;
  const ticks = Math.ceil(total / step);
  // 超长工程（例如误导入的长素材）时抽稀刻度，避免一次渲染数千个 DOM 节点。
  const tickStride = Math.max(1, Math.ceil((ticks + 1) / 400));
  const tickCount = Math.ceil((ticks + 1) / tickStride);

  // 轨道区几何：刻度 20 + 顶部 12 + 每行 (8 holder + 行高) + 末尾 8 holder。
  const rowRects: { id: string; top: number; bottom: number }[] = [];
  let acc = RULER_H + TOP_GAP;
  for (const t of tracks) {
    acc += HOLDER_H;
    const top = acc;
    acc += trackHeight(t);
    rowRects.push({ id: t.id, top, bottom: acc });
  }
  acc += HOLDER_H;
  const contentH = acc;

  const hasSelection = selectedClipIds.length > 0;
  const canSplit = clips.some((c) => selectedClipIds.includes(c.id) && time > c.timelineStart + 1 / FPS && time < clipEnd(c) - 1 / FPS);

  // 快捷键：参考 toolBarBtn.vue 的 Ctrl/Cmd+C/V/Z、Delete/Backspace、Space，另补分割/副本/全选。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && k === "c") { e.preventDefault(); s.copySelected(); return; }
      if (mod && k === "v") { e.preventDefault(); s.pasteAt(s.time); return; }
      if (mod && k === "d") { e.preventDefault(); s.duplicateSelected(); return; }
      if (mod && k === "a") { e.preventDefault(); s.setSelection(s.clips.map((c) => c.id)); return; }
      if (mod && k === "b") { e.preventDefault(); s.splitAt(s.time); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); s.deleteSelected(); return; }
      if (e.key === " ") { e.preventDefault(); s.setPlaying(!s.playing); return; }
      if (e.key === "Escape") { s.setSelection([]); setCtx(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [ctx]);

  const rawTimeFromEvent = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect();
    return rect ? pxToTime(clientX - rect.left, pxPerSec) : 0;
  };

  // 播放头 scrub：点击定位 + 拖动连续 seek（参考 trackSeeker）。
  const startScrub = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    useEditor.getState().setTime(alignToFrame(rawTimeFromEvent(e.clientX)));
    const move = (ev: MouseEvent) => {
      const s = useEditor.getState();
      const rect = laneRef.current?.getBoundingClientRect();
      if (rect) s.setTime(alignToFrame(pxToTime(ev.clientX - rect.left, s.pxPerSec)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // 轨道区空白：短按定位播放头，拖拽框选片段（参考 SelectionBox + offsetSeeker）。
  const startLanePointer = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest("[data-clip-id]") || el.closest("[data-playhead]") || el.closest("[data-ruler]")) return;
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x0 = e.clientX - rect.left;
    const y0 = e.clientY - rect.top;
    let active = false;
    const pos = (ev: MouseEvent) => ({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    const move = (ev: MouseEvent) => {
      const { x, y } = pos(ev);
      if (!active && (Math.abs(x - x0) > 4 || Math.abs(y - y0) > 4)) {
        active = true;
        setSelection([]);
      }
      if (active) setMarquee({ left: Math.min(x, x0), top: Math.min(y, y0), width: Math.abs(x - x0), height: Math.abs(y - y0) });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (active) {
        const { x, y } = pos(ev);
        const l = Math.min(x, x0), r = Math.max(x, x0), t = Math.min(y, y0), b = Math.max(y, y0);
        const pps = useEditor.getState().pxPerSec;
        setSelection(
          clips.filter((c) => {
            const row = rowRects.find((q) => q.id === c.track);
            return !!row && c.timelineStart * pps < r && clipEnd(c) * pps > l && row.bottom > t && row.top < b;
          }).map((c) => c.id)
        );
      } else {
        setTime(alignToFrame(pxToTime(x0, useEditor.getState().pxPerSec)));
      }
      setMarquee(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const readSourceId = (e: React.DragEvent) =>
    e.dataTransfer.getData(MEDIA_MIME) || e.dataTransfer.getData("text/plain");

  const clearHint = () => { setDropTarget(null); insertRef.current = null; setInsertHint(null); };

  const allowDrop = (e: React.DragEvent, id: string, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(id);
    const r = e.currentTarget.getBoundingClientRect();
    const dy = e.clientY - r.top;
    const hint: InsertHint = dy >= 0 && dy <= INSERT_EDGE_PX ? { index, kind: "edge" } : null;
    insertRef.current = hint;
    setInsertHint(hint);
  };

  const allowHolder = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    insertRef.current = { index, kind: "holder" };
    setInsertHint({ index, kind: "holder" });
  };

  const placeAndInsert = (e: React.DragEvent, type: "video" | "audio", index: number) => {
    const sourceId = readSourceId(e);
    if (!sourceId) return;
    const id = addTrack(type, index);
    addClip({ sourceId, track: id, timelineStart: alignToFrame(rawTimeFromEvent(e.clientX)), isAudio: type === "audio" });
  };

  const dropOnTrack = (e: React.DragEvent, trackId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const hint = insertRef.current;
    clearHint();
    const sourceId = readSourceId(e);
    const t = tracks.find((x) => x.id === trackId);
    if (!sourceId || !t || t.locked) return;
    if (hint && hint.index === index) {
      placeAndInsert(e, t.type, index);
      return;
    }
    // 同轨同时间有片段时，store 会自动新建轨道，绝不静默覆盖已有片段。
    addClip({ sourceId, track: trackId, timelineStart: alignToFrame(rawTimeFromEvent(e.clientX)) });
  };

  const dropOnHolder = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const hint = insertRef.current;
    clearHint();
    const prev = tracks[Math.max(0, index - 1)] ?? tracks[0];
    placeAndInsert(e, hint?.kind === "holder" ? (prev?.type ?? "video") : "video", index);
  };

  // 拖到轨道区空白处：自动新建一条视频轨并放置，轨道数量不受限。
  const dropOnBlank = (e: React.DragEvent) => {
    e.preventDefault();
    clearHint();
    const sourceId = readSourceId(e);
    if (!sourceId) return;
    const id = addTrack("video", 0);
    addClip({ sourceId, track: id, timelineStart: alignToFrame(rawTimeFromEvent(e.clientX)) });
  };

  // 片段移动 / 左右 trim 共用一套 mouse 事件与吸附（参考 trackPanelClip）。
  const startDrag = (e: React.MouseEvent, clip: Clip, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const fromIdx = tracks.findIndex((t) => t.id === clip.track);
    if (fromIdx < 0 || tracks[fromIdx].locked) return;
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    if (additive) selectClip(clip.id, true);
    else if (!selectedClipIds.includes(clip.id)) selectClip(clip.id);

    const st0 = useEditor.getState();
    const ids = st0.selectedClipIds.length ? st0.selectedClipIds : [clip.id];
    const group = mode === "move" && ids.includes(clip.id)
      ? st0.clips.filter((c) => ids.includes(c.id))
      : [clip];
    const bases = group.map((c) => ({ clip: c, idx: tracks.findIndex((t) => t.id === c.track) }));
    const src = st0.sources.find((s) => s.id === clip.sourceId);
    const sourceDuration = src?.duration ?? clip.srcOut;
    const startX = e.clientX;
    const startY = e.clientY;
    const startRectTop = laneRef.current?.getBoundingClientRect().top ?? 0;
    // 鼠标在起始片段行内的相对偏移，用于跨轨时按「同一相对位置」落到目标行。
    const startRowOffset = (startY - startRectTop) - (rowRects[fromIdx]?.top ?? 0);
    const startT = clip.timelineStart;
    const startIn = clip.srcIn;
    const startOut = clip.srcOut;
    const speed = clip.speed || 1;
    const dur = clipDuration(clip);
    const candidates = snapEnabled ? snapCandidates(st0.clips, group.map((c) => c.id), st0.time) : [];
    heldSnap.current = null;
    let recorded = false;
    const ensureRecord = () => { if (!recorded) { recorded = true; beginEdit(); } };

    const move = (ev: MouseEvent) => {
      const st = useEditor.getState();
      const pps = st.pxPerSec;
      const dx = ev.clientX - startX;
      const threshold = SNAP_PX / pps;

      if (mode === "move") {
        const rect = laneRef.current?.getBoundingClientRect();
        const laneY = rect ? ev.clientY - rect.top : (rowRects[fromIdx]?.top ?? 0) + startRowOffset;
        const toIdx = indexAtY(laneY - startRowOffset);
        const dIdx = toIdx - fromIdx;
        const raw = Math.max(0, startT + dx / pps);
        const snapped = snapClipRange(raw, dur, candidates, threshold, heldSnap.current);
        heldSnap.current = snapped.point;
        setSnapLine(snapped.point);
        const shift = alignToFrame(Math.max(0, snapped.time)) - startT;
        if (Math.abs(dx) < 1 && dIdx === 0 && Math.abs(shift) < 1 / FPS) return;
        ensureRecord();
        for (const b of bases) {
          if (b.idx < 0) continue;
          const dest = tracks[Math.max(0, Math.min(tracks.length - 1, b.idx + dIdx))];
          if (!dest || dest.locked) continue;
          updateClip(b.clip.id, {
            timelineStart: alignToFrame(Math.max(0, b.clip.timelineStart + shift)),
            track: dest.id,
          });
        }
      } else if (mode === "trimLeft") {
        const newIn = Math.max(0, Math.min(startOut - 1 / FPS, startIn + (dx / pps) * speed));
        const rawStart = startT + (newIn - startIn) / speed;
        const snapped = snapTime(rawStart, candidates, threshold, heldSnap.current);
        heldSnap.current = snapped.point;
        setSnapLine(snapped.point);
        const newStart = Math.max(0, snapped.time);
        ensureRecord();
        updateClip(clip.id, {
          timelineStart: alignToFrame(newStart),
          srcIn: alignToFrame(Math.max(0, startIn + (newStart - startT) * speed)),
        });
      } else {
        const newOut = Math.max(startIn + 1 / FPS, Math.min(sourceDuration, startOut + (dx / pps) * speed));
        const rawEnd = startT + (newOut - startIn) / speed;
        const snapped = snapTime(rawEnd, candidates, threshold, heldSnap.current);
        heldSnap.current = snapped.point;
        setSnapLine(snapped.point);
        const finalOut = startIn + (snapped.time - startT) * speed;
        ensureRecord();
        updateClip(clip.id, {
          srcOut: Math.max(startIn + 1 / FPS, Math.min(sourceDuration, finalOut)),
        });
      }
    };
    const up = () => {
      heldSnap.current = null;
      setSnapLine(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const indexAtY = (y: number) => {
    for (let i = 0; i < rowRects.length; i++) if (y < rowRects[i].bottom + HOLDER_H / 2) return i;
    return Math.max(0, rowRects.length - 1);
  };

  const commitRename = (id: string) => {
    const name = editName.trim();
    if (name) updateTrack(id, { name });
    setEditingId(null);
  };

  const openCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = e.target as HTMLElement;
    setCtx({
      x: e.clientX, y: e.clientY,
      trackId: el.closest("[data-track-id]")?.getAttribute("data-track-id") ?? null,
      clipId: el.closest("[data-clip-id]")?.getAttribute("data-clip-id") ?? null,
    });
  };

  const menuItems: ({ label: string; hint?: string; run: () => void; danger?: boolean } | "divider")[] = [
    { label: "分割于播放头", hint: "Ctrl+B", run: () => splitAt(time) },
    { label: "复制", hint: "Ctrl+C", run: copySelected },
    { label: "粘贴到播放头", hint: "Ctrl+V", run: () => pasteAt(time) },
    { label: "创建副本", hint: "Ctrl+D", run: duplicateSelected },
    { label: "删除片段", hint: "Delete", run: deleteSelected, danger: true },
    "divider",
    { label: "新建视频轨", run: () => addTrack("video", 0) },
    { label: "新建音频轨", run: () => addTrack("audio") },
  ];
  if (ctx?.trackId) {
    const t = tracks.find((x) => x.id === ctx.trackId);
    if (t) {
      menuItems.push(
        "divider",
        { label: "重命名轨道", run: () => { setEditingId(t.id); setEditName(t.name); } },
        { label: "上移一层", run: () => moveTrack(t.id, -1) },
        { label: "下移一层", run: () => moveTrack(t.id, 1) },
        { label: t.locked ? "解锁轨道" : "锁定轨道", run: () => updateTrack(t.id, { locked: !t.locked }) },
        { label: t.hidden ? "显示轨道" : "隐藏轨道", run: () => updateTrack(t.id, { hidden: !t.hidden }) },
        { label: t.muted ? "取消静音" : "静音轨道", run: () => updateTrack(t.id, { muted: !t.muted }) },
        { label: "删除轨道", run: () => removeTrack(t.id), danger: true },
      );
    }
  }

  return (
    <div
      data-timeline-root=""
      onContextMenu={openCtx}
      className="flex shrink-0 flex-col border-t border-t-[#111114] bg-me-app font-sans text-me-text"
    >

      {/* 40px 工具栏：左侧编辑动作，右侧缩放（参考 toolBar / toolBarBtn / toolBarSetting） */}
      <div className="relative flex h-10 shrink-0 items-center border-b border-me-line pl-6">
        <ToolButton icon="undo" label="撤销 (Ctrl+Z)" disabled={!canUndo()} onClick={undo} />
        <ToolButton icon="redo" label="重做 (Ctrl+Shift+Z)" disabled={!canRedo()} onClick={redo} />
        <ToolButton icon="cut" label="分割于播放头 (Ctrl+B)" disabled={!canSplit} onClick={() => splitAt(time)} />
        <ToolButton icon="audio" label="分离音频（当前引擎不支持，暂不可用）" disabled />
        <ToolButton icon="copy" label="创建副本 (Ctrl+D；Ctrl+C 复制后可右键粘贴)" disabled={!hasSelection} onClick={duplicateSelected} />
        <ToolButton icon="trash" label="删除片段 (Delete)" disabled={!hasSelection} onClick={deleteSelected} />
        <div className="m-[0_12px_0_-4px] h-4 w-px bg-me-border" />
        <button type="button" title="新建视频轨" className={`${TEXT_BTN} mr-[6px]`} onClick={() => addTrack("video", 0)}>+ 视频轨</button>
        <button type="button" title="新建音频轨" className={`${TEXT_BTN} mr-3`} onClick={() => addTrack("audio")}>+ 音频轨</button>
        <span
          title="磁吸对齐（片段起止点 / 播放头）"
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`inline-flex cursor-pointer items-center gap-1 text-[11px] ${snapEnabled ? "text-me-text" : "text-me-mute"}`}
        >
          <Icon name="magnet" size={14} /> 磁吸 {snapEnabled ? "开" : "关"}
        </span>

        <div className="absolute inset-y-0 right-6 flex items-center gap-2">
          <button type="button" title="缩小" aria-label="缩小时间线" onClick={() => setPxPerSec(pxPerSec / 1.5)}
            className="inline-flex h-4 w-4 cursor-pointer items-center justify-center bg-transparent p-0 text-me-text">
            <Icon name="zoomOut" size={14} />
          </button>
          <input
            className="me-tl-range m-0 w-[100px]"
            type="range"
            min={MIN_PX_PER_SEC}
            max={MAX_PX_PER_SEC}
            step={10}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
            aria-label="时间轴缩放"
          />
          <button type="button" title="放大" aria-label="放大时间线" onClick={() => setPxPerSec(pxPerSec * 1.5)}
            className="inline-flex h-4 w-4 cursor-pointer items-center justify-center bg-transparent p-0 text-me-text">
            <Icon name="zoomIn" size={14} />
          </button>
        </div>
      </div>

      {/* 轨道头与时间区同处一个垂直滚动容器，轨道再多也始终左右对齐、且不会挤压预览 */}
      <div
        data-track-scroll=""
        className="me-tl-scroll flex max-h-[264px] overflow-x-hidden overflow-y-auto bg-me-app"
      >
        {/* 148px 轨道头（参考 trackMark：20px 刻度占位 + 12px 留白 + 8px holder + 行） */}
        <div className="w-[148px] shrink-0 border-r border-r-me-divider bg-me-app">
          <div className="flex h-5 items-center border-b border-me-line pl-[10px] text-[10px] text-me-major">
            {!isEmpty && "轨道 / 控制"}
          </div>
          {isEmpty ? (
            <div className="h-[200px]" />
          ) : (
            <>
              <div className="h-3" />
              {tracks.map((t, i) => {
            const selected = t.id === selectedTrackId;
            return (
              <Fragment key={t.id}>
                <div className="h-2" />
                <div
                  onClick={() => selectTrack(t.id)}
                  className={`box-border cursor-pointer overflow-hidden border-b border-b-me-divider border-l-2 px-2 py-[3px] ${
                    t.type === "audio" ? "h-10" : "h-[52px]"
                  } ${selected ? "border-l-me-primary bg-me-track-active" : "border-l-transparent bg-me-app"} ${
                    t.hidden ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-[5px]">
                    <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ backgroundColor: t.color }} />
                    {editingId === t.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => commitRename(t.id)}
                        onKeyDown={(e) => e.key === "Enter" && commitRename(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-24 rounded-[3px] border border-me-major bg-me-minor px-[2px] py-px text-[11px] text-me-text"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(t.id); setEditName(t.name); }}
                        title="双击重命名"
                        className="flex-1 truncate text-[11px] font-semibold"
                      >
                        {t.name}
                      </span>
                    )}
                  </div>
                  <div className="mt-px text-[10px] text-me-mute">
                    {t.type === "audio" ? "音频" : "视频"} · {clips.filter((c) => c.track === t.id).length}段 · {i + 1}层
                  </div>
                  <div className="mt-[2px] flex gap-[2px]">
                    <button className={`${HEAD_BTN} border-me-border text-me-mute`} title="上移一层" onClick={(e) => { e.stopPropagation(); moveTrack(t.id, -1); }}>↑</button>
                    <button className={`${HEAD_BTN} border-me-border text-me-mute`} title="下移一层" onClick={(e) => { e.stopPropagation(); moveTrack(t.id, 1); }}>↓</button>
                    <button className={`${HEAD_BTN} ${t.locked ? "border-me-primary text-me-primary" : "border-me-border text-me-mute"}`} title="锁定/解锁" onClick={(e) => { e.stopPropagation(); updateTrack(t.id, { locked: !t.locked }); }}>锁</button>
                    <button className={`${HEAD_BTN} ${t.hidden ? "border-me-warn text-me-warn" : "border-me-border text-me-mute"}`} title="隐藏/显示" onClick={(e) => { e.stopPropagation(); updateTrack(t.id, { hidden: !t.hidden }); }}>显</button>
                    <button className={`${HEAD_BTN} ${t.muted ? "border-me-green text-me-green" : "border-me-border text-me-mute"}`} title="静音/取消静音" onClick={(e) => { e.stopPropagation(); updateTrack(t.id, { muted: !t.muted }); }}>静</button>
                    <button className={`${HEAD_BTN} border-me-border text-me-red`} title="删除轨道（连片段一起删除）" onClick={(e) => { e.stopPropagation(); removeTrack(t.id); }}>×</button>
                  </div>
                </div>
              </Fragment>
            );
              })}
              <div className="h-2" />
            </>
          )}
        </div>

        {/* 时间区（参考 trackBox：刻度 + 轨道区 + 播放头为兄弟层，统一横向滚动） */}
        <div ref={scrollerRef} className="me-tl-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div
            ref={laneRef}
            onMouseDown={startLanePointer}
            onDragOver={(e) => e.preventDefault()}
            onDrop={dropOnBlank}
            className="relative min-w-full"
            style={{ width, height: isEmpty ? RULER_H + EMPTY_H : contentH }}
          >
            {/* 20px 刻度尺：固定 400 个槽位，key 为槽位下标 k。
                缩放只更新 left / 刻度线高度 / 文本，多余槽位用 hidden 隐藏，
                DOM 节点零增删，不会在反复拖动滑块时堆积 detached 节点。 */}
            <div data-ruler="" onMouseDown={startScrub} className="relative z-[3] h-5 cursor-ew-resize bg-me-app">
              {Array.from({ length: MAX_TICKS }, (_, k) => {
                const active = k < tickCount;
                const i = k * tickStride;
                const t = i * step;
                return (
                  <div key={k} className={`absolute top-0 h-5 w-px ${active ? "" : "hidden"}`} style={{ left: active ? t * pxPerSec : 0 }}>
                    <div className="absolute left-0 top-0 w-px bg-me-minor" style={{ height: active && (k === 0 || k === tickCount - 1) ? 10 : 6 }} />
                    <span className="absolute left-[3px] top-[5px] whitespace-nowrap text-[10px] text-me-major">{active ? fmtTick(t) : ""}</span>
                  </div>
                );
              })}
            </div>

            {isEmpty ? (
              <div data-empty-tracks="" className="relative h-[200px]">
                <div className="pointer-events-none absolute bottom-4 left-4 right-4 top-3 flex flex-col items-center justify-center gap-2 rounded border border-dashed border-me-major bg-me-raised text-[13px] text-me-dim">
                  <span className="text-me-major"><Icon name="box" size={44} /></span>
                  暂无内容，点击左侧功能栏或直接拖放侧边栏素材到这里
                </div>
              </div>
            ) : (
              <>
                <div className="h-3" />

                {tracks.map((t, ti) => {
              const isTarget = dropTarget === t.id;
              const showEdgeLine = insertHint?.kind === "edge" && insertHint.index === ti;
              const showHolderLine = insertHint?.kind === "holder" && insertHint.index === ti;
              return (
                <Fragment key={t.id}>
                  {/* 8px 轨道间隙：拖到此处即插入新轨（参考 trackPanelHolder） */}
                  <div
                    onDragOver={(e) => allowHolder(e, ti)}
                    onDragLeave={clearHint}
                    onDrop={(e) => dropOnHolder(e, ti)}
                    className="relative h-2 bg-me-app"
                  >
                    {showHolderLine && (
                      <div data-holder-line="" className="pointer-events-none absolute inset-x-0 top-[3px] z-[4] h-[2px] bg-me-warn shadow-[0_0_4px_#f4d000]" />
                    )}
                  </div>
                  <div
                    data-track-id={t.id}
                    onDragOver={(e) => allowDrop(e, t.id, ti)}
                    onDragLeave={clearHint}
                    onDrop={(e) => dropOnTrack(e, t.id, ti)}
                    className={`relative box-border border-b border-b-[#25252b] border-t border-t-me-app ${
                      t.type === "audio" ? "h-10" : "h-[52px]"
                    } ${isTarget ? "bg-me-track-active" : "bg-me-track"} ${t.hidden ? "opacity-50" : ""}`}
                  >
                    {showEdgeLine && (
                      <div data-insert-line="" className="pointer-events-none absolute inset-x-0 top-0 z-[4] h-[2px] bg-me-warn shadow-[0_0_4px_#f4d000]" />
                    )}
                    {clips
                      .filter((c) => c.track === t.id)
                      .map((c) => {
                        const w = Math.max(12, clipDuration(c) * pxPerSec);
                        const selected = selectedClipIds.includes(c.id);
                        const showFilmstrip = t.type === "video" && !c.isAudio;
                        return (
                          <div
                            key={c.id}
                            data-clip-id={c.id}
                            onMouseDown={(e) => startDrag(e, c, "move")}
                            title={`${t.name} · 起点 ${fmtTime(c.timelineStart)}${t.locked ? " · 已锁定" : ""} · 拖左右边缘裁剪`}
                            className={`absolute top-0 box-border h-full overflow-hidden whitespace-nowrap rounded border-l-2 px-4 py-1 text-[11px] text-me-text ${
                              t.type === "audio" ? "bg-me-green/30" : "bg-me-primary/30"
                            } ${t.locked ? "cursor-not-allowed" : "cursor-grab"}`}
                            style={{ left: c.timelineStart * pxPerSec, width: w, borderLeftColor: t.color, zIndex: selected ? 22 : 1 }}
                          >
                            {showFilmstrip && (
                              <ClipFilmstrip
                                clip={c}
                                source={sourceById.get(c.sourceId)}
                                pxPerSec={pxPerSec}
                                viewportLeft={Math.max(0, viewport.left - FILMSTRIP_OVERSCAN)}
                                viewportWidth={viewport.width + FILMSTRIP_OVERSCAN * 2}
                                heightPx={trackHeight(t)}
                              />
                            )}
                            {!t.locked && (
                              <>
                                <div data-trim="left" title="向左裁剪入点" onMouseDown={(e) => { e.stopPropagation(); startDrag(e, c, "trimLeft"); }} className={trimHandleClass("left", w, selected)} />
                                <div data-trim="right" title="向右裁剪出点" onMouseDown={(e) => { e.stopPropagation(); startDrag(e, c, "trimRight"); }} className={trimHandleClass("right", w, selected)} />
                              </>
                            )}
                            <span className="relative z-[2] rounded-[2px] bg-black/50 px-[3px]">
                              {t.type === "audio" ? "♪ " : ""}
                              {fmtTime(c.srcIn)}→{fmtTime(c.srcOut)} ×{c.speed}
                            </span>
                            {/* 选中框改为独立层：inset boxShadow 会被缩略图层盖住 */}
                            {selected && (
                              <div className="pointer-events-none absolute inset-0 z-[3] box-border rounded border-2 border-me-select" />
                            )}
                          </div>
                        );
                      })}
                  </div>
                </Fragment>
              );
            })}
                <div
                  onDragOver={(e) => allowHolder(e, tracks.length)}
                  onDragLeave={clearHint}
                  onDrop={(e) => dropOnHolder(e, tracks.length)}
                  className="relative h-2 bg-me-app"
                >
                  {insertHint?.kind === "holder" && insertHint.index === tracks.length && (
                    <div data-holder-line="" className="pointer-events-none absolute inset-x-0 top-[3px] h-[2px] bg-me-warn shadow-[0_0_4px_#f4d000]" />
                  )}
                </div>
              </>
            )}

            {/* 紫色吸附虚线（参考 TrackSuck） */}
            {snapLine !== null && (
              <div data-snap-line={snapLine} className="pointer-events-none absolute inset-y-0 z-[90] w-px border-l border-dashed border-l-me-violet" style={{ left: snapLine * pxPerSec }} />
            )}

            {/* 框选蒙层（参考 SelectionBox） */}
            {marquee && (
              <div className="pointer-events-none absolute z-[26] rounded-[2px] border border-[#757577] bg-[rgba(117,117,119,.7)]" style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />
            )}

            {/* 白色播放头：9×12 下圆角头 + 1px 竖线，贯穿刻度与全部轨道（参考 trackSeeker） */}
            <div data-playhead="" className="pointer-events-none absolute inset-y-0 z-[88] w-[9px]" style={{ left: time * pxPerSec - 4 }}>
              <div className="absolute left-0 top-0 h-3 w-[9px] rounded-b-[4px] bg-me-text" />
              <div className="absolute bottom-0 left-1 top-[10px] w-px bg-me-text" />
            </div>
            <div data-playhead="" onMouseDown={startScrub} title="拖动播放头"
              className="absolute top-0 z-[89] h-[14px] w-[9px] cursor-ew-resize" style={{ left: time * pxPerSec - 4 }} />
          </div>
        </div>
      </div>

      <div
        data-dropzone="blank"
        onDragOver={(e) => { e.preventDefault(); setDropTarget("__blank__"); }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={dropOnBlank}
        className={`border-t border-me-line text-center text-[10px] text-me-mute ${
          isEmpty ? "h-2" : "px-[10px] py-[3px]"
        } ${dropTarget === "__blank__" ? "bg-me-track-active" : "bg-me-app"}`}
      >
        {!isEmpty && "把素材拖到此处 → 自动新建一条上层视频轨并放置（拖到轨道间隙可在该层插入新轨）"}
      </div>

      <div data-footer="" data-time={time} data-duration={duration} data-clip-count={clips.length}
        className="border-t border-me-line px-[10px] pb-[5px] pt-[3px] text-[10px] text-me-mute">
        {fmtTime(time)} / {fmtTime(duration)} · {clips.length} 段 · {tracks.length} 轨 · {FPS}fps 帧对齐 · {snapEnabled ? `${SNAP_PX}px 吸附` : "吸附关闭"}
      </div>

      {/* 右键菜单（参考 timeline.vue 的 contextmenu + 深色 popover） */}
      {ctx && (
        <div
          className="fixed z-[999] w-[180px] rounded-[5px] border border-me-major bg-me-raised p-1 shadow-[0_8px_24px_rgba(0,0,0,.5)]"
          style={{ left: Math.min(ctx.x, window.innerWidth - 190), top: Math.min(ctx.y, window.innerHeight - 340) }}
        >
          {menuItems.map((item, i) => item === "divider"
            ? <div key={i} className="mx-[2px] my-1 h-px bg-me-border" />
            : (
              <div
                key={i}
                onClick={(e) => { e.stopPropagation(); item.run(); setCtx(null); }}
                className={`flex cursor-pointer items-center justify-between rounded-[3px] px-2 py-[5px] text-xs hover:bg-me-border ${item.danger ? "text-me-red" : "text-me-text"}`}
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-[10px] text-me-mute">{item.hint}</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
