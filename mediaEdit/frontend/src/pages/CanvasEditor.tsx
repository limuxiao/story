import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import {
  listSources, uploadFile, exportProject, aiCommand, absUrl,
  getProject, saveProject,
} from "../api/client";
import { FPS } from "../utils/timelineTime";
import { navigate, editorPath } from "../router";
import type { ProjectPayload } from "../types";
import MediaLibrary from "../components/MediaLibrary";
import Preview from "../components/Preview";
import CanvasTimeline from "../components/CanvasTimeline";
import Inspector from "../components/Inspector";

type SaveState = "saved" | "saving" | "error";

const BTN = "inline-flex cursor-pointer items-center rounded-md bg-me-primary px-3 py-[6px] text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-60";
const GHOST_BTN = "cursor-pointer rounded-md border border-me-border bg-transparent px-[10px] py-[5px] text-xs text-me-dim";
const CENTER = "flex h-screen flex-col items-center justify-center bg-me-bg font-sans text-sm text-[#e5e7eb]";

// 与 DOM 版 App.tsx 完全相同的工程加载 / 自动保存逻辑，
// 只有时间轴换成全 canvas 实现，便于在同一份工程数据上做对照实验。
export default function CanvasEditor({ projectId }: { projectId: string }) {
  const sources = useEditor((s) => s.sources);
  const clips = useEditor((s) => s.clips);
  const tracks = useEditor((s) => s.tracks);
  const setLoadError = useEditor((s) => s.setLoadError);
  const loadError = useEditor((s) => s.loadError);
  const hydrate = useEditor((s) => s.hydrate);
  const addSource = useEditor((s) => s.addSource);
  const [exporting, setExporting] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hydrated.current = false;
    setLoading(true);
    setFatal(null);
    (async () => {
      try {
        const [doc, library] = await Promise.all([getProject(projectId), listSources()]);
        if (cancelled) return;
        const merged = [...(doc.sources || [])];
        for (const s of library) if (!merged.some((m) => m.id === s.id)) merged.push(s);
        setProjectName(doc.name);
        hydrate({ sources: merged, tracks: doc.tracks || [], clips: doc.clips || [] });
        hydrated.current = true;
        setSaveState("saved");
      } catch (e: any) {
        if (!cancelled) setFatal(e.message || "加载工程失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, hydrate]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const payload = (): ProjectPayload => {
      const s = useEditor.getState();
      return {
        sequence: { width: 1280, height: 720, fps: FPS },
        duration: s.duration,
        sources: s.sources,
        tracks: s.tracks,
        clips: s.clips,
      };
    };
    const unsub = useEditor.subscribe((st, prev) => {
      if (!hydrated.current) return;
      if (st.clips === prev.clips && st.tracks === prev.tracks &&
          st.sources === prev.sources && st.duration === prev.duration) return;
      if (timer) clearTimeout(timer);
      setSaveState("saving");
      timer = setTimeout(() => {
        timer = null;
        void saveProject(projectId, payload())
          .then(() => setSaveState("saved"))
          .catch(() => setSaveState("error"));
      }, 700);
    });
    return () => {
      unsub();
      if (timer && hydrated.current) {
        clearTimeout(timer);
        void saveProject(projectId, payload()).catch(() => {});
      }
    };
  }, [projectId]);

  const onUpload = async (file: File) => {
    try {
      const s = await uploadFile(file);
      addSource(s);
    } catch (e: any) {
      setLoadError("上传失败：" + e.message);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const srcMap = new Map(sources.map((s) => [s.id, s]));
      const project = {
        sequence: { width: 1280, height: 720, fps: FPS },
        tracks: [...tracks]
          .reverse()
          .filter((t) => !t.hidden)
          .map((t) => ({
            type: t.type,
            clips: clips
              .filter((c) => c.track === t.id)
              .map((c) => ({
                ...c,
                url: srcMap.get(c.sourceId)?.originalUrl || "",
                ...(t.muted ? { volume: 0 } : {}),
              })),
          })),
      };
      const res: any = await exportProject(project);
      if (!res?.ok || !res.url) throw new Error(res?.error || "导出未返回文件地址");
      const resp = await fetch(absUrl(res.url));
      if (!resp.ok) throw new Error("下载成片失败：" + resp.status);
      const href = URL.createObjectURL(await resp.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = "export.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (e: any) {
      setLoadError("导出失败：" + e.message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className={CENTER}>正在加载工程…</div>;
  if (fatal) {
    return (
      <div className={CENTER}>
        <div className="mb-[14px] text-me-red-soft">加载工程失败：{fatal}</div>
        <button className={GHOST_BTN} onClick={() => navigate("/")}>返回项目列表</button>
      </div>
    );
  }

  const saveText = saveState === "saving" ? "保存中…" : saveState === "error" ? "保存失败" : "已保存";
  const saveColor = saveState === "error" ? "text-me-red-soft" : saveState === "saving" ? "text-me-warn" : "text-me-mute";

  return (
    <div className="flex h-screen flex-col bg-me-app font-sans text-me-text">
      <header className="flex items-center gap-3 border-b border-me-line bg-me-bg px-[14px] py-2">
        <button className={GHOST_BTN} onClick={() => navigate("/")}>← 项目列表</button>
        <button className={GHOST_BTN} onClick={() => navigate(editorPath(projectId))}>切换到 DOM 版</button>
        <strong className="text-[15px] font-bold" data-project-name="">{projectName || "未命名项目"}</strong>
        <span className="rounded bg-me-violet/20 px-2 py-[2px] text-[11px] text-[#b9aeff]">Canvas 时间轴实验页</span>
        <span className="text-xs text-me-soft">整条时间轴由单个 canvas 绘制</span>
        <span data-save-state={saveState} className={`text-xs ${saveColor}`}>{saveText}</span>
        <div className="flex-1" />
        <label className={BTN}>
          上传素材
          <input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files[0])} />
        </label>
        <button className={BTN} onClick={onExport} disabled={exporting}>
          {exporting ? "导出中…" : "导出成片"}
        </button>
      </header>

      {loadError && <div className="bg-me-red-bg px-[14px] py-[6px] text-[13px] text-me-red-soft">{loadError}</div>}

      <div className="flex min-h-0 flex-1">
        <aside className="w-[200px] overflow-auto border-r border-me-line bg-me-app">
          <MediaLibrary />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-me-stage">
          <Preview />
          <CanvasTimeline />
        </main>
        <aside className="w-[280px] overflow-auto border-l border-me-line bg-me-app">
          <Inspector onAi={(text, clip) => aiCommand(text, clip)} />
        </aside>
      </div>
    </div>
  );
}
