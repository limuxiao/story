import type { Clip } from "../types";

// 参考 mobvoi_media_editor 的 TimeTool：把 px ↔ 时间 ↔ 帧 的换算收敛到一层，
// 所有 seek / 拖入 / 片段移动 / trim 都走这里，避免各组件各自换算导致落点漂移。
export const FPS = 30;
export const SNAP_PX = 12; // 参考 trackPanelClip.vue 的 SUCK_DISTANCE = 12px
export const MIN_PX_PER_SEC = 20;
export const MAX_PX_PER_SEC = 320;

export const alignToFrame = (t: number) => Math.max(0, Math.round(t * FPS) / FPS);
export const pxToTime = (px: number, pps: number) => Math.max(0, px / pps);
export const timeToPx = (t: number, pps: number) => t * pps;

export const clipDuration = (c: Clip) => (c.srcOut - c.srcIn) / (c.speed || 1);
export const clipEnd = (c: Clip) => c.timelineStart + clipDuration(c);

export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && aEnd > bStart;

// 参考 TimelineData.getAllPointsWithOutClips：排除自身（及多选）后，
// 取所有其它片段的起止点 + 0 + 播放头作为候选吸附点。
export const snapCandidates = (
  clips: Clip[],
  excludeId: string | null | string[],
  playhead: number
): number[] => {
  const excluded = new Set(Array.isArray(excludeId) ? excludeId : excludeId ? [excludeId] : []);
  const set = new Set<number>([0, alignToFrame(playhead)]);
  for (const c of clips) {
    if (excluded.has(c.id)) continue;
    set.add(alignToFrame(c.timelineStart));
    set.add(alignToFrame(clipEnd(c)));
  }
  return [...set].sort((a, b) => a - b);
};

export interface SnapResult {
  time: number;
  point: number | null;
}

// 带迟滞的磁吸：吸住某个点后需拉开 2 倍阈值才脱离，避免临界点抖动。
// 参考 trackPanelClip.vue 的 _checkSuck + :250-256 的脱离判定。
export const snapTime = (
  t: number,
  candidates: number[],
  thresholdSec: number,
  held: number | null
): SnapResult => {
  if (held !== null && Math.abs(t - held) <= thresholdSec * 2) {
    return { time: held, point: held };
  }
  let best: number | null = null;
  let bestD = thresholdSec;
  for (const c of candidates) {
    const d = Math.abs(t - c);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best === null ? { time: t, point: null } : { time: best, point: best };
};

// 对片段的「起点」和「终点」分别尝试吸附，取更近的那个（参考 mobvoi 移动与 trim 共用吸附）。
export const snapClipRange = (
  start: number,
  duration: number,
  candidates: number[],
  thresholdSec: number,
  held: number | null
): SnapResult => {
  const head = snapTime(start, candidates, thresholdSec, held);
  const tail = snapTime(start + duration, candidates, thresholdSec, held);
  if (head.point !== null && tail.point !== null) {
    return Math.abs(start - head.time) <= Math.abs(start + duration - tail.time) ? head : {
      time: tail.time - duration,
      point: tail.point,
    };
  }
  if (head.point !== null) return head;
  if (tail.point !== null) return { time: tail.time - duration, point: tail.point };
  return { time: start, point: null };
};

// 参考 timelinePanel.vue 的虚拟刻度：缩放后每格目标宽度 ≥ 64px，步长随之切换。
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
export const tickStep = (pps: number) => TICK_STEPS.find((s) => s * pps >= 64) ?? 300;
