import { useEditor } from "../store";
import { absUrl } from "../api/client";
import type { Source } from "../types";

// 素材拖到时间轴时使用的自定义 MIME，Timeline 的轨道行据此接收落点。
export const MEDIA_MIME = "application/x-media-source";

// 参考 mobvoi imgFlex.vue 的时长角标（左上角，mm:ss）。
const fmtDuration = (d: number) => {
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

function FilmIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2.5 9h4.5M2.5 15h4.5M17 9h4.5M17 15h4.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff"
      strokeWidth={3} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export default function MediaLibrary() {
  const sources = useEditor((s) => s.sources);
  const addClip = useEditor((s) => s.addClip);

  // 点击加号 / 双击：与参考 ClipTool.disposeMediaClip 一致 —— 插入到播放头，
  // 轨道由 store.resolveTrack 自动按类型寻找，同时间冲突则自动新建可容纳的轨道。
  const addAtPlayhead = (id: string) =>
    addClip({ sourceId: id, timelineStart: useEditor.getState().time });

  return (
    <div className="flex h-full flex-col bg-me-app">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-me-line px-4 text-[13px] font-semibold">
        <span>素材</span>
        <span className="text-[11px] font-normal text-me-mute">{sources.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {sources.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-12 text-xs text-me-mute">
            <FilmIcon />
            暂无素材，点击右上角上传
          </div>
        )}
        {sources.map((s: Source) => (
          <div
            key={s.id}
            className="me-src-card group relative mb-3 w-full cursor-grab"
            data-source-id={s.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(MEDIA_MIME, s.id);
              e.dataTransfer.setData("text/plain", s.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={() => addAtPlayhead(s.id)}
            title={`${s.name} · 拖到时间轴，或悬停点击 + 添加到播放头`}
          >
            {/* 94px 缩略图区（参考 imgFlex.vue 的 .img_img） */}
            <div className="me-src-thumb relative mb-[5px] h-[94px] w-full overflow-hidden rounded bg-[#19191d] group-hover:outline group-hover:outline-1 group-hover:outline-me-primary">
              <div className="absolute inset-0 flex items-center justify-center text-me-border">
                <FilmIcon />
              </div>
              <img
                src={absUrl(`/api/poster/${s.id}`)}
                alt=""
                draggable={false}
                onError={(e) => { e.currentTarget.classList.add("hidden"); }}
                className="absolute inset-0 h-full w-full rounded object-cover"
              />
              {/* 时长角标：左上角常显 */}
              <span className="absolute left-0 top-0 h-[18px] rounded-br-[2px] bg-black/50 px-1 text-xs leading-[18px] text-me-text">
                {fmtDuration(s.duration)}
              </span>
              {/* 加号：右上角，仅 hover 出现（参考 AddBt + .addImg） */}
              <button
                type="button"
                className="me-src-add pointer-events-none absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-me-primary p-0 opacity-0 transition-opacity duration-[120ms] hover:bg-[#5aa8ff] group-hover:pointer-events-auto group-hover:opacity-100"
                data-add-source={s.id}
                draggable={false}
                title="添加到时间轴（播放头位置）"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); addAtPlayhead(s.id); }}
              >
                <PlusIcon />
              </button>
            </div>
            <div className="h-[22px] truncate text-sm leading-[22px] text-me-dim">
              {s.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
