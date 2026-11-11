import { create } from "zustand";
import {
  findTrack,
  initialTracks,
  makeTrack,
  reserveTrackIds,
  type Clip,
  type Quality,
  type Source,
  type Track,
} from "./types";
import {
  alignToFrame,
  clipDuration,
  clipEnd,
  FPS,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  overlaps,
} from "./utils/timelineTime";

let cid = 0;
export const newClipId = () => `c${++cid}`;
// 恢复工程时把自增计数器推到已存在 id 之后，避免新建片段与旧片段撞 id。
const reserveClipIds = (ids: string[]) => {
  for (const id of ids) {
    const m = /^c(\d+)$/.exec(id);
    if (m) cid = Math.max(cid, Number(m[1]));
  }
};

// 隐藏轨不参与预览/导出，也不该撑长总时长（参考 mobvoi TimelineTool.findMaxPoint 跳过 !track.show）。
const recalcDuration = (clips: Clip[], tracks: Track[]) => {
  const hidden = new Set(tracks.filter((t) => t.hidden).map((t) => t.id));
  const visible = clips.filter((c) => !hidden.has(c.track));
  return visible.length ? Math.max(...visible.map(clipEnd)) : 0;
};

// 轨道插入的统一入口：视频轨插到视频区最上方，音频轨追加到末尾；atIndex 可指定层序位置。
const insertTrack = (
  tracks: Track[],
  type: "video" | "audio",
  atIndex?: number
): { tracks: Track[]; track: Track } => {
  const ordinal = tracks.filter((t) => t.type === type).length;
  const created = makeTrack(type, `${type === "video" ? "V" : "A"}${ordinal + 1}`, tracks.length);
  const next = [...tracks];
  const firstAudio = next.findIndex((t) => t.type === "audio");
  const fallback = type === "video" && firstAudio >= 0 ? firstAudio : next.length;
  next.splice(Math.max(0, Math.min(next.length, atIndex ?? fallback)), 0, created);
  return { tracks: next, track: created };
};

interface Snapshot {
  clips: Clip[];
  tracks: Track[];
  duration: number;
  selectedClipId: string | null;
  selectedClipIds: string[];
}

// 内存快照撤销/重做（参考 mobvoi TimelineTool 的 IndexedDB 快照回放，这里简化为纯数据栈）。
const history = { past: [] as Snapshot[], future: [] as Snapshot[] };
const snap = (st: EditorState): Snapshot => ({
  clips: st.clips,
  tracks: st.tracks,
  duration: st.duration,
  selectedClipId: st.selectedClipId,
  selectedClipIds: st.selectedClipIds,
});
const record = () => {
  history.past.push(snap(useEditor.getState()));
  if (history.past.length > 60) history.past.shift();
  history.future.length = 0;
};
export const canUndo = () => history.past.length > 0;
export const canRedo = () => history.future.length > 0;

let clipboard: Clip[] = [];
const selectedIdsOf = (st: EditorState): string[] =>
  st.selectedClipIds.length ? st.selectedClipIds : st.selectedClipId ? [st.selectedClipId] : [];

export interface EditorState {
  sources: Source[];
  clips: Clip[];
  tracks: Track[];
  playing: boolean;
  time: number;
  duration: number;
  quality: Quality;
  pxPerSec: number;
  selectedClipId: string | null;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  loadError: string | null;

