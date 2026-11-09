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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#232329" }}>
      <style>{`
        .me-src-add{opacity:0;pointer-events:none;transition:opacity .12s}
        .me-src-card:hover .me-src-add{opacity:1;pointer-events:auto}
        .me-src-add:hover{background:#5aa8ff !important}
        .me-src-card:hover .me-src-thumb{outline:1px solid #308dff}
      `}</style>

      <div style={{
        height: 40, flexShrink: 0, boxSizing: "border-box", padding: "0 16px",
        borderBottom: "1px solid #2a2a2c", display: "flex", alignItems: "center",
        justifyContent: "space-between", fontSize: 13, fontWeight: 600,
      }}>
        <span>素材</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: "#7c7c84" }}>{sources.length}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 16px", boxSizing: "border-box" }}>
        {sources.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 48, color: "#7c7c84", fontSize: 12 }}>
            <FilmIcon />
            暂无素材，点击右上角上传
          </div>
        )}
        {sources.map((s: Source) => (
          <div
            key={s.id}
            className="me-src-card"
            data-source-id={s.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(MEDIA_MIME, s.id);
              e.dataTransfer.setData("text/plain", s.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={() => addAtPlayhead(s.id)}
            title={`${s.name} · 拖到时间轴，或悬停点击 + 添加到播放头`}
            style={{ position: "relative", width: "100%", marginBottom: 12, cursor: "grab" }}
          >
            {/* 94px 缩略图区（参考 imgFlex.vue 的 .img_img） */}
            <div className="me-src-thumb" style={{
              position: "relative", height: 94, width: "100%", marginBottom: 5,
              borderRadius: 4, background: "#19191d", overflow: "hidden",
            }}>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#3a3a42" }}>
                <FilmIcon />
              </div>
              <img
                src={absUrl(`/api/poster/${s.id}`)}
                alt=""
                draggable={false}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }}
              />
              {/* 时长角标：左上角常显 */}
              <span style={{
                position: "absolute", left: 0, top: 0, height: 18, lineHeight: "18px",
                padding: "0 4px", borderRadius: "0 0 2px 0", background: "rgba(0,0,0,.5)",
                fontSize: 12, color: "#fafafa",
              }}>
                {fmtDuration(s.duration)}
              </span>
              {/* 加号：右上角，仅 hover 出现（参考 AddBt + .addImg） */}
              <button
                type="button"
                className="me-src-add"
                data-add-source={s.id}
                draggable={false}
                title="添加到时间轴（播放头位置）"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); addAtPlayhead(s.id); }}
                style={{
                  position: "absolute", top: 8, right: 8, width: 20, height: 20, padding: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  border: "none", borderRadius: "50%", background: "#308dff", cursor: "pointer",
                }}
              >
                <PlusIcon />
              </button>
            </div>
            <div style={{
              height: 22, lineHeight: "22px", fontSize: 14, color: "#aeaeb2",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {s.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
