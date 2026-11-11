import { useState } from "react";
import { useEditor } from "../store";
import type { Track } from "../types";

const INP = "w-20 rounded border border-me-border bg-me-raised px-1 py-[2px] text-xs text-me-text";
const ACT = "mt-1 cursor-pointer rounded-md bg-me-primary px-[10px] py-[5px] text-xs text-white";
const DANGER = "mt-2 cursor-pointer rounded-md border border-[#5a2a2a] bg-me-red-bg px-[10px] py-[5px] text-xs text-me-red-soft";

export default function Inspector({ onAi }: { onAi: (text: string, clip: any) => void }) {
  const selectedId = useEditor((s) => s.selectedClipId);
  const selectedCount = useEditor((s) => s.selectedClipIds.length);
  const clips = useEditor((s) => s.clips);
  const tracks: Track[] = useEditor((s) => s.tracks);
  const update = useEditor((s) => s.updateClip);
  const remove = useEditor((s) => s.removeClip);
  const clip = clips.find((c) => c.id === selectedId);
  const [aiText, setAiText] = useState("");
  const [aiMsg, setAiMsg] = useState("");

  if (!clip)
    return <div className="bg-me-app p-3 text-[13px] text-me-soft">在轨道上选择一个片段以编辑属性</div>;

  const setFx = (type: "brightness" | "contrast" | "saturation", value: number) => {
    const others = clip.effects.filter((e) => e.type !== type);
    update(clip.id, { effects: [...others, { type, params: { value } }] });
  };
  const getFx = (type: string) => clip.effects.find((e) => e.type === type)?.params.value ?? 0;

  return (
    <div className="bg-me-app p-3 text-[13px] accent-me-primary">
      <div className="mb-2 font-semibold">
        片段属性
        {selectedCount > 1 && <span className="ml-2 text-[11px] text-me-soft">已选中 {selectedCount} 个片段</span>}
      </div>
      <Row label="轨道">
        <select
          value={clip.track}
          onChange={(e) => update(clip.id, { track: e.target.value })}
          className="flex-1 rounded border border-me-border bg-me-raised px-1 py-[2px] text-xs text-me-text"
        >
          {tracks.map((t, i) => (
            <option key={t.id} value={t.id}>
              第 {i + 1} 层 · {t.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="起始时间">
        <input type="number" step="0.1" min="0" value={clip.timelineStart} onChange={(e) => update(clip.id, { timelineStart: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="源区间">
        <input type="number" step="0.1" value={clip.srcIn} onChange={(e) => update(clip.id, { srcIn: Number(e.target.value) })} className={INP} />
        <input type="number" step="0.1" value={clip.srcOut} onChange={(e) => update(clip.id, { srcOut: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="速度">
        <input type="number" step="0.1" min="0.1" value={clip.speed} onChange={(e) => update(clip.id, { speed: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="音量">
        <input type="range" min="0" max="2" step="0.1" value={clip.volume} onChange={(e) => update(clip.id, { volume: Number(e.target.value) })} />
        {clip.volume}
      </Row>
      <Row label="淡入">
        <input type="number" step="0.1" min="0" value={clip.fadeIn} onChange={(e) => update(clip.id, { fadeIn: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="淡出">
        <input type="number" step="0.1" value={clip.fadeOut} onChange={(e) => update(clip.id, { fadeOut: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="透明度">
        <input type="range" min="0" max="1" step="0.05" value={clip.opacity} onChange={(e) => update(clip.id, { opacity: Number(e.target.value) })} />
        {clip.opacity}
      </Row>
      <Row label="位置X/Y">
        <input type="number" value={clip.x} onChange={(e) => update(clip.id, { x: Number(e.target.value) })} className={INP} />
        <input type="number" value={clip.y} onChange={(e) => update(clip.id, { y: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="缩放">
        <input type="number" step="0.1" value={clip.scale} onChange={(e) => update(clip.id, { scale: Number(e.target.value) })} className={INP} />
      </Row>
      <Row label="旋转">
        <input type="number" value={clip.rotate} onChange={(e) => update(clip.id, { rotate: Number(e.target.value) })} className={INP} />
      </Row>

      <div className="mb-1 mt-2 font-semibold">调色 Filter</div>
      <Row label="亮度">
        <input type="range" min="-1" max="1" step="0.05" value={getFx("brightness")} onChange={(e) => setFx("brightness", Number(e.target.value))} />
      </Row>
      <Row label="对比度">
        <input type="range" min="-1" max="1" step="0.05" value={getFx("contrast")} onChange={(e) => setFx("contrast", Number(e.target.value))} />
      </Row>
      <Row label="饱和度">
        <input type="range" min="-1" max="1" step="0.05" value={getFx("saturation")} onChange={(e) => setFx("saturation", Number(e.target.value))} />
      </Row>

      <button className={DANGER} onClick={() => remove(clip.id)}>
        删除片段
      </button>

      <div className="mb-1 mt-3 font-semibold">对话式 AI 编辑</div>
      <input value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="如：加速 / 淡入 / 音量0.5 / 变亮" className={INP} />
      <button
        className={ACT}
        onClick={async () => {
          const r: any = await onAi(aiText, clip);
          if (r?.ops) {
            if (r.ops.remove) remove(clip.id);
            else update(clip.id, r.ops);
            setAiMsg("已应用：" + JSON.stringify(r.ops));
          }
        }}
      >
        应用
      </button>
      <div className="text-xs text-me-green">{aiMsg}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-[6px] flex items-center gap-[6px]">
      <span className="w-16 shrink-0 text-xs text-me-soft">{label}</span>
      {children}
    </div>
  );
}
