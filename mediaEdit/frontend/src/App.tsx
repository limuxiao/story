import { useEffect, useState } from "react";
import { useEditor } from "./store";
import { listSources, uploadFile, exportProject, aiCommand, absUrl } from "./api/client";
import { FPS } from "./utils/timelineTime";
import MediaLibrary from "./components/MediaLibrary";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";


export default function App() {
  const setSources = useEditor((s) => s.setSources);
  const sources = useEditor((s) => s.sources);
  const clips = useEditor((s) => s.clips);
  const tracks = useEditor((s) => s.tracks);
  const setLoadError = useEditor((s) => s.setLoadError);
  const loadError = useEditor((s) => s.loadError);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listSources()
      .then(setSources)
      .catch((e) => setLoadError("加载素材库失败：" + e.message));
  }, [setSources, setLoadError]);

  const onUpload = async (file: File) => {
    try {
      const s = await uploadFile(file);
      setSources([s, ...sources]);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", background: "#232329", color: "#fafafa" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: "1px solid #2a2a2c", background: "#1e1e23" }}>
        <strong style={{ fontSize: 15 }}>新形态 AI 音视频剪辑 · 预览 Demo</strong>
        <span style={{ fontSize: 12, color: "#8a8a92" }}>WebCodecs + mp4box + PixiJS（无 video 标签）</span>
        <div style={{ flex: 1 }} />
        <label style={btn}>
          上传素材
          <input type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => e.target.files && onUpload(e.target.files[0])} />
        </label>
        <button style={btn} onClick={onExport} disabled={exporting}>
          {exporting ? "导出中…" : "导出成片"}
        </button>
      </header>

      {loadError && (
        <div style={{ background: "#3a2020", color: "#fca5a5", padding: "6px 14px", fontSize: 13 }}>{loadError}</div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside style={{ width: 200, background: "#232329", borderRight: "1px solid #2a2a2c", overflow: "auto" }}>
          <MediaLibrary />
        </aside>
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#0b0b0f" }}>
          <Preview />
          <Timeline />
        </main>
        <aside style={{ width: 280, background: "#232329", borderLeft: "1px solid #2a2a2c", overflow: "auto" }}>
          <Inspector onAi={(text, clip) => aiCommand(text, clip)} />
        </aside>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#308dff",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};
