import type { Source } from "../types";

// 与 Worker 一致：一次 Range 请求严格对应 5 秒素材。
export const AUDIO_SEG = 5;
// 帧池硬上界（约 8s@30fps）：覆盖「当前段剩余 + 预取段」峰值，
// 既防 Worker 异常狂发帧撑爆堆，又不会把当前段尚未播放的帧提前回收。
const MAX_POOL_FRAMES = 240;

export interface AudioSeg {
  start: number;
  buffer: AudioBuffer;
}

// 单个素材源：持有一个解码 Worker + 主线程「5 秒段」帧池 / 音频缓冲。
// 段号不变就完全不发请求（静置零 churn）；每次只请求当前段与预取下一段，
// Worker 对每个段各发一次 HTTP Range，只拉该 5 秒的字节。
// 始终保留第一帧作为 anchor，避免任何情况下黑屏。
export class Mp4Source {
  readonly id: string;
  readonly url: string;
  width = 0;
  height = 0;
  duration = 0;
  ready = false;
  error: string | null = null;

  private worker: Worker;
  private pool = new Map<number, VideoFrame>();
  private anchorKey: number | null = null;
  // 段驱动：当前段 + 预取下一段；段号不变时零请求（静置不 churn）。
  private currentSeg = -1;
  private doneSegs = new Set<number>();
  private inFlight = new Set<number>();

  private audioCtx?: AudioContext;
  // 每个 5 秒段一个 AudioBuffer，只保留播放头附近的段：全程有声且内存恒定。
  private audioSegments = new Map<number, AudioSeg>();
  private disposed = false;

