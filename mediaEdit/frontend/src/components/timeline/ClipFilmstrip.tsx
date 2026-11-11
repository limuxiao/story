import { memo } from "react";
import type { Clip, Source } from "../../types";
import { thumbUrl } from "../../api/client";
import { clipDuration } from "../../utils/timelineTime";

// 后端规格：每 1 秒一张，高度 60px 等比缩放。
const THUMB_INTERVAL = 1;
const THUMB_HEIGHT = 60;

interface Props {
  clip: Clip;
  source: Source | undefined;
  pxPerSec: number;
  // 时间区可视窗口在「内容坐标系」中的位置（px）。调用方已含 overscan。
  viewportLeft: number;
  viewportWidth: number;
  // 轨道行高：60px 高的缩略图等比显示到这个高度，格子像素宽由此确定。
  heightPx: number;
}

function ClipFilmstripImpl({ clip, source, pxPerSec, viewportLeft, viewportWidth, heightPx }: Props) {
  if (!source || source.duration <= 0) return null;

  const speed = clip.speed || 1;
  const clipLeft = clip.timelineStart * pxPerSec;
  const clipW = Math.max(12, clipDuration(clip) * pxPerSec);

  // 关键性能点：长片段被拉得再长，也只计算「片段 ∩ 可视窗口」的格子，
  // 屏幕外的几千个时间点既不建 DOM 也不发请求。
  const visL = Math.max(0, viewportLeft - clipLeft);
  const visR = Math.min(clipW, viewportLeft + viewportWidth - clipLeft);
  if (visR <= visL) return null;

  // 格宽固定为「缩略图按轨道高度等比显示」的像素宽度，与时间轴缩放无关：
  // 放大到同一秒被切成多格时，每张格子都重复展示该秒的帧并铺展过去；
  // 缩小时则自然跳秒取样。格子用整数像素首尾相接，可见范围始终连续无空隙。
  const nativeW = source.height > 0
    ? THUMB_HEIGHT * source.width / source.height
    : THUMB_HEIGHT * 16 / 9;
  const cellW = Math.max(24, Math.round(nativeW * heightPx / THUMB_HEIGHT));
  const maxN = Math.max(1, Math.ceil(source.duration / THUMB_INTERVAL));

  const cells: { key: string; n: number; x: number; w: number }[] = [];
  const from = Math.floor(visL / cellW);
  const to = Math.ceil(visR / cellW);
  for (let i = from; i <= to; i++) {
    const x = i * cellW;
    if (x >= clipW) break;
    // 片段局部坐标 → 时间轴时间 → 源时间。裁剪入点 / 变速后自动对齐，
    // 这是「按具体时间点展示」而不是拿首帧铺满的关键。
    const srcT = clip.srcIn + (x / pxPerSec) * speed;
    if (srcT < 0 || srcT > clip.srcOut + 0.001) continue;
    // 0001 对应源时间 0 秒：每格取该格起点落在哪一秒的帧，
    // 同一秒的帧可能被连续几格重复铺展，这正是无间隔的关键。
    const n = Math.floor(srcT / THUMB_INTERVAL) + 1;
    if (n < 1 || n > maxN) continue;
    const left = Math.round(x);
    const right = Math.round(Math.min(x + cellW, clipW));
    if (right <= left) continue;
    // 多画 1px 让相邻格子轻微重叠：浏览器子像素抗锯齿不会在边界留下
    // 一条露出底色（clip 背景）的发丝缝，后一格自然盖住前一格。
    cells.push({ key: `${i}:${n}`, n, x: left, w: right - left + 1 });
  }
  if (cells.length === 0) return null;

  return (
    <div data-filmstrip="" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {cells.map((c) => (
        <img
          key={c.key}
          data-thumb-n={c.n}
          src={thumbUrl(clip.sourceId, c.n)}
          alt=""
          draggable={false}
          className="absolute top-0 h-full object-fill"
          style={{ left: c.x, width: c.w }}
        />
      ))}
    </div>
  );
}

// 滚动时只有可视窗口变化的片段需要重算，其余片段保持上一次渲染。
export const ClipFilmstrip = memo(ClipFilmstripImpl);
export default ClipFilmstrip;
