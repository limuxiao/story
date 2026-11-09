import { Application, Sprite, Texture, ColorMatrixFilter } from "pixi.js";
import type { Clip, Quality, Source, Track } from "../types";
import { Mp4Source, AUDIO_SEG } from "./Mp4Source";
import { rangeUrl } from "../api/client";

interface Layer {
  id: string;
  clip: Clip;
  sourceId: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sprite: Sprite;
  lastTs: number;
  colorSig: string;
}

export class Compositor {
  app: Application | null = null;
  private layers = new Map<string, Layer>();
  private sources = new Map<string, Mp4Source>();
  private sourceUrls = new Map<string, string>();
  private sourceMap = new Map<string, Source>();
  private clips: Clip[] = [];
  private tracks: Track[] = [];
  private audible: Clip[] = [];
  private quality: Quality = "high";
  private stageW = 1280;
  private stageH = 720;
  private audioCtx: AudioContext | null = null;
  private audioNodes: { node: AudioBufferSourceNode; gain: GainNode; endsAt: number }[] = [];
  private scheduledSegs = new Set<string>();
  private playingAudio = false;
  private audioSig = "";
  private lastUpdateTime = 0;
  private lastPlaying = false;

  async init(canvas: HTMLCanvasElement, w: number, h: number) {
    this.stageW = w;
    this.stageH = h;
    this.app = new Application();
    await this.app.init({
      canvas,
      width: w,
      height: h,
      background: 0x000000,
      antialias: true,
      autoStart: true,
      preference: "webgl",
    });
    this.app.stage.sortableChildren = true;
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      this.audioCtx = null;
    }
  }

  setSources(sources: Source[]) {
    this.sourceMap.clear();
    for (const s of sources) this.sourceMap.set(s.id, s);
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    // 代理分辨率变化：重建源（纹理随之失效，故先清理图层）
    for (const l of this.layers.values()) {
      this.app?.stage.removeChild(l.sprite);
      l.sprite.destroy({ texture: true, textureSource: true });
    }
    this.layers.clear();
    for (const s of this.sources.values()) s.dispose();
    this.sources.clear();
    this.sourceUrls.clear();
  }

  sync(clips: Clip[], tracks: Track[]) {
    this.clips = clips;
    this.tracks = tracks;
  }

  private ensureSource(c: Clip): Mp4Source | null {
    const src0 = this.sourceMap.get(c.sourceId);
    if (!src0) return null;
    const rel =
      this.quality === "low"
        ? src0.previewUrl.replace("clip_720.mp4", "clip_480.mp4")
        : src0.previewUrl;
    const url = rangeUrl(rel);
    let s = this.sources.get(c.sourceId);
    if (!s || this.sourceUrls.get(c.sourceId) !== url) {
      if (s) s.dispose();
      s = new Mp4Source(c.sourceId, url, this.audioCtx || undefined);
      this.sources.set(c.sourceId, s);
      this.sourceUrls.set(c.sourceId, url);
      s.load();
    }
    return s;
  }

  private createLayer(c: Clip, src: Mp4Source): Layer {
    const canvas = document.createElement("canvas");
    canvas.width = src.width || 1280;
    canvas.height = src.height || 720;
    const ctx = canvas.getContext("2d")!;
    const tex = Texture.from(canvas);
    const sprite = new Sprite(tex);
    // 层序由轨道在 tracks 数组中的顺序决定（index 越小越靠上层）。
    // 每帧刷新，跨轨拖动 / 轨道上下调序后立即生效。
    const ti = this.tracks.findIndex((t) => t.id === c.track);
    sprite.zIndex = this.tracks.length - (ti < 0 ? 0 : ti);
    this.app!.stage.addChild(sprite);
    return {
      id: c.id,
      clip: c,
      sourceId: src.id,
      canvas,
      ctx,
      sprite,
      lastTs: -1,
      colorSig: "",
    };
  }

  update(time: number, playing: boolean) {
    if (!this.app) return;

    const index = new Map(this.tracks.map((t, i) => [t.id, i] as const));
    const requests = new Map<string, number[]>();
    const visible: { c: Clip; srcTime: number; z: number }[] = [];
    const audible: Clip[] = [];

    for (const c of this.clips) {
      const ti = index.get(c.track);
      if (ti === undefined) continue; // 轨道已删除
      const tr = this.tracks[ti];
      if (tr.hidden) continue; // 隐藏轨不参与预览
      // 音频片段也要建立解码源，否则拿不到按段解码的 PCM。
      const src = this.ensureSource(c);
      if (!src) continue;
      if (!tr.muted) audible.push(c);

      const end = c.timelineStart + (c.srcOut - c.srcIn) / (c.speed || 1);
      // 只让实际覆盖播放头的片段参与画面，0.5s 预取保证首帧就绪。
      // 旧逻辑提前 2s / 延后 6s 都算 active，会用负的源时间反复触发解码、清空帧池。
      if (time < c.timelineStart - 0.5 || time > end) continue;

      const srcTime = Math.max(0, c.srcIn + (time - c.timelineStart) * (c.speed || 1));
      // 只请求播放头对应的源时间。把 srcIn 也塞进并集会让窗口左端恒为 0，
      // 窗口随播放头线性扩张 → Worker 每次从关键帧重解整段前缀（帧数 O(n²) → OOM）。
      // 首帧兜底由 Mp4Source 的 anchor 机制负责，无需把 0 纳入窗口。
      const arr = requests.get(c.sourceId) || [];
      arr.push(srcTime);
      requests.set(c.sourceId, arr);
      // 纯音频片段同样要驱动 5 秒段请求（否则段式 PCM 永远不会加载），但不参与画面合成。
      if (!c.isAudio) visible.push({ c, srcTime, z: this.tracks.length - ti });
    }
    this.audible = audible;

    // 每个素材源每帧只推进一次窗口：多轨 / 多片段共享同一源时不再互相摧毁帧池。
    for (const [id, ts] of requests) this.sources.get(id)?.setTimeWindow(ts);

    const active = new Set(visible.map((v) => v.c.id));
    for (const [id, l] of this.layers) {
      if (!active.has(id)) {
        this.app.stage.removeChild(l.sprite);
        l.sprite.destroy({ texture: true, textureSource: true });
        this.layers.delete(id);
      }
    }

    for (const { c, srcTime, z } of visible) {
      const src = this.ensureSource(c);
      if (!src) continue;
      let l = this.layers.get(c.id);
      if (!l || l.sourceId !== src.id) {
        if (l) {
          this.app.stage.removeChild(l.sprite);
          l.sprite.destroy({ texture: true, textureSource: true });
        }
        l = this.createLayer(c, src);
        this.layers.set(c.id, l);
      }
      // 每帧刷新层序：跨轨拖动、轨道上下调序立即反映到预览。
      l.sprite.zIndex = z;
      if (!src.ready) continue;

      const frame = src.getFrameAt(srcTime);
      if (frame && frame.timestamp !== l.lastTs) {
        try {
          const dw = frame.displayWidth;
          const dh = frame.displayHeight;
          if (l.canvas.width !== dw || l.canvas.height !== dh) {
            l.canvas.width = dw;
            l.canvas.height = dh;
          }
          l.ctx.drawImage(frame, 0, 0, dw, dh);
          (l.sprite.texture.source as any).update();
          l.lastTs = frame.timestamp;
        } catch {
          // 帧可能在窗口回收中刚被 close；下一帧用新帧重画。
          l.lastTs = -1;
        }
      }
      this.applyTransform(l, c);
      l.sprite.alpha = (c.opacity ?? 1) * this.fadeEnvelope(c, time);
      this.applyColor(l, c);
    }

    this.syncAudio(time, playing);

    // 素材不再被任何片段引用时立刻释放 Worker / 帧池 / PCM，
    // 避免反复换素材后 Worker 与 mp4 缓冲只增不减（长时间运行的隐性 OOM）。
    const used = new Set(this.clips.map((c) => c.sourceId));
    for (const [id, s] of this.sources) {
      if (used.has(id)) continue;
      s.dispose();
      this.sources.delete(id);
      this.sourceUrls.delete(id);
    }
  }

  private applyTransform(l: Layer, c: Clip) {
    const sw = l.canvas.width || 1;
    const sh = l.canvas.height || 1;
    const sc = Math.min(this.stageW / sw, this.stageH / sh) * (c.scale || 1);
    l.sprite.scale.set(sc);
    l.sprite.anchor.set(0.5);
    l.sprite.position.set(this.stageW / 2 + (c.x || 0), this.stageH / 2 + (c.y || 0));
    l.sprite.rotation = ((c.rotate || 0) * Math.PI) / 180;
  }

  // 每段独立的淡入淡出包络。不同轨道的片段可同时在时间轴上重叠共存，
  // 由 opacity / x / y / scale 决定谁盖住谁（zIndex 按轨道排序）；
  // 旧逻辑会让两个同时开始的片段双双淡出到全透明 → 黑屏，已废弃。
  private fadeEnvelope(c: Clip, time: number): number {
    const local = time - c.timelineStart;
    const dur = (c.srcOut - c.srcIn) / (c.speed || 1);
    const fi = c.fadeIn ?? 0;
    const fo = c.fadeOut ?? 0;
    if (local < 0 || local > dur) return 0;
    let a = 1;
    if (fi > 0 && local < fi) a *= Math.max(0, local / fi);
    if (fo > 0 && local > dur - fo) a *= Math.max(0, (dur - local) / fo);
    return a;
  }

  private applyColor(l: Layer, c: Clip) {
    const sig = JSON.stringify(c.effects || []);
    if (l.colorSig === sig) return;
    l.colorSig = sig;
    if (!c.effects || c.effects.length === 0) {
      l.sprite.filters = [];
      return;
    }
    const f = new ColorMatrixFilter();
    for (const e of c.effects) {
      if (e.type === "brightness") f.brightness((e.params.value ?? 0) + 1, false);
      else if (e.type === "contrast") f.contrast((e.params.value ?? 0) + 1, false);
      else if (e.type === "saturation") f.saturate(e.params.value ?? 0, false);
    }
    l.sprite.filters = [f];
  }

  play(time: number) {
    this.playingAudio = true;
    this.lastPlaying = true;
    if (this.audioCtx && this.audioCtx.state === "suspended") void this.audioCtx.resume();
    this.audioSig = this.audioSignature();
    this.scheduleAudio(time);
  }

  pause() {
    this.playingAudio = false;
    this.lastPlaying = false;
    this.audioSig = "";
    this.stopAudio();
  }

  // 每帧调用：音频按 5 秒段异步就绪。签名变化（素材/片段/静音改变）或 seek 时重排；
  // 正常播放只做「未来 1.2 秒」的段预调度，不打断已经排好的声音。
  private syncAudio(time: number, playing: boolean) {
    if (playing !== this.lastPlaying) {
      if (playing) this.play(time);
      else this.pause();
      this.lastUpdateTime = time;
      return;
    }
    const seeked = Math.abs(time - this.lastUpdateTime) > 0.25;
    this.lastUpdateTime = time;
    if (!playing || !this.playingAudio) return;
    const sig = this.audioSignature();
    if (seeked || sig !== this.audioSig) {
      this.audioSig = sig;
      this.scheduleAudio(time);
      return;
    }
    this.pumpAudio(time);
  }

  // 签名只描述片段结构，不含「段就绪」状态：音频段每 5 秒到达一次，
  // 若据此重排会把正在播放的声音掐断。段就绪由 pumpAudio 每帧自然补齐。
  private audioSignature(): string {
    return this.audible
      .map((c) => `${c.id}:${c.sourceId}:${c.srcIn}:${c.srcOut}:${c.timelineStart}:${c.speed}:${c.volume}:${c.fadeIn}:${c.fadeOut}:${c.isAudio ? 1 : 0}`)
      .join("|");
  }

  private scheduleAudio(time: number) {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === "suspended") void this.audioCtx.resume();
    this.stopAudio();
    this.pumpAudio(time);
  }

  // 按「片段时间轴 × 源 5 秒段」提前调度 AudioBufferSourceNode：每 5 秒一个节点，
  // 用 audioCtx 时钟精确定时衔接，段段相连 → 全程有声（不再有 120 秒截断）。
  // 同时只保留播放头附近的 PCM 段，长时间播放内存恒定。
  private pumpAudio(time: number) {
    const audioCtx = this.audioCtx;
    if (!audioCtx || !this.playingAudio) return;
    const now = audioCtx.currentTime;

    // 回收已播完的节点，长时播放不会累积 WebAudio 节点。
    this.audioNodes = this.audioNodes.filter((n) => {
      if (n.endsAt > now - 0.2) return true;
      try { n.node.disconnect(); n.gain.disconnect(); } catch { /* noop */ }
      return false;
    });

    const horizon = time + 1.2;
    for (const c of this.audible) {
      // 视频轨取其自带音频，音频轨独立出声；多条轨道重叠即自然混音。
      const src = this.sources.get(c.sourceId);
      if (!src) continue;
      const speed = c.speed || 1;
      const dur = (c.srcOut - c.srcIn) / speed;
      const t0 = c.timelineStart;
      const t1 = t0 + dur;
      const vol = c.volume ?? 1;
      const fadeIn = c.fadeIn ?? 0;
      const fadeOut = c.fadeOut ?? 0;
      const envelope = (tl: number) => {
        const local = tl - t0;
        let a = vol;
        if (fadeIn > 0 && local < fadeIn) a *= Math.max(0, local / fadeIn);
        if (fadeOut > 0 && dur - local < fadeOut) a *= Math.max(0, (dur - local) / fadeOut);
        return Math.max(0, a);
      };

      let cursor = Math.max(time, t0);
      const limit = Math.min(horizon, t1);
      let guard = 0;
      while (cursor < limit && guard++ < 8) {
        const srcT = c.srcIn + (cursor - t0) * speed;
        const seg = Math.floor(srcT / AUDIO_SEG);
        const nextT = Math.min(t0 + ((seg + 1) * AUDIO_SEG - c.srcIn) / speed, t1);
        const segEnd = Math.min(nextT, t1);
        const key = `${c.id}:${seg}`;
        const info = src.getAudioSegment(seg);
        if (info && !this.scheduledSegs.has(key)) {
          // AudioBuffer 内偏移是「源秒」，playbackRate=speed 会把源秒按倍速消耗，
          // 与 srcTime 在时间轴上的推进保持一致。
          const offset = Math.max(0, srcT - info.start);
          if (offset < info.buffer.duration) {
            const node = audioCtx.createBufferSource();
            node.buffer = info.buffer;
            node.playbackRate.value = speed;
            const gain = audioCtx.createGain();
            const when = now + Math.max(0, cursor - time);
            gain.gain.setValueAtTime(envelope(cursor), when);
            gain.gain.linearRampToValueAtTime(
              envelope(segEnd), Math.max(when + 0.001, when + segEnd - cursor)
            );
            node.connect(gain).connect(audioCtx.destination);
            try {
              node.start(when, offset);
              this.scheduledSegs.add(key);
              this.audioNodes.push({
                node, gain,
                endsAt: when + (info.buffer.duration - offset) / speed,
              });
            } catch { /* noop */ }
          }
        }
        if (nextT >= limit) break;
        cursor = Math.max(cursor + 0.02, nextT);
      }
    }
  }

  private stopAudio() {
    for (const n of this.audioNodes) {
      try { n.node.stop(); } catch { /* noop */ }
      try { n.node.disconnect(); n.gain.disconnect(); } catch { /* noop */ }
    }
    this.audioNodes = [];
    this.scheduledSegs.clear();
  }

  destroy() {
    this.pause();
    for (const l of this.layers.values()) {
      l.sprite.destroy({ texture: true, textureSource: true });
    }
    this.layers.clear();
    for (const s of this.sources.values()) s.dispose();
    this.sources.clear();
    this.app?.destroy(true, { children: true });
    this.app = null;
    if (this.audioCtx) {
      try { void this.audioCtx.close(); } catch { /* noop */ }
      this.audioCtx = null;
    }
  }
}
