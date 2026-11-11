import { useEffect, useRef, useState } from "react";
import { useEditor } from "./store";
import {
  listSources, uploadFile, exportProject, aiCommand, absUrl,
  getProject, saveProject,
} from "./api/client";
import { FPS } from "./utils/timelineTime";
import { navigate } from "./router";
import type { ProjectPayload } from "./types";
import MediaLibrary from "./components/MediaLibrary";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";

type SaveState = "saved" | "saving" | "error";

const BTN = "inline-flex cursor-pointer items-center rounded-md bg-me-primary px-3 py-[6px] text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-60";
const GHOST_BTN = "cursor-pointer rounded-md border border-me-border bg-transparent px-[10px] py-[5px] text-xs text-me-dim";
const CENTER = "flex h-screen flex-col items-center justify-center bg-me-bg font-sans text-sm text-[#e5e7eb]";

export default function App({ projectId }: { projectId: string }) {
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
  // hydrate 自身触发的 store 变更不能被当成用户编辑写回工程。
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
        // 工程引用的素材优先，再补上素材库里的其它素材，保证上轨 / 预览可用。
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

  // 工程内容变化后防抖保存；播放头 / 选中态 / 缩放等视图状态不写盘。
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
      // 离开编辑器时把最后一次未落盘的编辑补齐。
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
      // 后端 vgraph 按 clips 顺序 overlay（后叠加者在上层）；tracks 数组前=上层，
      // 因此倒序传入；隐藏轨不参与导出，静音轨导出为 volume=0。
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
      // 用 blob 下载：跨域 <a download> 会被浏览器当作导航，导致编辑器页面被成片替换。
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

  if (loading) {
    return <div className={CENTER}>正在加载工程…</div>;
  }
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
        <strong className="text-[15px] font-bold" data-project-name="">{projectName || "未命名项目"}</strong>
        <span className="text-xs text-me-soft">WebCodecs + mp4box + PixiJS（无 video 标签）</span>
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

      {loadError && (
        <div className="bg-me-red-bg px-[14px] py-[6px] text-[13px] text-me-red-soft">{loadError}</div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-[200px] overflow-auto border-r border-me-line bg-me-app">
          <MediaLibrary />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-me-stage">
          <Preview />
          <Timeline />
        </main>
        <aside className="w-[280px] overflow-auto border-l border-me-line bg-me-app">
          <Inspector onAi={(text, clip) => aiCommand(text, clip)} />
        </aside>
      </div>
    </div>
  );
}
