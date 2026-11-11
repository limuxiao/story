import { useEffect, useRef } from "react";
import { useEditor } from "../store";
import { Compositor } from "../engine/Compositor";

export default function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compRef = useRef<Compositor | null>(null);

  const sources = useEditor((s) => s.sources);
  const clips = useEditor((s) => s.clips);
  const tracks = useEditor((s) => s.tracks);
  const quality = useEditor((s) => s.quality);
  const setQuality = useEditor((s) => s.setQuality);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setTime = useEditor((s) => s.setTime);
  const time = useEditor((s) => s.time);

  useEffect(() => {
    const c = new Compositor();
    compRef.current = c;
    let dirty = true;
    c.init(canvasRef.current!, 1280, 720).then(() => {
      c.setSources(useEditor.getState().sources);
      c.sync(useEditor.getState().clips, useEditor.getState().tracks);
      dirty = true;
    });
    // 工程状态变化才需要重新合成；暂停静置时不再每帧跑 update。
    const unsub = useEditor.subscribe(() => {
      dirty = true;
    });
    let raf = 0;
    let last = performance.now();
    let lastFrameRev = 0;
    // 后台标签的 rAF 会被冻结，恢复时 now-last 可能是几分钟。
    // 不 clamp 会让播放头一次跳到极远处，触发超大解码窗口。
    const onVisibility = () => { last = performance.now(); };
    document.addEventListener("visibilitychange", onVisibility);
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
      last = now;
      if (document.hidden) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const st = useEditor.getState();
      if (st.playing) {
        let t = st.time + dt;
        if (t >= st.duration) {
          t = st.duration;
          st.setPlaying(false);
        }
        st.setTime(t);
        dirty = true;
      }
      // Worker 送达新帧不经过工程状态订阅；暂停时也要据此重绘一次，
      // 让 seek 后异步解码出的正确帧替换掉空窗期的暂存画面。
      const rev = compRef.current?.frameRevision ?? 0;
      if (rev !== lastFrameRev) {
        lastFrameRev = rev;
        dirty = true;
      }
      if (dirty) {
        compRef.current?.update(useEditor.getState().time, st.playing);
        dirty = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      c.destroy();
      compRef.current = null;
    };
  }, []);

  useEffect(() => {
    compRef.current?.setSources(sources);
  }, [sources]);
  useEffect(() => {
    compRef.current?.sync(clips, tracks);
  }, [clips, tracks]);
  useEffect(() => {
    compRef.current?.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    if (playing) compRef.current?.play(useEditor.getState().time);
    else compRef.current?.pause();
  }, [playing]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-me-stage">
      <canvas
        ref={canvasRef}
        className="aspect-video max-h-[72%] w-full bg-black"
      />
      <div className="flex items-center gap-[10px] p-2">
        <button className="cursor-pointer rounded-md bg-me-blue px-4 py-[6px] text-[13px] text-white" onClick={() => setPlaying(!playing)}>
          {playing ? "暂停" : "播放"}
        </button>
        <span className="text-xs text-[#e5e7eb]">{time.toFixed(2)}s</span>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as any)}
          className="rounded border border-me-border bg-me-raised px-1 py-[2px] text-xs text-me-text"
        >
          <option value="high">高质量(720)</option>
          <option value="low">低质量(480)</option>
        </select>
      </div>
    </div>
  );
}