  constructor(id: string, url: string, audioCtx?: AudioContext) {
    this.id = id;
    this.url = url;
    this.audioCtx = audioCtx;
    this.worker = new Worker(new URL("./decodeWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e) => this.onMsg(e.data);
    this.worker.onerror = (e) => {
      this.error = e.message || "worker error";
    };
  }

  load(): Promise<void> {
    return new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        if (this.disposed || this.ready || this.error) { resolve(); return; }
        // 素材异常时不能无限 30ms 轮询：长时间挂悬空 Promise + 定时器。
        if (performance.now() - started > 20000) {
          this.error = "素材加载超时";
          resolve();
          return;
        }
        setTimeout(check, 30);
      };
      this.worker.postMessage({ cmd: "init", url: this.url });
      check();
    });
  }

  private onMsg(msg: any) {
    switch (msg.type) {
      case "ready":
        this.width = msg.width;
        this.height = msg.height;
        this.duration = msg.duration;
        this.ready = true;
        break;
      case "frame": {
        const t = msg.t as number;
        // dispose 之后的在途帧、以及远离当前段的迟到帧一律立即释放，不入帧池。
        const keepFrom = this.currentSeg < 0 ? 0 : this.currentSeg * AUDIO_SEG - 0.5;
        const keepTo = this.currentSeg < 0 ? AUDIO_SEG * 2 : (this.currentSeg + 2) * AUDIO_SEG + 0.5;
        if (this.disposed || t < keepFrom - 0.5 || t > keepTo + 0.5) {
          msg.frame.close();
          break;
        }
        const key = Math.round(t * 1000);
        const existing = this.pool.get(key);
        if (existing) existing.close();
        this.pool.set(key, msg.frame);
        if (this.anchorKey === null) this.anchorKey = key;
        // 硬上界：关掉最旧的帧；anchor（首帧兜底）永不回收。
        while (this.pool.size > MAX_POOL_FRAMES) {
          let oldest: number | null = null;
          for (const k of this.pool.keys()) {
            if (k === this.anchorKey) continue;
            if (oldest === null || k < oldest) oldest = k;
          }
          if (oldest === null) break;
          this.pool.get(oldest)?.close();
          this.pool.delete(oldest);
        }
        break;
      }
      case "audioSegment": {
        const data = msg.data as Float32Array[];
        const frames = data?.[0]?.length || 0;
        if (this.disposed || !this.audioCtx || frames === 0) break;
        const buf = this.audioCtx.createBuffer(msg.channels, frames, msg.rate);
        for (let ch = 0; ch < msg.channels; ch++) {
          if (data[ch]) buf.getChannelData(ch).set(data[ch]);
        }
        this.audioSegments.set(msg.seg as number, { start: msg.start, buffer: buf });
        // 只保留播放头附近的段；长时间播放不会累积 PCM（旧版全量 2.2GB 的 OOM 根因）。
        while (this.audioSegments.size > 6) {
          let oldest = Infinity;
          for (const k of this.audioSegments.keys()) oldest = Math.min(oldest, k);
          this.audioSegments.delete(oldest);
        }
        break;
      }
      case "segmentDone":
        this.inFlight.delete(msg.seg as number);
        this.doneSegs.add(msg.seg as number);
        break;
      case "error":
        this.error = msg.message;
        console.error("[Mp4Source]", msg.message);
        break;
    }
  }

  // 由合成器每帧调用一次：传入「本帧所有消费者」需要的源时间点。
  // 一个素材可被多条轨道、多个片段同时引用；统一按 5 秒段号聚合，
  // 段号不变时不发任何请求 → 静置零 decode、零帧 churn。
  setTimeWindow(times: number[]) {
    const ts = times.filter((t) => Number.isFinite(t)).map((t) => Math.max(0, t));
    if (ts.length === 0) return;
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    const seg = Math.floor(lo / AUDIO_SEG);
    const prev = this.currentSeg;
    this.currentSeg = seg;

    // 只保留播放头前 1 秒 + 当前段 + 预取段；anchor 首帧永不回收。
    // 旧逻辑保留前后各一段（15 秒 ≈ 450 帧）会触发帧池硬上界，
    // 把当前段尚未播放的帧关掉，画面卡在 anchor 上。
    const keepFrom = Math.max(seg * AUDIO_SEG - 0.5, lo - 1.0);
    const keepTo = (seg + 2) * AUDIO_SEG + 0.5;
    for (const [k, f] of this.pool) {
      const ft = k / 1000;
      if (k !== this.anchorKey && (ft < keepFrom || ft > keepTo)) {
        f.close();
        this.pool.delete(k);
      }
    }
    // 过远的段标记失效：seek 回退时允许重新请求（帧/PCM 已回收）。
    for (const s of [...this.doneSegs]) if (Math.abs(s - seg) > 2) this.doneSegs.delete(s);
    for (const s of [...this.audioSegments.keys()]) if (Math.abs(s - seg) > 3) this.audioSegments.delete(s);
    // 近距离 seek 回退（只差一段）时 doneSegs 仍标记已解码，但那些帧早已被回收。
    // 若帧池不覆盖播放头，就撤销该段标记重新请求，否则画面会一直停在 anchor 首帧。
    if (this.doneSegs.has(seg) && !this.inFlight.has(seg)) {
      let covered = false;
      for (const k of this.pool.keys()) {
        if (k === this.anchorKey) continue;
        const ft = k / 1000;
        if (ft >= lo - 0.25 && ft <= lo + 0.4) { covered = true; break; }
      }
      if (!covered) this.doneSegs.delete(seg);
    }

    if (seg !== prev && prev >= 0 && Math.abs(seg - prev) > 1) {
      this.worker.postMessage({ cmd: "cancel", seg });
      this.inFlight.clear();
    }
    // 一次只请求一个 5 秒段；接近段末才预取下一段，
    // 避免两段共 300 帧同时入池把当前段尚未播放的帧挤掉。
    const wants = [seg];
    if (lo >= (seg + 1) * AUDIO_SEG - 1.2 || hi > (seg + 1) * AUDIO_SEG - 0.3) {
      wants.push(seg + 1);
    }
    if (hi > (seg + 2) * AUDIO_SEG - 0.3) wants.push(seg + 2);
    for (const s of wants) {
      if (this.doneSegs.has(s) || this.inFlight.has(s)) continue;
      this.inFlight.add(s);
      this.worker.postMessage({ cmd: "decode", seg: s });
    }
  }

  getAudioSegment(seg: number): AudioSeg | null {
    return this.audioSegments.get(seg) || null;
  }

  getFrameAt(t: number): VideoFrame | null {
    if (this.pool.size === 0) return null;
    let best: VideoFrame | null = null;
    let bestT = -1;
    let earliest: VideoFrame | null = null;
    let earT = Infinity;
    for (const [k, f] of this.pool) {
      const ft = k / 1000;
      if (ft <= t && ft > bestT) {
        bestT = ft;
        best = f;
      }
      if (ft < earT) {
        earT = ft;
        earliest = f;
      }
    }
    // 优先播放头之前最近帧；无则取最早帧（anchor 兜底，绝不黑屏）。
    return best || earliest;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.terminate();
    for (const f of this.pool.values()) f.close();
    this.pool.clear();
    this.anchorKey = null;
    this.audioSegments.clear();
    this.doneSegs.clear();
    this.inFlight.clear();
  }
}

export type { Source };
