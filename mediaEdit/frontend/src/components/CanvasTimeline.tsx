import { useEffect, useRef } from "react";
import { canRedo, canUndo, useEditor } from "../store";
import { thumbUrl } from "../api/client";
import { MEDIA_MIME } from "./MediaLibrary";
import { fmtTime } from "../utils/time";
import {
  alignToFrame, clipDuration, clipEnd, FPS, MAX_PX_PER_SEC, MIN_PX_PER_SEC,
  pxToTime, SNAP_PX, snapCandidates, snapClipRange, snapTime, tickStep,
} from "../utils/timelineTime";
import type { Clip, Source, Track } from "../types";

/*
 * 全 canvas 时间轴（对照实验页用）。
 * 整个时间轴区域 —— 工具栏、刻度尺、轨道头、轨道行、片段、缩略图、播放头、
 * 右键菜单、滚动条 —— 全部由这一个 canvas 绘制，事件命中全部自己做。
 * 页面其余部分（素材库 / 预览 / 属性面板 / 顶栏）仍沿用 DOM 版组件。
 *
 * 与 DOM 版保持一致的几何、取样与状态动作，保证对比的是渲染模型而非功能差异：
 *  - 缩略图按秒取样、固定像素格宽、+1px 重叠，只绘制「片段 ∩ 可视窗口」；
 *  - 图片用内存 Image 对象缓存（不插入 DOM），onload 后触发重绘；
 *  - 静态层缓存到离屏 canvas，播放头等动态层每帧叠加，避免播放时全量重绘。
 */

const C = {
  app: "#232329",
  bg: "#1e1e23",
  panel: "#19191e",
  surface: "#26262d",
  raised: "#2e2e35",
  track: "#28282e",
  trackActive: "#303035",
  line: "#2a2a2c",
  divider: "#2a2a2e",
  border: "#3a3a42",
  minor: "#343337",
  major: "#505057",
  text: "#fafafa",
  dim: "#aeaeb2",
  mute: "#7c7c84",
  soft: "#8a8a92",
  primary: "#308dff",
  warn: "#f4d000",
  violet: "#7562ff",
  green: "#43cc8b",
  red: "#e06c6c",
  disabled: "#55555c",
  stage: "#0b0b0f",
};

const TOOLBAR_H = 40;
const HEAD_W = 148;
const RULER_H = 20;
const TOP_GAP = 12;
const HOLDER_H = 8;
const TRACK_VIEWPORT_H = 264;
const DROPZONE_H = 22;
const FOOTER_H = 20;
const CANVAS_H = TOOLBAR_H + TRACK_VIEWPORT_H + DROPZONE_H + FOOTER_H;
const THUMB_INTERVAL = 1;
const THUMB_HEIGHT = 60;
const trackHeight = (t: Track) => (t.type === "audio" ? 40 : 52);

type Rect = { x: number; y: number; w: number; h: number };
type HitBase = Rect;
type Hit =
  | (HitBase & { kind: "tool"; id: string })
  | (HitBase & { kind: "zoomSlider" })
  | (HitBase & { kind: "ruler" })
  | (HitBase & { kind: "trackHead"; trackId: string })
  | (HitBase & { kind: "headBtn"; trackId: string; id: string })
  | (HitBase & { kind: "clip"; clipId: string; part: "move" | "trimLeft" | "trimRight" })
  | (HitBase & { kind: "laneBlank" })
  | (HitBase & { kind: "dropzone" })
  | (HitBase & { kind: "hscroll" })
  | (HitBase & { kind: "vscroll" })
  | (HitBase & { kind: "playhead" })
  | (HitBase & { kind: "menu"; id: string });

interface Geometry {
  rows: { t: Track; top: number; bottom: number }[];
  contentH: number;
  areaY: number;
  areaH: number;
  laneX: number;
  laneW: number;
  maxScrollTop: number;
  maxScrollLeft: number;
}

interface ViewState {
  scrollLeft: number;
  scrollTop: number;
  snap: boolean;
  snapLine: number | null;
  marquee: Rect | null;
  ctx: { x: number; y: number; trackId: string | null; clipId: string | null } | null;
  dropHint: { x: number; y: number } | null;
}

type Drag =
  | { kind: "scrub" }
  | { kind: "zoom"; startX: number }
  | { kind: "hscroll"; startX: number; startScroll: number }
  | { kind: "vscroll"; startY: number; startScroll: number }
  | { kind: "marquee"; x0: number; y0: number }
  | {
      kind: "clip";
      mode: "move" | "trimLeft" | "trimRight";
      clipId: string;
      startX: number;
      startY: number;
      startTime: number;
      startIn: number;
      startOut: number;
      fromIdx: number;
      bases: { id: string; timelineStart: number; trackIdx: number }[];
      recorded: boolean;
      heldSnap: number | null;
      speed: number;
      sourceDuration: number;
      dur: number;
    };