  setSources: (s: Source[]) => void;
  addSource: (s: Source) => void;
  // 从项目 XML 一次性恢复整个工程：同时清空撤销栈并推进 id 计数器。
  hydrate: (doc: { sources: Source[]; tracks: Track[]; clips: Clip[] }) => void;
  addClip: (c: Partial<Clip> & { sourceId: string }) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  selectClip: (id: string | null, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;

  // 工具栏动作
  beginEdit: () => void;
  undo: () => void;
  redo: () => void;
  splitAt: (t: number) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  copySelected: () => void;
  pasteAt: (t: number) => void;

  addTrack: (type: "video" | "audio", atIndex?: number) => string;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  moveTrack: (id: string, dir: -1 | 1) => void;
  selectTrack: (id: string | null) => void;

  setPlaying: (p: boolean) => void;
  setTime: (t: number) => void;
  setDuration: (d: number) => void;
  setQuality: (q: Quality) => void;
  setPxPerSec: (p: number) => void;
  setLoadError: (e: string | null) => void;
}

// 目标轨道解析：优先显式指定 → 时间轴上选中的目标轨 → 同类型第一条未锁定轨 → 自动新建。
const resolveTrack = (
  st: EditorState,
  wanted: string | undefined,
  isAudio: boolean | undefined
): { tracks: Track[]; track: Track } => {
  let tracks = st.tracks;
  let track = wanted ? findTrack(tracks, wanted) : undefined;
  if (!track && !wanted && st.selectedTrackId) {
    const sel = findTrack(tracks, st.selectedTrackId);
    if (sel && !sel.locked && (isAudio === undefined || (sel.type === "audio") === isAudio)) {
      track = sel;
    }
  }
  if (!track) {
    const type: "video" | "audio" = isAudio ? "audio" : "video";
    track = tracks.find((t) => t.type === type && !t.locked);
    if (!track) return insertTrack(tracks, type, type === "video" ? 0 : undefined);
  }
  return { tracks, track };
};

// 复制/粘贴共用：找到不冲突的目标轨，冲突则自动建轨。
const placeCopy = (
  base: Clip,
  start: number,
  state: { clips: Clip[]; tracks: Track[] }
): Clip => {
  const end = start + clipDuration(base);
  let trackId = base.track;
  let tracks = state.tracks;
  if (!findTrack(tracks, trackId)) {
    const type = base.isAudio ? "audio" : "video";
    trackId = tracks.find((t) => t.type === type && !t.locked)?.id ?? trackId;
  }
  if (state.clips.some((x) => x.track === trackId && overlaps(start, end, x.timelineStart, clipEnd(x)))) {
    const type = findTrack(tracks, trackId)?.type ?? "video";
    const r = insertTrack(tracks, type, type === "video" ? 0 : undefined);
    tracks = r.tracks;
    trackId = r.track.id;
  }
  state.tracks = tracks;
  return { ...base, id: newClipId(), timelineStart: start, track: trackId };
};

export const useEditor = create<EditorState>((set) => ({
  sources: [],
  clips: [],
  tracks: initialTracks(),
  playing: false,
  time: 0,
  duration: 0,
  quality: "high",
  pxPerSec: 80,
  selectedClipId: null,
  selectedClipIds: [],
  selectedTrackId: null,
  loadError: null,

  setSources: (s) => set({ sources: s }),
  addSource: (s) => set((st) => ({ sources: [s, ...st.sources] })),

  hydrate: (doc) => {
    const clips = doc.clips || [];
    const tracks = doc.tracks || [];
    const sources = doc.sources || [];
    // history 是模块级变量，跨项目残留会让一次 undo 回退到上一个工程。
    history.past.length = 0;
    history.future.length = 0;
    reserveClipIds(clips.map((c) => c.id));
    reserveTrackIds(tracks.map((t) => t.id));
    set({
      sources,
      clips,
      tracks,
      duration: recalcDuration(clips, tracks),
      time: 0,
      playing: false,
      selectedClipId: null,
      selectedClipIds: [],
      selectedTrackId: null,
      loadError: null,
    });
  },

  addClip: (c) => {
    record();
    set((st) => {
      const src = st.sources.find((s) => s.id === c.sourceId);
      const dur = src ? src.duration : 5;
      let { tracks, track } = resolveTrack(st, c.track, c.isAudio);
      const trackEnd = st.clips
        .filter((x) => x.track === track.id)
        .reduce((m, x) => Math.max(m, clipEnd(x)), 0);
      const srcIn = c.srcIn ?? 0;
      const srcOut = c.srcOut ?? dur;
      const speed = c.speed ?? 1;
      const start = alignToFrame(c.timelineStart ?? trackEnd);
      const end = start + (srcOut - srcIn) / speed;
      if (st.clips.some((x) => x.track === track.id && overlaps(start, end, x.timelineStart, clipEnd(x)))) {
        const created = insertTrack(tracks, track.type, track.type === "video" ? 0 : undefined);
        tracks = created.tracks;
        track = created.track;
      }
      const clip: Clip = {
        id: newClipId(),
        sourceId: c.sourceId,
        srcIn,
        srcOut,
        timelineStart: start,
        speed,
        volume: c.volume ?? 1,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
        opacity: c.opacity ?? 1,
        x: c.x ?? 0,
        y: c.y ?? 0,
        scale: c.scale ?? 1,
        rotate: c.rotate ?? 0,
        track: track.id,
        isAudio: track.type === "audio",
        effects: c.effects ?? [],
      };
      const clips = [...st.clips, clip];
      return {
        clips,
        tracks,
        duration: recalcDuration(clips, tracks),
        selectedClipId: clip.id,
        selectedClipIds: [clip.id],
        selectedTrackId: track.id,
      };
    });
  },

  // 属性/位置/trim 每帧都会调用，不逐帧记历史；交互开始时显式 beginEdit()。
  updateClip: (id, patch) =>
    set((st) => {
      const clips = st.clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
      if (patch.track !== undefined) {
        const t = clips.find((c) => c.id === id);
        const def = findTrack(st.tracks, patch.track);
        if (t && def) t.isAudio = def.type === "audio";
      }
      return { clips, duration: recalcDuration(clips, st.tracks) };
    }),

  removeClip: (id) => {
    record();
    set((st) => {
      const clips = st.clips.filter((c) => c.id !== id);
      return {
        clips,
        duration: recalcDuration(clips, st.tracks),
        selectedClipId: st.selectedClipId === id ? null : st.selectedClipId,
        selectedClipIds: st.selectedClipIds.filter((x) => x !== id),
      };
    });
  },

  selectClip: (id, additive = false) =>
    set((st) => {
      if (!id) return { selectedClipId: null, selectedClipIds: [] };
      if (!additive) return { selectedClipId: id, selectedClipIds: [id] };
      const has = st.selectedClipIds.includes(id);
      const ids = has ? st.selectedClipIds.filter((x) => x !== id) : [...st.selectedClipIds, id];
      return { selectedClipId: has ? (ids[0] ?? null) : id, selectedClipIds: ids };
    }),

  setSelection: (ids) => set({ selectedClipIds: ids, selectedClipId: ids[0] ?? null }),

  beginEdit: () => record(),

  undo: () => {
    const prev = history.past.pop();
    if (!prev) return;
    history.future.push(snap(useEditor.getState()));
    set({ ...prev });
  },

  redo: () => {
    const next = history.future.pop();
    if (!next) return;
    history.past.push(snap(useEditor.getState()));
    set({ ...next });
  },

  splitAt: (t) => {
    const st = useEditor.getState();
    const cut = alignToFrame(t);
    const locked = new Set(st.tracks.filter((x) => x.locked).map((x) => x.id));
    // 参考 toolBarBtn._canCut：只切割当前选中的片段，未选中则不切。
    const selected = new Set(selectedIdsOf(st));
    const targets = new Set(
      st.clips
        .filter((c) => !locked.has(c.track) && selected.has(c.id) && cut > c.timelineStart + 1 / FPS && cut < clipEnd(c) - 1 / FPS)
        .map((c) => c.id)
    );
    if (targets.size === 0) return;
    record();
    const clips: Clip[] = [];
    for (const c of st.clips) {
      if (!targets.has(c.id)) {
        clips.push(c);
        continue;
      }
      const mid = c.srcIn + (cut - c.timelineStart) * (c.speed || 1);
      clips.push({ ...c, srcOut: mid });
      clips.push({ ...c, id: newClipId(), srcIn: mid, timelineStart: cut });
    }
    set({ clips, duration: recalcDuration(clips, st.tracks) });
  },

  duplicateSelected: () => {
    const st = useEditor.getState();
    const ids = new Set(selectedIdsOf(st));
    const bases = st.clips.filter((c) => ids.has(c.id));
    if (!bases.length) return;
    record();
    const state = { clips: [...st.clips], tracks: st.tracks };
    const newIds: string[] = [];
    for (const c of bases) {
      const trackEnd = state.clips
        .filter((x) => x.track === c.track)
        .reduce((m, x) => Math.max(m, clipEnd(x)), 0);
      const copy = placeCopy(c, alignToFrame(trackEnd), state);
      state.clips.push(copy);
      newIds.push(copy.id);
    }
    set({
      clips: state.clips,
      tracks: state.tracks,
      duration: recalcDuration(state.clips, state.tracks),
      selectedClipId: newIds[0],
      selectedClipIds: newIds,
    });
  },

  deleteSelected: () => {
    const st = useEditor.getState();
    const ids = new Set(selectedIdsOf(st));
    if (!ids.size) return;
    record();
    const clips = st.clips.filter((c) => !ids.has(c.id));
    set({
      clips,
      duration: recalcDuration(clips, st.tracks),
      selectedClipId: null,
      selectedClipIds: [],
    });
  },

  copySelected: () => {
    const st = useEditor.getState();
    const ids = new Set(selectedIdsOf(st));
    clipboard = st.clips.filter((c) => ids.has(c.id)).map((c) => ({ ...c }));
  },

  pasteAt: (t) => {
    if (!clipboard.length) return;
    const st = useEditor.getState();
    record();
    const base = Math.min(...clipboard.map((c) => c.timelineStart));
    const at = alignToFrame(t);
    const state = { clips: [...st.clips], tracks: st.tracks };
    const newIds: string[] = [];
    for (const c of clipboard) {
      const copy = placeCopy(c, at + (c.timelineStart - base), state);
      state.clips.push(copy);
      newIds.push(copy.id);
    }
    set({
      clips: state.clips,
      tracks: state.tracks,
      duration: recalcDuration(state.clips, state.tracks),
      selectedClipId: newIds[0],
      selectedClipIds: newIds,
    });
  },

  addTrack: (type, atIndex) => {
    record();
    let id = "";
    set((st) => {
      const r = insertTrack(st.tracks, type, atIndex);
      id = r.track.id;
      return { tracks: r.tracks, selectedTrackId: id };
    });
    return id;
  },

  removeTrack: (id) => {
    record();
    set((st) => {
      const tracks = st.tracks.filter((t) => t.id !== id);
      const clips = st.clips.filter((c) => c.track !== id);
      return {
        tracks,
        clips,
        duration: recalcDuration(clips, tracks),
        selectedTrackId: st.selectedTrackId === id ? (tracks[0]?.id ?? null) : st.selectedTrackId,
        selectedClipId: clips.some((c) => c.id === st.selectedClipId) ? st.selectedClipId : null,
        selectedClipIds: st.selectedClipIds.filter((x) => clips.some((c) => c.id === x)),
      };
    });
  },

  updateTrack: (id, patch) =>
    set((st) => {
      const tracks = st.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      return {
        tracks,
        ...(patch.hidden !== undefined ? { duration: recalcDuration(st.clips, tracks) } : {}),
      };
    }),

  moveTrack: (id, dir) => {
    record();
    set((st) => {
      const i = st.tracks.findIndex((t) => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= st.tracks.length) return {};
      const tracks = [...st.tracks];
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      return { tracks };
    });
  },

  selectTrack: (id) => set({ selectedTrackId: id }),

  setPlaying: (p) => set({ playing: p }),
  setTime: (t) => set({ time: Math.max(0, t) }),
  setDuration: (d) => set({ duration: d }),
  setQuality: (q) => set({ quality: q }),
  setPxPerSec: (p) => set({ pxPerSec: Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, p)) }),
  setLoadError: (e) => set({ loadError: e }),
}));
