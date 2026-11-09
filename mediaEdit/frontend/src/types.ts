export type Quality = "low" | "medium" | "high";

// 轨道是动态列表：数量不限，可增删、重命名、调整层序、锁定 / 隐藏 / 静音。
// 数组顺序即合成层序：index 越小越靠上层（上层覆盖下层），与预览 zIndex、导出 overlay 顺序一致。
export interface Track {
  id: string;
  name: string;
  type: "video" | "audio";
  color: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
}

let tid = 0;
export const newTrackId = () => `t${++tid}`;

const VIDEO_COLORS = ["#3b82f6", "#0ea5e9", "#6366f1", "#14b8a6", "#f97316"];
const AUDIO_COLORS = ["#a855f7", "#c084fc", "#ec4899", "#8b5cf6", "#d946ef"];

export const trackColor = (type: "video" | "audio", ordinal: number) =>
  (type === "video" ? VIDEO_COLORS : AUDIO_COLORS)[ordinal % 5];

export const makeTrack = (type: "video" | "audio", name: string, ordinal = 0): Track => ({
  id: newTrackId(),
  name,
  type,
  color: trackColor(type, ordinal),
  locked: false,
  hidden: false,
  muted: false,
});

// 参考 mobvoi 的空时间轴：初始没有任何轨道信息，第一条轨道由素材上轨时自动创建。
// 轨道数量仍不受限：拖到轨道间隙 / 同时间冲突 / 工具栏「+」都可继续建轨。
export const initialTracks = (): Track[] => [];

export const findTrack = (tracks: Track[], id: string): Track | undefined =>
  tracks.find((t) => t.id === id);

export interface Source {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  previewUrl: string;
  originalUrl: string;
}

export interface Effect {
  type: "brightness" | "contrast" | "saturation";
  params: { value: number };
}

export interface Clip {
  id: string;
  sourceId: string;
  srcIn: number;
  srcOut: number;
  timelineStart: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  track: string; // 轨道 id（不再是固定编号）
  isAudio: boolean;
  effects: Effect[];
}

export interface Project {
  sequence: { width: number; height: number; fps: number };
  tracks: {
    type: "video" | "audio";
    clips: Clip[];
  }[];
}
