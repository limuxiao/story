import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "../types";
import { createProject, deleteProject, listProjects, renameProject } from "../api/client";
import { editorPath, navigate } from "../router";

const fmtDur = (s: number) => {
  const total = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const fmtDate = (ts: number) => {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const PRIMARY_BTN = "home-primary rounded-[7px] bg-me-primary px-[18px] py-[9px] text-[13px] font-semibold text-white hover:bg-me-primary-hover disabled:cursor-default disabled:opacity-60";
const INPUT = "home-input flex-1 rounded-md border border-me-border bg-me-raised px-[11px] py-2 text-[13px] text-me-text outline-none focus:border-me-primary";

export default function Home() {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const reload = useCallback(async () => {
    try {
      setError(null);
      setItems(await listProjects());
    } catch (e: any) {
      setError(e.message || "加载项目失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const doc = await createProject(draft.trim() || "未命名项目");
      navigate(editorPath(doc.id));
    } catch (e: any) {
      setError(e.message || "创建项目失败");
      setBusy(false);
    }
  };

  const onRename = async (id: string) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await renameProject(id, name);
      await reload();
    } catch (e: any) {
      setError(e.message || "重命名失败");
    }
  };

  const onDelete = async (p: ProjectSummary) => {
    if (!window.confirm(`删除项目「${p.name}」？该操作不可撤销。`)) return;
    try {
      await deleteProject(p.id);
      await reload();
    } catch (e: any) {
      setError(e.message || "删除失败");
    }
  };

  return (
    <div className="me-home flex min-h-screen flex-col bg-me-bg font-sans text-me-text">
      <header className="home-head flex items-center gap-4 border-b border-me-line bg-me-panel px-8 py-5">
        <div>
          <div className="home-brand text-xl font-bold tracking-[.5px]">新形态 AI 音视频剪辑</div>
          <div className="home-sub mt-1 text-xs text-me-soft">项目工作台 · 工程以 XML 保存</div>
        </div>
        <div className="flex-1" />
        <button className={PRIMARY_BTN} onClick={() => { setCreating(true); setDraft(""); }}>
          + 新建项目
        </button>
      </header>

      {creating && (
        <div className="home-create flex items-center gap-[10px] border-b border-me-line bg-me-app px-8 py-[14px]">
          <input
            autoFocus
            className={`${INPUT} max-w-[340px]`}
            placeholder="输入项目名称"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <button className={PRIMARY_BTN} disabled={busy} onClick={() => void onCreate()}>
            {busy ? "创建中…" : "创建并打开"}
          </button>
          <button className="home-ghost rounded-[7px] border border-me-border bg-transparent px-[14px] py-2 text-[13px] text-me-dim" onClick={() => setCreating(false)}>取消</button>
        </div>
      )}

      {error && <div className="home-error bg-me-red-bg px-8 py-2 text-[13px] text-me-red-soft">{error}</div>}

      <main className="home-main flex-1 px-8 pb-10 pt-[26px]">
        <div className="home-section-title mb-[18px] text-[15px] font-semibold">
          我的项目 <span className="ml-[6px] text-xs font-normal text-me-soft">{loading ? "" : `${items.length} 个`}</span>
        </div>

        {loading ? (
          <div className="home-empty rounded-[10px] border border-dashed border-me-border px-5 py-16 text-center text-[13px] leading-[1.9] text-me-soft">正在加载项目列表…</div>
        ) : items.length === 0 ? (
          <div className="home-empty rounded-[10px] border border-dashed border-me-border px-5 py-16 text-center text-[13px] leading-[1.9] text-me-soft">
            <div className="home-empty-title mb-[6px] text-base font-semibold text-[#e5e7eb]">还没有项目</div>
            <div>点击右上角「新建项目」开始剪辑，工程会自动保存为 XML。</div>
          </div>
        ) : (
          <div className="home-grid grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-[18px]">
            {items.map((p, i) => (
              <div
                key={p.id}
                className="home-card group cursor-pointer overflow-hidden rounded-[10px] border border-[#33333b] bg-me-surface transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-[3px] hover:border-me-primary hover:shadow-[0_10px_26px_rgba(0,0,0,.35)]"
                data-project-id={p.id}
                onClick={() => navigate(editorPath(p.id))}
              >
                <div className="home-cover relative flex aspect-video items-center justify-center" style={{ background: COVERS[i % COVERS.length] }}>
                  <span className="home-cover-badge absolute bottom-[10px] left-[10px] rounded-[4px] bg-black/[.55] px-[7px] py-[2px] text-[11px] text-white">{fmtDur(p.duration)}</span>
                  <span className="home-cover-open text-[13px] font-semibold tracking-[1px] text-white/90 opacity-0 transition-opacity duration-150 group-hover:opacity-100">打开工程</span>
                </div>
                <div className="home-card-body px-[14px] pb-[13px] pt-3">
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      className={`${INPUT} home-rename w-full max-w-none px-2 py-[5px]`}
                      value={renameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => void onRename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void onRename(p.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <div className="home-card-name truncate text-sm font-semibold" title={p.name}>{p.name}</div>
                  )}
                  <div className="home-card-meta mt-[6px] text-xs text-[#9a9aa2]">
                    {p.trackCount} 条轨道 · {p.clipCount} 个片段
                  </div>
                  <div className="home-card-foot mt-3 flex items-center justify-between gap-2 text-[11px] text-[#7c7c84]">
                    <span>更新于 {fmtDate(p.updatedAt)}</span>
                    <span className="home-card-actions flex gap-2">
                      <button
                        className="home-link bg-transparent p-0 text-[11px] text-[#7fb4ff] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(p.id);
                          setRenameDraft(p.name);
                        }}
                      >重命名</button>
                      <button
                        className="home-link home-danger bg-transparent p-0 text-[11px] text-[#f28b8b] hover:underline"
                        onClick={(e) => { e.stopPropagation(); void onDelete(p); }}
                      >删除</button>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="home-footer border-t border-me-line px-8 py-[14px] text-[11px] text-[#6a6a72]">WebCodecs + mp4box + PixiJS · 本地自托管</footer>
    </div>
  );
}

const COVERS = [
  "linear-gradient(135deg,#1d3b63,#308dff)",
  "linear-gradient(135deg,#3a2b52,#8b5cf6)",
  "linear-gradient(135deg,#123c3a,#14b8a6)",
  "linear-gradient(135deg,#4a2c24,#f97316)",
];