// 缩略图缓存：Image 对象不插入文档，不产生 DOM 节点。
const thumbCache = new Map<string, HTMLImageElement>();
let onThumbLoad: (() => void) | null = null;
function getThumb(sid: string, n: number): HTMLImageElement | null {
  // canvas 的 drawImage 遇到跨域图片会污染画布（DOM 版 <img> 不受影响），
  // 污染后 getImageData / toDataURL 会抛 SecurityError。这里规整为同源路径，
  // 由 Vite dev proxy（或生产同源部署）转发到后端，保持图片请求语义不变。
  const u = new URL(thumbUrl(sid, n), window.location.href);
  const url = u.pathname + u.search;
  let img = thumbCache.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => onThumbLoad?.();
    img.onerror = () => onThumbLoad?.();
    img.src = url;
    thumbCache.set(url, img);
    if (thumbCache.size > 500) {
      const oldest = thumbCache.keys().next().value;
      if (oldest) thumbCache.delete(oldest);
    }
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const inRect = (x: number, y: number, r: Rect) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

const fmtTick = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(Number.isInteger(t) ? 0 : 1).padStart(Number.isInteger(t) ? 2 : 4, "0")}`;
};

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font = "11px system-ui, sans-serif") {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

interface MenuEntry { id: string; label: string; hint?: string; danger?: boolean }

export default function CanvasTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: CANVAS_H, dpr: 1 });
  const viewRef = useRef<ViewState>({
    scrollLeft: 0, scrollTop: 0, snap: true, snapLine: null,
    marquee: null, ctx: null, dropHint: null,
  });
  const geoRef = useRef<Geometry>({
    rows: [], contentH: 0, areaY: TOOLBAR_H + RULER_H,
    areaH: TRACK_VIEWPORT_H - RULER_H, laneX: HEAD_W, laneW: 0,
    maxScrollTop: 0, maxScrollLeft: 0,
  });
  const staticHitsRef = useRef<Hit[]>([]);
  const hitsRef = useRef<Hit[]>([]);
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);
  const dragRef = useRef<Drag | null>(null);

  const requestDraw = (staticDirty = false) => {
    if (staticDirty) dirtyRef.current = true;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  };

  function drawFilmstrip(
    ctx: CanvasRenderingContext2D, c: Clip, t: Track, source: Source,
    x: number, y: number, w: number, h: number, pps: number
  ) {
    const speed = c.speed || 1;
    const nativeW = source.height > 0 ? THUMB_HEIGHT * source.width / source.height : THUMB_HEIGHT * 16 / 9;
    const cellW = Math.max(24, Math.round(nativeW * h / THUMB_HEIGHT));
    const maxN = Math.max(1, Math.ceil(source.duration / THUMB_INTERVAL));
    const clipLeft = c.timelineStart * pps;
    const { w: W } = sizeRef.current;
    const laneW = W - HEAD_W;
    const visL = Math.max(0, viewRef.current.scrollLeft - clipLeft);
    const visR = Math.min(w, viewRef.current.scrollLeft + laneW - clipLeft);
    if (visR <= visL) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const from = Math.floor(visL / cellW);
    const to = Math.min(Math.ceil(visR / cellW), from + 256);
    for (let i = from; i <= to; i++) {
      const cx = i * cellW;
      if (cx >= w) break;
      const srcT = c.srcIn + (cx / pps) * speed;
      if (srcT < 0 || srcT > c.srcOut + 0.001) continue;
      const n = Math.floor(srcT / THUMB_INTERVAL) + 1;
      if (n < 1 || n > maxN) continue;
      const left = Math.round(cx);
      const right = Math.round(Math.min(cx + cellW, w));
      if (right <= left) continue;
      const img = getThumb(c.sourceId, n);
      const dx = x + left;
      const dw = right - left + 1;
      if (img) ctx.drawImage(img, dx, y, dw, h);
      else {
        ctx.fillStyle = C.raised;
        ctx.fillRect(dx, y, dw, h);
      }
    }
    ctx.restore();
    void t;
  }

  function rebuildStatic(ctx: CanvasRenderingContext2D) {
    const st = useEditor.getState();
    const view = viewRef.current;
    const { w: W, h: H } = sizeRef.current;
    const hits: Hit[] = [];
    const laneX = HEAD_W;
    const laneW = W - HEAD_W;
    const areaY = TOOLBAR_H + RULER_H;
    const areaH = TRACK_VIEWPORT_H - RULER_H;
    const pps = st.pxPerSec;

    // 轨道几何（与 DOM 版一致：刻度 20 + 顶部 12 + 每行 8 holder + 行高）
    const rows: Geometry["rows"] = [];
    let acc = TOP_GAP;
    for (const t of st.tracks) {
      acc += HOLDER_H;
      rows.push({ t, top: acc, bottom: acc + trackHeight(t) });
      acc += trackHeight(t);
    }
    acc += HOLDER_H;
    const contentH = acc;
    const total = Math.max(st.duration, 10);
    const maxScrollLeft = Math.max(0, total * pps - laneW + 200);
    const maxScrollTop = Math.max(0, contentH - areaH);
    view.scrollLeft = clamp(view.scrollLeft, 0, maxScrollLeft);
    view.scrollTop = clamp(view.scrollTop, 0, maxScrollTop);
    geoRef.current = { rows, contentH, areaY, areaH, laneX, laneW, maxScrollTop, maxScrollLeft };

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.app;
    ctx.fillRect(0, 0, W, H);

    // ---- 工具栏 ----
    ctx.fillStyle = C.app;
    ctx.fillRect(0, 0, W, TOOLBAR_H);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(0, TOOLBAR_H - 0.5);
    ctx.lineTo(W, TOOLBAR_H - 0.5);
    ctx.stroke();
    const tools: { id: string; text: string; disabled?: boolean }[] = [
      { id: "undo", text: "撤销", disabled: !canUndo() },
      { id: "redo", text: "重做", disabled: !canRedo() },
      { id: "split", text: "分割" },
      { id: "dupe", text: "副本", disabled: st.selectedClipIds.length === 0 },
      { id: "del", text: "删除", disabled: st.selectedClipIds.length === 0 },
      { id: "addV", text: "+视频轨" },
      { id: "addA", text: "+音频轨" },
      { id: "snap", text: `磁吸 ${view.snap ? "开" : "关"}` },
    ];
    let tx = 16;
    for (const b of tools) {
      const bw = b.text.length > 3 ? 58 : 40;
      label(ctx, b.text, tx, TOOLBAR_H / 2, b.disabled ? C.disabled : C.text, "11px system-ui, sans-serif");
      hits.push({ kind: "tool", id: b.id, x: tx - 4, y: 4, w: bw, h: TOOLBAR_H - 8 });
      tx += bw;
    }
    // 缩放控件（右侧）
    const zoomX = W - 150;
    label(ctx, "−", zoomX, TOOLBAR_H / 2, C.text, "16px system-ui, sans-serif");
    hits.push({ kind: "tool", id: "zoomOut", x: zoomX - 6, y: 4, w: 20, h: TOOLBAR_H - 8 });
    const sliderX = zoomX + 20;
    const sliderW = 100;
    ctx.fillStyle = C.minor;
    ctx.fillRect(sliderX, TOOLBAR_H / 2 - 1, sliderW, 2);
    const ratio = (pps - MIN_PX_PER_SEC) / (MAX_PX_PER_SEC - MIN_PX_PER_SEC);
    const knobX = sliderX + ratio * sliderW;
    rr(ctx, knobX - 4, TOOLBAR_H / 2 - 6, 8, 12, 2);
    ctx.fillStyle = C.text;
    ctx.fill();
    hits.push({ kind: "zoomSlider", x: sliderX, y: 0, w: sliderW, h: TOOLBAR_H });
    label(ctx, "+", sliderX + sliderW + 8, TOOLBAR_H / 2, C.text, "16px system-ui, sans-serif");
    hits.push({ kind: "tool", id: "zoomIn", x: sliderX + sliderW + 2, y: 4, w: 20, h: TOOLBAR_H - 8 });

    // ---- 轨道头（左侧，纵向滚动） ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOOLBAR_H, HEAD_W, TRACK_VIEWPORT_H);
    ctx.clip();
    ctx.fillStyle = C.app;
    ctx.fillRect(0, TOOLBAR_H, HEAD_W, TRACK_VIEWPORT_H);
    ctx.strokeStyle = C.divider;
    ctx.beginPath();
    ctx.moveTo(HEAD_W - 0.5, TOOLBAR_H);
    ctx.lineTo(HEAD_W - 0.5, TOOLBAR_H + TRACK_VIEWPORT_H);
    ctx.stroke();
    ctx.fillStyle = C.app;
    ctx.fillRect(0, TOOLBAR_H, HEAD_W, RULER_H);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(0, TOOLBAR_H + RULER_H - 0.5);
    ctx.lineTo(HEAD_W, TOOLBAR_H + RULER_H - 0.5);
    ctx.stroke();
    label(ctx, rows.length ? "轨道 / 控制" : "", 10, TOOLBAR_H + RULER_H / 2, C.major, "10px system-ui, sans-serif");
    for (let i = 0; i < rows.length; i++) {
      const { t, top } = rows[i];
      const hy = TOOLBAR_H + RULER_H + top - HOLDER_H - view.scrollTop;
      const y = TOOLBAR_H + RULER_H + top - view.scrollTop;
      const h = trackHeight(t);
      if (y + h < TOOLBAR_H || y > TOOLBAR_H + TRACK_VIEWPORT_H) continue;
      ctx.fillStyle = C.app;
      ctx.fillRect(0, hy, HEAD_W, HOLDER_H);
      const selected = t.id === st.selectedTrackId;
      ctx.globalAlpha = t.hidden ? 0.5 : 1;
      ctx.fillStyle = selected ? C.trackActive : C.app;
      ctx.fillRect(0, y, HEAD_W, h);
      ctx.fillStyle = selected ? C.primary : "transparent";
      ctx.fillRect(0, y, 2, h);
      ctx.strokeStyle = C.divider;
      ctx.beginPath();
      ctx.moveTo(0, y + h - 0.5);
      ctx.lineTo(HEAD_W, y + h - 0.5);
      ctx.stroke();
      hits.push({ kind: "trackHead", trackId: t.id, x: 0, y, w: HEAD_W, h });
      ctx.fillStyle = t.color;
      rr(ctx, 8, y + 7, 7, 7, 2);
      ctx.fill();
      label(ctx, t.name, 20, y + 10, C.text, "600 11px system-ui, sans-serif");
      label(ctx, `${t.type === "audio" ? "音频" : "视频"} · ${st.clips.filter((c) => c.track === t.id).length}段 · ${i + 1}层`, 8, y + 24, C.mute, "10px system-ui, sans-serif");
      const btnIds = ["up", "down", "lock", "hide", "mute", "remove"];
      const btnTexts = ["↑", "↓", "锁", "显", "静", "×"];
      const btnColors = [
        C.mute, C.mute,
        t.locked ? C.primary : C.mute,
        t.hidden ? C.warn : C.mute,
        t.muted ? C.green : C.mute,
        C.red,
      ];
      for (let b = 0; b < btnIds.length; b++) {
        const bx = 8 + b * 22;
        const by = y + 30;
        ctx.strokeStyle = C.border;
        rr(ctx, bx, by, 18, 16, 3);
        ctx.stroke();
        label(ctx, btnTexts[b], bx + 5, by + 8, btnColors[b], "10px system-ui, sans-serif");
        hits.push({ kind: "headBtn", trackId: t.id, id: btnIds[b], x: bx, y: by, w: 18, h: 16 });
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // ---- 刻度尺（只画可见刻度，canvas 版天然视口裁剪） ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(laneX, TOOLBAR_H, laneW, RULER_H);
    ctx.clip();
    ctx.fillStyle = C.app;
    ctx.fillRect(laneX, TOOLBAR_H, laneW, RULER_H);
    const step = tickStep(pps);
    const ticks = Math.ceil(total / step);
    const stride = Math.max(1, Math.ceil((ticks + 1) / 400));
    const count = Math.ceil((ticks + 1) / stride);
    for (let k = 0; k < count; k++) {
      const t = k * stride * step;
      const x = laneX + t * pps - view.scrollLeft;
      if (x < laneX - 40 || x > W + 40) continue;
      ctx.fillStyle = C.minor;
      ctx.fillRect(x, TOOLBAR_H, 1, k === 0 || k === count - 1 ? 10 : 6);
      label(ctx, fmtTick(t), x + 3, TOOLBAR_H + 9, C.major, "10px system-ui, sans-serif");
    }
    ctx.restore();
    hits.push({ kind: "ruler", x: laneX, y: TOOLBAR_H, w: laneW, h: RULER_H });

    // ---- 轨道行 / 片段 / 缩略图 ----
    const sourceById = new Map<string, Source>(st.sources.map((s) => [s.id, s]));
    ctx.save();
    ctx.beginPath();
    ctx.rect(laneX, areaY, laneW, areaH);
    ctx.clip();
    ctx.fillStyle = C.app;
    ctx.fillRect(laneX, areaY, laneW, areaH);
    if (rows.length === 0) {
      const bx = laneX + 16;
      const by = areaY + 12;
      const bw = Math.max(40, laneW - 32);
      const bh = 200 - 28;
      ctx.fillStyle = C.raised;
      ctx.fillRect(bx, by, bw, bh);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.major;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.setLineDash([]);
      label(ctx, "暂无内容，拖放素材到这里", bx + 20, by + bh / 2, C.dim, "13px system-ui, sans-serif");
      hits.push({ kind: "laneBlank", x: laneX, y: areaY, w: laneW, h: areaH });
    } else {
      hits.push({ kind: "laneBlank", x: laneX, y: areaY, w: laneW, h: areaH });
      for (let ri = 0; ri < rows.length; ri++) {
        const { t, top } = rows[ri];
        const hy = areaY + top - HOLDER_H - view.scrollTop;
        const y = areaY + top - view.scrollTop;
        const h = trackHeight(t);
        if (y + h < areaY || y > areaY + areaH) continue;
        ctx.fillStyle = C.app;
        ctx.fillRect(laneX, hy, laneW, HOLDER_H);
        ctx.globalAlpha = t.hidden ? 0.5 : 1;
        ctx.fillStyle = C.track;
        ctx.fillRect(laneX, y, laneW, h);
        ctx.strokeStyle = "#25252b";
        ctx.beginPath();
        ctx.moveTo(laneX, y + h - 0.5);
        ctx.lineTo(W, y + h - 0.5);
        ctx.stroke();
        for (const c of st.clips) {
          if (c.track !== t.id) continue;
          const cw = Math.max(12, clipDuration(c) * pps);
          const x = laneX + c.timelineStart * pps - view.scrollLeft;
          if (x + cw < laneX || x > W) continue;
          ctx.fillStyle = t.type === "audio" ? "rgba(67,204,139,.3)" : "rgba(48,141,255,.3)";
          rr(ctx, x, y, cw, h, 4);
          ctx.fill();
          ctx.fillStyle = t.color;
          ctx.fillRect(x, y, 2, h);
          const source = sourceById.get(c.sourceId);
          if (source && t.type === "video" && !c.isAudio) {
            drawFilmstrip(ctx, c, t, source, x, y, cw, h, pps);
          }
          const text = `${t.type === "audio" ? "♪ " : ""}${fmtTime(c.srcIn)}→${fmtTime(c.srcOut)} ×${c.speed}`;
          ctx.fillStyle = "rgba(0,0,0,.5)";
          const tw = Math.min(cw - 8, ctx.measureText(text).width + 6);
          ctx.fillRect(x + 6, y + 4, Math.max(0, tw), 15);
          label(ctx, text, x + 9, y + 12, C.text, "11px system-ui, sans-serif");
          const selected = st.selectedClipIds.includes(c.id) || st.selectedClipId === c.id;
          if (selected) {
            ctx.strokeStyle = "#eeeeee";
            ctx.lineWidth = 2;
            rr(ctx, x + 1, y + 1, cw - 2, h - 2, 4);
            ctx.stroke();
            ctx.lineWidth = 1;
          }
          // move 先入列，trim 后入列：命中时从后往前找，边缘才能优先命中裁剪把手。
          hits.push({ kind: "clip", clipId: c.id, part: "move", x, y, w: cw, h });
          if (!t.locked) {
            const hw = cw >= 30 ? 14 : 2;
            hits.push({ kind: "clip", clipId: c.id, part: "trimLeft", x, y, w: hw, h });
            hits.push({ kind: "clip", clipId: c.id, part: "trimRight", x: x + cw - hw, y, w: hw, h });
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // ---- 滚动条 ----
    if (maxScrollLeft > 0) {
      const sbY = TOOLBAR_H + TRACK_VIEWPORT_H - 6;
      ctx.fillStyle = "#2d2d32";
      ctx.fillRect(laneX, sbY, laneW, 6);
      const thumbW = Math.max(30, laneW * laneW / (total * pps + laneW));
      const thumbX = laneX + (view.scrollLeft / maxScrollLeft) * (laneW - thumbW);
      ctx.fillStyle = "#404247";
      rr(ctx, thumbX, sbY, thumbW, 6, 3);
      ctx.fill();
      hits.push({ kind: "hscroll", x: laneX, y: sbY - 2, w: laneW, h: 10 });
    }
    if (maxScrollTop > 0) {
      const sbX = W - 6;
      ctx.fillStyle = "#2d2d32";
      ctx.fillRect(sbX, areaY, 6, areaH);
      const thumbH = Math.max(24, areaH * areaH / contentH);
      const thumbY = areaY + (view.scrollTop / maxScrollTop) * (areaH - thumbH);
      ctx.fillStyle = "#404247";
      rr(ctx, sbX, thumbY, 6, thumbH, 3);
      ctx.fill();
      hits.push({ kind: "vscroll", x: sbX - 2, y: areaY, w: 10, h: areaH });
    }

    // ---- 拖放区 / 页脚 ----
    const dzY = TOOLBAR_H + TRACK_VIEWPORT_H;
    ctx.fillStyle = view.dropHint ? C.trackActive : C.app;
    ctx.fillRect(0, dzY, W, DROPZONE_H);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(0, dzY + 0.5);
    ctx.lineTo(W, dzY + 0.5);
    ctx.stroke();
    label(ctx, "把素材拖到此处 → 自动新建轨道并放置", 10, dzY + DROPZONE_H / 2, C.mute, "10px system-ui, sans-serif");
    hits.push({ kind: "dropzone", x: 0, y: dzY, w: W, h: DROPZONE_H });
    const ftY = dzY + DROPZONE_H;
    ctx.fillStyle = C.app;
    ctx.fillRect(0, ftY, W, FOOTER_H);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(0, ftY + 0.5);
    ctx.lineTo(W, ftY + 0.5);
    ctx.stroke();
    label(
      ctx,
      `${fmtTime(st.time)} / ${fmtTime(st.duration)} · ${st.clips.length} 段 · ${st.tracks.length} 轨 · ${FPS}fps · ${pps.toFixed(0)}px/s · canvas`,
      10, ftY + FOOTER_H / 2, C.mute, "10px system-ui, sans-serif"
    );

    staticHitsRef.current = hits;
  }

  function menuItems(): (MenuEntry | "divider")[] {
    const st = useEditor.getState();
    const items: (MenuEntry | "divider")[] = [
      { id: "split", label: "分割于播放头", hint: "Ctrl+B" },
      { id: "copy", label: "复制", hint: "Ctrl+C" },
      { id: "paste", label: "粘贴到播放头", hint: "Ctrl+V" },
      { id: "dupe", label: "创建副本", hint: "Ctrl+D" },
      { id: "del", label: "删除片段", hint: "Delete", danger: true },
      "divider",
      { id: "addV", label: "新建视频轨" },
      { id: "addA", label: "新建音频轨" },
    ];
    const ctx = viewRef.current.ctx;
    const t = ctx?.trackId ? st.tracks.find((x) => x.id === ctx.trackId) : undefined;
    if (t) {
      items.push(
        "divider",
        { id: "rename", label: "重命名轨道" },
        { id: "up", label: "上移一层" },
        { id: "down", label: "下移一层" },
        { id: "lock", label: t.locked ? "解锁轨道" : "锁定轨道" },
        { id: "hide", label: t.hidden ? "显示轨道" : "隐藏轨道" },
        { id: "mute", label: t.muted ? "取消静音" : "静音轨道" },
        { id: "removeTrack", label: "删除轨道", danger: true },
      );
    }
    return items;
  }

  function drawDynamic(ctx: CanvasRenderingContext2D): Hit[] {
    const st = useEditor.getState();
    const view = viewRef.current;
    const { w: W } = sizeRef.current;
    const hits: Hit[] = [];
    const laneX = HEAD_W;
    const pps = st.pxPerSec;
    const phX = laneX + st.time * pps - view.scrollLeft;

    // 播放头（贯穿刻度与轨道区）
    if (phX >= laneX - 10 && phX <= W + 10) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(laneX, TOOLBAR_H, W - laneX, TRACK_VIEWPORT_H);
      ctx.clip();
      ctx.fillStyle = C.text;
      ctx.fillRect(phX - 4, TOOLBAR_H, 9, 12);
      ctx.fillRect(phX, TOOLBAR_H + 10, 1, TRACK_VIEWPORT_H - 10);
      ctx.restore();
      hits.push({ kind: "playhead", x: phX - 5, y: TOOLBAR_H, w: 11, h: RULER_H });
    }

    // 吸附线
    if (view.snapLine !== null) {
      const x = laneX + view.snapLine * pps - view.scrollLeft;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.violet;
      ctx.beginPath();
      ctx.moveTo(x, TOOLBAR_H + RULER_H);
      ctx.lineTo(x, TOOLBAR_H + TRACK_VIEWPORT_H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 框选蒙层
    if (view.marquee) {
      const m = view.marquee;
      ctx.fillStyle = "rgba(117,117,119,.7)";
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeStyle = "#757577";
      ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w, m.h);
    }

    // 拖放提示线
    if (view.dropHint) {
      ctx.fillStyle = C.warn;
      ctx.fillRect(view.dropHint.x - 1, TOOLBAR_H + RULER_H, 2, TRACK_VIEWPORT_H - RULER_H);
    }

    // 右键菜单
    if (view.ctx) {
      const items = menuItems();
      const mw = 180;
      const rowH = 24;
      const mh = items.length * rowH + 8;
      const mx = Math.min(view.ctx.x, W - mw - 4);
      const my = Math.min(view.ctx.y, CANVAS_H - mh - 4);
      ctx.fillStyle = C.raised;
      rr(ctx, mx, my, mw, mh, 5);
      ctx.fill();
      ctx.strokeStyle = C.major;
      ctx.stroke();
      items.forEach((item, i) => {
        const y = my + 4 + i * rowH;
        if (item === "divider") {
          ctx.fillStyle = C.border;
          ctx.fillRect(mx + 6, y + rowH / 2, mw - 12, 1);
          return;
        }
        ctx.fillStyle = item.danger ? C.red : C.text;
        label(ctx, item.label, mx + 10, y + rowH / 2, item.danger ? C.red : C.text, "12px system-ui, sans-serif");
        if (item.hint) label(ctx, item.hint, mx + mw - 10 - ctx.measureText(item.hint).width, y + rowH / 2, C.mute, "10px system-ui, sans-serif");
        hits.push({ kind: "menu", id: item.id, x: mx, y, w: mw, h: rowH });
      });
    }
    return hits;
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w: W, h: H, dpr } = sizeRef.current;
    if (W <= 0) return;
    let layer = layerRef.current;
    if (!layer) {
      layer = document.createElement("canvas");
      layerRef.current = layer;
    }
    const lw = Math.round(W * dpr);
    const lh = Math.round(H * dpr);
    if (layer.width !== lw || layer.height !== lh) {
      layer.width = lw;
      layer.height = lh;
      dirtyRef.current = true;
    }
    if (dirtyRef.current) {
      const lctx = layer.getContext("2d");
      if (lctx) {
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rebuildStatic(lctx);
      }
      dirtyRef.current = false;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, W, H);
    const dynamicHits = drawDynamic(ctx);
    hitsRef.current = [...staticHitsRef.current, ...dynamicHits];
  }

  const posOf = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const hitAt = (x: number, y: number): Hit | undefined => {
    const list = hitsRef.current;
    for (let i = list.length - 1; i >= 0; i--) if (inRect(x, y, list[i])) return list[i];
    return undefined;
  };
  const timeAt = (x: number) => {
    const s = useEditor.getState();
    return alignToFrame(pxToTime(x - HEAD_W + viewRef.current.scrollLeft, s.pxPerSec));
  };
  const rowIndexAt = (y: number) => {
    const g = geoRef.current;
    const localY = y - g.areaY + viewRef.current.scrollTop;
    for (let i = 0; i < g.rows.length; i++) if (localY < g.rows[i].bottom + HOLDER_H / 2) return i;
    return Math.max(0, g.rows.length - 1);
  };

  function runTool(id: string) {
    const s = useEditor.getState();
    switch (id) {
      case "undo": s.undo(); break;
      case "redo": s.redo(); break;
      case "split": s.splitAt(s.time); break;
      case "dupe": s.duplicateSelected(); break;
      case "del": s.deleteSelected(); break;
      case "addV": s.addTrack("video", 0); break;
      case "addA": s.addTrack("audio"); break;
      case "snap": viewRef.current.snap = !viewRef.current.snap; requestDraw(true); break;
      case "zoomIn": s.setPxPerSec(Math.min(MAX_PX_PER_SEC, s.pxPerSec * 1.5)); break;
      case "zoomOut": s.setPxPerSec(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, s.pxPerSec / 1.5))); break;
    }
  }

  function runMenu(id: string) {
    const s = useEditor.getState();
    const tid = viewRef.current.ctx?.trackId;
    const t = tid ? s.tracks.find((x) => x.id === tid) : undefined;
    switch (id) {
      case "split": s.splitAt(s.time); break;
      case "copy": s.copySelected(); break;
      case "paste": s.pasteAt(s.time); break;
      case "dupe": s.duplicateSelected(); break;
      case "del": s.deleteSelected(); break;
      case "addV": s.addTrack("video", 0); break;
      case "addA": s.addTrack("audio"); break;
      case "rename": if (t) { const n = window.prompt("轨道名称", t.name); if (n?.trim()) s.updateTrack(t.id, { name: n.trim() }); } break;
      case "up": if (t) s.moveTrack(t.id, -1); break;
      case "down": if (t) s.moveTrack(t.id, 1); break;
      case "lock": if (t) s.updateTrack(t.id, { locked: !t.locked }); break;
      case "hide": if (t) s.updateTrack(t.id, { hidden: !t.hidden }); break;
      case "mute": if (t) s.updateTrack(t.id, { muted: !t.muted }); break;
      case "removeTrack": if (t) s.removeTrack(t.id); break;
    }
    viewRef.current.ctx = null;
    requestDraw(true);
  }

  function onDragMove(ev: MouseEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const st = useEditor.getState();
    const view = viewRef.current;
    const p = posOf(ev.clientX, ev.clientY);
    if (drag.kind === "scrub") {
      st.setTime(timeAt(p.x));
      return;
    }
    if (drag.kind === "zoom") {
      const s = posOf(drag.startX, 0).x;
      const sliderX = sizeRef.current.w - 130;
      const ratio = clamp((p.x - sliderX) / 100, 0, 1);
      st.setPxPerSec(MIN_PX_PER_SEC + ratio * (MAX_PX_PER_SEC - MIN_PX_PER_SEC));
      void s;
      return;
    }
    if (drag.kind === "hscroll" || drag.kind === "vscroll") {
      const g = geoRef.current;
      if (drag.kind === "hscroll") {
        const trackW = g.laneW;
        view.scrollLeft = clamp(drag.startScroll + (ev.clientX - drag.startX) * (g.maxScrollLeft / Math.max(1, trackW)), 0, g.maxScrollLeft);
      } else {
        view.scrollTop = clamp(drag.startScroll + (ev.clientY - drag.startY) * (g.maxScrollTop / Math.max(1, g.areaH)), 0, g.maxScrollTop);
      }
      requestDraw(true);
      return;
    }
    if (drag.kind === "marquee") {
      view.marquee = {
        x: Math.min(p.x, drag.x0), y: Math.min(p.y, drag.y0),
        w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0),
      };
      requestDraw(false);
      return;
    }
    if (drag.kind === "clip") {
      const dx = ev.clientX - drag.startX;
      const pps = st.pxPerSec;
      const candidates = view.snap
        ? snapCandidates(st.clips, drag.bases.map((b) => b.id), st.time)
        : [];
      const threshold = SNAP_PX / pps;
      if (drag.mode === "move") {
        const raw = Math.max(0, drag.startTime + dx / pps);
        const snapped = snapClipRange(raw, drag.dur, candidates, threshold, drag.heldSnap);
        drag.heldSnap = snapped.point;
        view.snapLine = snapped.point;
        const shift = alignToFrame(Math.max(0, snapped.time)) - drag.startTime;
        const toIdx = rowIndexAt(p.y);
        const dIdx = toIdx - drag.fromIdx;
        if (Math.abs(dx) < 1 && dIdx === 0 && Math.abs(shift) < 1 / FPS) return;
        if (!drag.recorded) { drag.recorded = true; st.beginEdit(); }
        for (const b of drag.bases) {
          const dest = st.tracks[clamp(b.trackIdx + dIdx, 0, Math.max(0, st.tracks.length - 1))];
          if (!dest || dest.locked) continue;
          st.updateClip(b.id, {
            timelineStart: alignToFrame(Math.max(0, b.timelineStart + shift)),
            track: dest.id,
          });
        }
      } else if (drag.mode === "trimLeft") {
        const newIn = Math.max(0, Math.min(drag.startOut - 1 / FPS, drag.startIn + (dx / pps) * drag.speed));
        const rawStart = drag.startTime + (newIn - drag.startIn) / drag.speed;
        const snapped = snapTime(rawStart, candidates, threshold, drag.heldSnap);
        drag.heldSnap = snapped.point;
        view.snapLine = snapped.point;
        const newStart = Math.max(0, snapped.time);
        if (!drag.recorded) { drag.recorded = true; st.beginEdit(); }
        st.updateClip(drag.clipId, {
          timelineStart: alignToFrame(newStart),
          srcIn: alignToFrame(Math.max(0, drag.startIn + (newStart - drag.startTime) * drag.speed)),
        });
      } else {
        const newOut = Math.max(drag.startIn + 1 / FPS, Math.min(drag.sourceDuration, drag.startOut + (dx / pps) * drag.speed));
        const rawEnd = drag.startTime + (newOut - drag.startIn) / drag.speed;
        const snapped = snapTime(rawEnd, candidates, threshold, drag.heldSnap);
        drag.heldSnap = snapped.point;
        view.snapLine = snapped.point;
        const finalOut = drag.startIn + (snapped.time - drag.startTime) * drag.speed;
        if (!drag.recorded) { drag.recorded = true; st.beginEdit(); }
        st.updateClip(drag.clipId, {
          srcOut: Math.max(drag.startIn + 1 / FPS, Math.min(drag.sourceDuration, finalOut)),
        });
      }
      requestDraw(true);
    }
  }

  function bindDrag() {
    const move = (ev: MouseEvent) => onDragMove(ev);
    const up = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (drag && drag.kind === "marquee") {
        const p = posOf(ev.clientX, ev.clientY);
        const x0 = Math.min(p.x, drag.x0), x1 = Math.max(p.x, drag.x0);
        const y0 = Math.min(p.y, drag.y0), y1 = Math.max(p.y, drag.y0);
        const st = useEditor.getState();
        if (x1 - x0 > 4 || y1 - y0 > 4) {
          const g = geoRef.current;
          const ids = st.clips.filter((c) => {
            const row = g.rows.find((r) => r.t.id === c.track);
            if (!row) return false;
            const top = g.areaY + row.top - viewRef.current.scrollTop;
            return c.timelineStart * st.pxPerSec < x1 - HEAD_W + viewRef.current.scrollLeft &&
              clipEnd(c) * st.pxPerSec > x0 - HEAD_W + viewRef.current.scrollLeft &&
              top + trackHeight(row.t) > y0 && top < y1;
          }).map((c) => c.id);
          st.setSelection(ids);
        } else {
          st.setTime(timeAt(p.x));
        }
        viewRef.current.marquee = null;
        requestDraw(true);
      }
      viewRef.current.snapLine = null;
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      requestDraw(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const p = posOf(e.clientX, e.clientY);
    const hit = hitAt(p.x, p.y);
    const st = useEditor.getState();
    const view = viewRef.current;
    if (view.ctx) {
      if (hit?.kind === "menu") runMenu(hit.id);
      else { view.ctx = null; requestDraw(true); }
      return;
    }
    if (!hit) { st.setSelection([]); return; }
    switch (hit.kind) {
      case "tool": runTool(hit.id); break;
      case "zoomSlider": {
        const sliderX = sizeRef.current.w - 130;
        const ratio = clamp((p.x - sliderX) / 100, 0, 1);
        st.setPxPerSec(MIN_PX_PER_SEC + ratio * (MAX_PX_PER_SEC - MIN_PX_PER_SEC));
        dragRef.current = { kind: "zoom", startX: e.clientX };
        bindDrag();
        break;
      }
      case "ruler": st.setTime(timeAt(p.x)); dragRef.current = { kind: "scrub" }; bindDrag(); break;
      case "playhead": st.setTime(timeAt(p.x)); dragRef.current = { kind: "scrub" }; bindDrag(); break;
      case "headBtn": {
        const t = st.tracks.find((x) => x.id === hit.trackId);
        if (!t) break;
        switch (hit.id) {
          case "up": st.moveTrack(t.id, -1); break;
          case "down": st.moveTrack(t.id, 1); break;
          case "lock": st.updateTrack(t.id, { locked: !t.locked }); break;
          case "hide": st.updateTrack(t.id, { hidden: !t.hidden }); break;
          case "mute": st.updateTrack(t.id, { muted: !t.muted }); break;
          case "remove": st.removeTrack(t.id); break;
        }
        break;
      }
      case "trackHead": st.selectTrack(hit.trackId); break;
      case "clip": {
        const c = st.clips.find((x) => x.id === hit.clipId);
        if (!c) break;
        const track = st.tracks.find((x) => x.id === c.track);
        if (!track || track.locked) break;
        if (!(e.metaKey || e.ctrlKey || e.shiftKey)) st.selectClip(c.id);
        else st.selectClip(c.id, true);
        const ids = useEditor.getState().selectedClipIds;
        const bases = (ids.length ? st.clips.filter((x) => ids.includes(x.id)) : [c]).map((x) => ({
          id: x.id,
          timelineStart: x.timelineStart,
          trackIdx: st.tracks.findIndex((q) => q.id === x.track),
        }));
        const source = st.sources.find((x) => x.id === c.sourceId);
        dragRef.current = {
          kind: "clip", mode: hit.part, clipId: c.id,
          startX: e.clientX, startY: e.clientY,
          startTime: c.timelineStart, startIn: c.srcIn, startOut: c.srcOut,
          fromIdx: st.tracks.findIndex((q) => q.id === c.track),
          bases, recorded: false, heldSnap: null,
          speed: c.speed || 1, sourceDuration: source?.duration ?? c.srcOut,
          dur: clipDuration(c),
        };
        bindDrag();
        break;
      }
      case "laneBlank":
      case "dropzone":
        dragRef.current = { kind: "marquee", x0: p.x, y0: p.y };
        bindDrag();
        break;
      case "hscroll":
        dragRef.current = { kind: "hscroll", startX: e.clientX, startScroll: view.scrollLeft };
        bindDrag();
        break;
      case "vscroll":
        dragRef.current = { kind: "vscroll", startY: e.clientY, startScroll: view.scrollTop };
        bindDrag();
        break;
      case "menu": break;
    }
    requestDraw(true);
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const st = useEditor.getState();
    const view = viewRef.current;
    const g = geoRef.current;
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      st.setPxPerSec(clamp(st.pxPerSec * factor, MIN_PX_PER_SEC, MAX_PX_PER_SEC));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      view.scrollLeft = clamp(view.scrollLeft + (e.deltaX || e.deltaY), 0, g.maxScrollLeft);
    } else if (g.maxScrollTop > 0) {
      const next = clamp(view.scrollTop + e.deltaY, 0, g.maxScrollTop);
      if (next === view.scrollTop) view.scrollLeft = clamp(view.scrollLeft + e.deltaY, 0, g.maxScrollLeft);
      view.scrollTop = next;
    } else {
      view.scrollLeft = clamp(view.scrollLeft + e.deltaY, 0, g.maxScrollLeft);
    }
    requestDraw(true);
  }

  function onContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const p = posOf(e.clientX, e.clientY);
    const hit = hitAt(p.x, p.y);
    const st = useEditor.getState();
    let trackId: string | null = null;
    if (hit?.kind === "trackHead" || hit?.kind === "headBtn") trackId = hit.trackId;
    else if (hit?.kind === "clip") trackId = st.clips.find((c) => c.id === hit.clipId)?.track ?? null;
    else if (hit?.kind === "laneBlank") trackId = geoRef.current.rows[rowIndexAt(p.y)]?.t.id ?? null;
    viewRef.current.ctx = { x: p.x, y: p.y, trackId, clipId: hit?.kind === "clip" ? hit.clipId : null };
    requestDraw(true);
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const p = posOf(e.clientX, e.clientY);
    const hit = hitAt(p.x, p.y);
    if (hit?.kind !== "trackHead") return;
    const st = useEditor.getState();
    const t = st.tracks.find((x) => x.id === hit.trackId);
    if (!t) return;
    const name = window.prompt("轨道名称", t.name);
    if (name?.trim()) st.updateTrack(t.id, { name: name.trim() });
  }

  function onDrop(e: React.DragEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const sid = e.dataTransfer.getData(MEDIA_MIME) || e.dataTransfer.getData("text/plain");
    viewRef.current.dropHint = null;
    if (!sid) return;
    const p = posOf(e.clientX, e.clientY);
    const st = useEditor.getState();
    const g = geoRef.current;
    const idx = rowIndexAt(p.y);
    const target = g.rows[idx]?.t;
    const at = alignToFrame(pxToTime(p.x - HEAD_W + viewRef.current.scrollLeft, st.pxPerSec));
    if (target && !target.locked) st.addClip({ sourceId: sid, track: target.id, timelineStart: at });
    else {
      const id = st.addTrack("video", 0);
      st.addClip({ sourceId: sid, track: id, timelineStart: at });
    }
    requestDraw(true);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onThumbLoad = () => requestDraw(true);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(CANVAS_H * dpr);
      sizeRef.current = { w, h: CANVAS_H, dpr };
      requestDraw(true);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const unsub = useEditor.subscribe((s, prev) => {
      const staticChanged =
        s.clips !== prev.clips || s.tracks !== prev.tracks || s.sources !== prev.sources ||
        s.pxPerSec !== prev.pxPerSec || s.duration !== prev.duration ||
        s.selectedClipId !== prev.selectedClipId || s.selectedClipIds !== prev.selectedClipIds ||
        s.selectedTrackId !== prev.selectedTrackId;
      requestDraw(staticChanged);
    });

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
      if (e.key === "Escape") { s.setSelection([]); viewRef.current.ctx = null; requestDraw(true); }
    };
    window.addEventListener("keydown", onKey);
    const closeMenu = () => { if (viewRef.current.ctx) { viewRef.current.ctx = null; requestDraw(true); } };
    window.addEventListener("blur", closeMenu);

    requestDraw(true);
    return () => {
      onThumbLoad = null;
      ro.disconnect();
      unsub();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", closeMenu);
      cancelAnimationFrame(rafRef.current);
    };
    // 所有视图状态都在 ref 中，effect 只挂载一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-canvas-timeline=""
      className="block w-full shrink-0"
      style={{ height: CANVAS_H }}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => {
        e.preventDefault();
        const p = posOf(e.clientX, e.clientY);
        viewRef.current.dropHint = { x: p.x, y: p.y };
        requestDraw(false);
      }}
      onDragLeave={() => { viewRef.current.dropHint = null; requestDraw(false); }}
      onDrop={onDrop}
    />
  );
}
