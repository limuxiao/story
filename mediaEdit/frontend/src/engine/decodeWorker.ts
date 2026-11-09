/// <reference lib="webworker" />
import MP4Box from "mp4box";

// Web Worker：只读 MP4 的 moov 索引 → 按 5 秒窗口计算样本字节偏移 → HTTP Range 只取窗口字节
// → WebCodecs 解码 → VideoFrame / PCM 交给主线程。全流程无任何 <video>/<audio> 元素。
//
// 与旧实现的根本区别：旧版 fetch(url).arrayBuffer() 会把整个 mp4（长素材可达 400MB+）
// 拉进 Worker 并缓存全量压缩样本；新版每次媒体请求严格对应一个 5 秒窗口，
// 索引只在素材初始化时读一次，内存与播放时长无关，音频也不再有时长上限。

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const SEG_SECONDS = 5;
// 索引请求上限（超长素材的 moov 可能数 MB）。媒体窗口远小于此。
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
// 相邻样本字节区间小于该阈值就合并成一次 Range，减少请求数。
const MERGE_GAP = 256 * 1024;

interface Sample {
  t: number;
  dur: number;
  off: number;
  size: number;
  sync: boolean;
}
interface InitMsg { cmd: "init"; url: string; }
interface DecodeMsg { cmd: "decode"; seg: number; }
interface CancelMsg { cmd: "cancel"; seg: number; }

let baseUrl = "";
let fileSize = 0;
let duration = 0;
let ready = false;

let vSamples: Sample[] = [];
let aSamples: Sample[] = [];
let videoDecoder: VideoDecoder | null = null;
let audioDecoder: AudioDecoder | null = null;
let videoConfig: any = null;
let audioConfig: any = null;
let audioDisabled = false;
// WebCodecs 的 error 回调会把 codec 永久置为 closed，无法 reset/configure。
// 不换新实例的话，之后每次 decode 都刷 InvalidStateError 且画面永久冻结。
let videoDecoderBroken = false;
let audioDecoderBroken = false;
let videoErrorLogged = false;

// 已请求的 5 秒段：解码输出是异步的，按帧时间戳判断是否属于当前缓冲段，
// 段外的依赖帧在 Worker 内直接 close，绝不 Transfer 到主线程。
let allowedSegs = new Set<number>();
// decoder 连续状态：播放头单调推进时直接续解，不重解关键帧前缀（避免 O(n²) / OOM）。
let lastVideoIdx = -1;
let lastAudioIdx = -1;
let videoConfigured = false;
let audioConfigured = false;

// 段请求串行队列：一次只处理一个 5 秒窗口，避免 Range 并发与 decoder 状态互相踩。
let queue: number[] = [];
let queued = new Set<number>();
let processing = false;

// 当前段正在收集的 PCM（flush 完成后合成一个 5 秒音频块）。
let audioCollect: Float32Array[][] | null = null;
let audioCollectStart = 0;
let audioCollectRate = 48000;
let audioCollectChannels = 2;

ctx.onmessage = (e: MessageEvent) => {
  const d = e.data as InitMsg | DecodeMsg | CancelMsg;
  if (d.cmd === "init") void doInit((d as InitMsg).url);
  else if (d.cmd === "decode") enqueue((d as DecodeMsg).seg);
  else if (d.cmd === "cancel") cancel((d as CancelMsg).seg);
};

function post(msg: any, transfer?: Transferable[]) {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

async function doInit(url: string) {
  if (typeof (ctx as any).VideoDecoder === "undefined") {
    post({ type: "error", message: "此浏览器不支持 WebCodecs（请用 Chrome / Edge）" });
    return;
  }
  baseUrl = url;
  try {
    const idx = await loadIndex();
    parseIndex(idx.buf, idx.fileStart);
    if (!ready) post({ type: "error", message: "MP4 索引中没有可解码的轨道" });
    // init 期间到达的段请求已在队列中，索引就绪后统一开始处理。
    void pump();
  } catch (err: any) {
    post({ type: "error", message: String(err) });
  }
}

// 只读取 moov（faststart 时在文件头；否则从文件尾定位），不触碰 mdat。
async function loadIndex(): Promise<{ buf: ArrayBuffer; fileStart: number }> {
  const head = await fetchRange(0, 65535);
  if (!fileSize) throw new Error("无法从 Content-Range 获取文件大小（后端需支持 /api/media Range）");
  const dv = new DataView(head);
  let pos = 0;
  let moovStart = -1;
  let moovSize = 0;
  while (pos + 8 <= head.byteLength) {
    let size = dv.getUint32(pos, false);
    const type = String.fromCharCode(
      dv.getUint8(pos + 4), dv.getUint8(pos + 5), dv.getUint8(pos + 6), dv.getUint8(pos + 7)
    );
    let hdr = 8;
    if (size === 1) {
      size = dv.getUint32(pos + 8, false) * 4294967296 + dv.getUint32(pos + 12, false);
      hdr = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }
    if (size < hdr || pos + size > fileSize + 8) break;
    if (type === "moov") { moovStart = pos; moovSize = size; break; }
    if (type === "mdat") break; // moov 在文件尾
    pos += size;
  }
  if (moovStart >= 0) {
    const end = Math.min(moovStart + moovSize - 1, MAX_INDEX_BYTES - 1);
    if (end < head.byteLength) return { buf: head.slice(0, end + 1), fileStart: 0 };
    return { buf: await fetchRange(0, end), fileStart: 0 };
  }
  const tailLen = Math.min(fileSize, MAX_INDEX_BYTES);
  const tailStart = fileSize - tailLen;
  const tail = await fetchRange(tailStart, fileSize - 1);
  const u = new Uint8Array(tail);
  const tdv = new DataView(tail);
  for (let i = 4; i + 8 <= u.length; i++) {
    if (u[i] === 109 && u[i + 1] === 111 && u[i + 2] === 111 && u[i + 3] === 118) {
      const boxStart = i - 4;
      const size = tdv.getUint32(boxStart, false);
      if (size >= 8 && boxStart + size <= u.length) {
        return { buf: tail.slice(boxStart, boxStart + size), fileStart: tailStart + boxStart };
      }
    }
  }
  throw new Error("MP4 索引 (moov) 定位失败");
}

async function fetchRange(a: number, b: number): Promise<ArrayBuffer> {
  const res = await fetch(baseUrl, { headers: { Range: `bytes=${a}-${b}` } });
  if (res.status !== 206) {
    throw new Error(`Range bytes=${a}-${b} -> ${res.status}（后端 /api/media 未生效？）`);
  }
  if (!fileSize) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "");
    if (m) fileSize = Number(m[1]);
  }
  return res.arrayBuffer();
}

function parseIndex(buf: ArrayBuffer, fileStart: number) {
  const ab = buf.slice(0);
  (ab as any).fileStart = fileStart;
  const f = MP4Box.createFile();
  f.onError = (e: string) => post({ type: "error", message: "mp4box: " + e });
  f.onReady = (info: any) => {
    duration = info.duration / info.timescale;
    const v = info.videoTracks && info.videoTracks[0];
    const a = info.audioTracks && info.audioTracks[0];

    if (v) {
      vSamples = toSamples(f.getTrackById(v.id)?.samples || []);
      videoConfig = {
        codec: v.codec,
        codedWidth: v.video?.width || 0,
        codedHeight: v.video?.height || 0,
      };
      const desc = getVideoDescription(v, f);
      if (desc) videoConfig.description = desc;
      try { createVideoDecoder(); }
      catch (err: any) { post({ type: "error", message: "VideoDecoder 配置失败：" + err }); }
    }

    if (a) {
      aSamples = toSamples(f.getTrackById(a.id)?.samples || []);
      audioConfig = {
        codec: a.codec,
        sampleRate: a.audio?.sample_rate || a.sample_rate || 48000,
        numberOfChannels: a.audio?.channel_count || a.channel_count || 2,
      };
      const desc = getAudioDescription(a, f);
      if (desc) audioConfig.description = desc;
      try { createAudioDecoder(); }
      catch (err: any) { disableAudio("AudioDecoder 配置失败", err); }
    }

    post({
      type: "ready",
      width: v?.video?.width || 0,
      height: v?.video?.height || 0,
      duration,
    });
    ready = true;
  };
  f.appendBuffer(ab as any);
  f.flush();
  if (!f.moov) throw new Error("MP4 索引解析失败");
}

function toSamples(smps: any[]): Sample[] {
  return smps.map((s) => ({
    t: s.cts / s.timescale,
    dur: s.duration / s.timescale,
    off: s.offset,
    size: s.size,
    sync: !!s.is_sync,
  }));
}

function disableAudio(reason: string, e: unknown) {
  if (audioDisabled) return;
  audioDisabled = true;
  console.warn("[decodeWorker] " + reason + "，已跳过音频（不影响视频）：", e);
}

function onAudioData(ad: AudioData) {
  if (!audioCollect) { ad.close(); return; }
  try {
    const ch = ad.numberOfChannels;
    const frames = ad.numberOfFrames;
    const arr: Float32Array[] = [];
    for (let c = 0; c < ch; c++) {
      const f32 = new Float32Array(frames);
      ad.copyTo(f32, { planeIndex: c, format: "f32-planar" } as any);
      arr.push(f32);
    }
    audioCollectRate = ad.sampleRate;
    audioCollectChannels = ch;
    audioCollect.push(arr);
  } catch (e) {
    console.error("[decodeWorker] audio", String(e));
  }
  ad.close();
}

function enqueue(seg: number) {
  if (seg < 0 || !Number.isFinite(seg)) return;
  if (queued.has(seg)) return;
  queued.add(seg);
  queue.push(seg);
  if (ready) void pump();
}

function cancel(keepFrom: number) {
  queue = queue.filter((s) => Math.abs(s - keepFrom) <= 1);
  queued = new Set(queue);
  // 回退/跳转后只保留目标附近的段，避免旧段的迟到帧混入帧池。
  for (const s of [...allowedSegs]) if (Math.abs(s - keepFrom) > 2) allowedSegs.delete(s);
}

async function pump() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const seg = queue.shift()!;
    queued.delete(seg);
    try {
      await decodeSegment(seg);
    } catch (e) {
      console.error("[decodeWorker] segment", seg, String(e));
      post({ type: "segmentDone", seg });
    }
  }
  processing = false;
}

function lowerBound(arr: Sample[], t: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t - 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface ByteBuf { start: number; buf: ArrayBuffer; }

async function fetchSampleBytes(smps: Sample[]): Promise<ByteBuf[]> {
  const spans = smps
    .filter((s) => s.size > 0)
    .map((s) => ({ a: s.off, b: s.off + s.size }))
    .sort((x, y) => x.a - y.a);
  const merged: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.a <= last.end + MERGE_GAP) last.end = Math.max(last.end, s.b);
    else merged.push({ start: s.a, end: s.b });
  }
  const out: ByteBuf[] = [];
  for (const r of merged) {
    const end = Math.min(r.end - 1, r.start + MAX_INDEX_BYTES - 1);
    out.push({ start: r.start, buf: await fetchRange(r.start, end) });
  }
  return out;
}

function sliceSample(s: Sample, bufs: ByteBuf[]): Uint8Array | null {
  for (const b of bufs) {
    if (s.off >= b.start && s.off + s.size <= b.start + b.buf.byteLength) {
      return new Uint8Array(b.buf, s.off - b.start, s.size);
    }
  }
  return null;
}

function onVideoFrame(frame: VideoFrame) {
  const t = frame.timestamp / 1e6;
  const s = Math.floor(t / SEG_SECONDS);
  // 允许邻段：B 帧 / 时间戳舍入会让边界帧落在相邻段。
  if (!allowedSegs.has(s) && !allowedSegs.has(s - 1) && !allowedSegs.has(s + 1)) {
    frame.close();
    return;
  }
  post({ type: "frame", t, frame }, [frame]);
}

function onVideoError(e: any) {
  videoDecoderBroken = true;
  videoConfigured = false;
  lastVideoIdx = -1;
  if (!videoErrorLogged) {
    videoErrorLogged = true;
    console.warn("[decodeWorker] video decoder error，下一段自动重建：", String(e));
  }
}

function onAudioError(e: any) {
  audioDecoderBroken = true;
  audioConfigured = false;
  lastAudioIdx = -1;
  console.warn("[decodeWorker] audio decoder error，下一段自动重建：", String(e));
}

function configureAudio(dec: AudioDecoder): boolean {
  try { dec.configure(audioConfig); return true; }
  catch {
    // 某些容器未携带 AudioSpecificConfig：去掉 description 再试（AAC 仍可解码）。
    try {
      dec.configure({
        codec: audioConfig.codec,
        sampleRate: audioConfig.sampleRate,
        numberOfChannels: audioConfig.numberOfChannels,
      } as any);
      return true;
    } catch (e) { disableAudio("AudioDecoder 配置失败", e); return false; }
  }
}

// closed codec 无法 configure/reset，只能换新实例。重建后本段从关键帧重新开始。
function createVideoDecoder() {
  try { videoDecoder?.close(); } catch { /* noop */ }
  videoDecoder = new VideoDecoder({ output: onVideoFrame, error: onVideoError });
  videoDecoder.configure(videoConfig);
  videoConfigured = true;
  videoDecoderBroken = false;
  videoErrorLogged = false;
  lastVideoIdx = -1;
}

function createAudioDecoder() {
  try { audioDecoder?.close(); } catch { /* noop */ }
  audioDecoder = new AudioDecoder({ output: onAudioData, error: onAudioError });
  audioConfigured = configureAudio(audioDecoder);
  audioDecoderBroken = false;
  lastAudioIdx = -1;
}

function ensureVideoDecoder() {
  if (!videoDecoder || videoDecoderBroken || !videoConfigured || videoDecoder.state === "closed") {
    try { createVideoDecoder(); }
    catch (e) {
      videoConfigured = false;
      videoDecoderBroken = true;
      console.warn("[decodeWorker] video decoder 重建失败：", String(e));
    }
  }
}

function ensureAudioDecoder() {
  if (!audioDecoder || audioDecoderBroken || !audioConfigured || audioDecoder.state === "closed") {
    try { createAudioDecoder(); }
    catch (e) {
      audioConfigured = false;
      audioDecoderBroken = true;
      console.warn("[decodeWorker] audio decoder 重建失败：", String(e));
    }
  }
}

function resetVideo() {
  // 重建或 reset 后，本段必须从关键帧起解。
  if (!videoDecoder || videoDecoderBroken || videoDecoder.state === "closed") {
    ensureVideoDecoder();
  } else {
    try {
      videoDecoder.reset();
      videoDecoder.configure(videoConfig);
      videoConfigured = true;
    } catch (e) {
      videoConfigured = false;
      videoDecoderBroken = true;
      console.warn("[decodeWorker] video reset 失败，将重建：", String(e));
    }
  }
  lastVideoIdx = -1;
}

function resetAudio() {
  // 每段独立解码：AAC 每样本都是 sync，无需关键帧前缀，也不依赖上一段状态。
  if (!audioDecoder || audioDecoderBroken || audioDecoder.state === "closed") {
    ensureAudioDecoder();
  } else {
    try {
      audioDecoder.reset();
      audioConfigured = configureAudio(audioDecoder);
    } catch (e) {
      audioConfigured = false;
      audioDecoderBroken = true;
      console.warn("[decodeWorker] audio reset 失败，将重建：", String(e));
    }
  }
  lastAudioIdx = -1;
}

// 处理一个严格的 5 秒窗口：一次（或几次）Range 只取该窗口样本的字节。
// 视频 decoder 保持连续（不 flush，否则 Chrome 会要求下一段以关键帧开头 → DataError）；
// 音频 AAC 每样本都是 sync，可安全 flush 后合成该段的 PCM 块。
async function decodeSegment(seg: number) {
  const t0 = seg * SEG_SECONDS;
  const t1 = t0 + SEG_SECONDS;
  const vi = { from: lowerBound(vSamples, t0), to: lowerBound(vSamples, t1) };
  const ai = { from: lowerBound(aSamples, t0), to: lowerBound(aSamples, t1) };
  allowedSegs.add(seg);
  while (allowedSegs.size > 8) {
    let oldest = Infinity;
    for (const s of allowedSegs) oldest = Math.min(oldest, s);
    allowedSegs.delete(oldest);
  }

  // 只有「上一段恰好解到本段起点前一帧」才能续解 delta 帧。
  // 同段重发 / seek 回退时若误判为可续解，会把段首 delta 帧喂给已解到段尾的 decoder，
  // 触发 EncodingError → codec 被关闭 → 之后所有 decode 都刷 InvalidStateError。
  const canContinue =
    !!videoDecoder && !!videoConfig && !videoDecoderBroken && videoConfigured &&
    videoDecoder.state === "configured" && lastVideoIdx === vi.from - 1;
  let vFrom = vi.from;
  if (!canContinue) {
    while (vFrom > 0 && !vSamples[vFrom].sync) vFrom--;
    if (!vSamples[vFrom]?.sync) {
      // 没找到更早的关键帧：从本段内第一个关键帧起，避免提交无参考帧的 delta。
      let k = vi.from;
      while (k < vi.to && !vSamples[k].sync) k++;
      vFrom = k < vi.to ? k : vi.to;
    }
    resetVideo();
  }
  const aFrom = ai.from;

  const needed: Sample[] = [];
  for (let i = vFrom; i < vi.to; i++) needed.push(vSamples[i]);
  for (let i = aFrom; i < ai.to; i++) needed.push(aSamples[i]);
  const bufs = needed.length > 0 ? await fetchSampleBytes(needed) : [];

  if (videoConfig && vi.to > vFrom) {
    ensureVideoDecoder();
    let failures = 0;
    for (let i = vFrom; i < vi.to && videoDecoder; i++) {
      const s = vSamples[i];
      const data = sliceSample(s, bufs);
      if (!data) continue;
      try {
        videoDecoder.decode(new EncodedVideoChunk({
          type: s.sync ? "key" : "delta",
          timestamp: s.t * 1e6,
          duration: s.dur * 1e6,
          data,
        }));
        lastVideoIdx = i;
      } catch (e) {
        // 一个样本失败就停喂本段并标记重建，不对 150 个样本逐条刷屏。
        if (failures++ === 0) console.warn("[decodeWorker] dec", String(e));
        videoDecoderBroken = true;
        videoConfigured = false;
        lastVideoIdx = -1;
        break;
      }
    }
    // 不调用 flush()：Chrome 在 flush 后要求下一段首帧为 key frame，
    // 连续播放时窗口首帧是 delta 帧，会抛 "A key frame is required"。
    // 用 decodeQueueSize 做背压，避免软件解码跟不上时无限堆积。
    if (videoDecoder && !videoDecoderBroken && videoDecoder.state === "configured") {
      for (let guard = 0; guard < 100 && videoDecoder.decodeQueueSize > 90; guard++) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  if (audioConfig && !audioDisabled && ai.to > aFrom) {
    audioCollect = [];
    audioCollectStart = aSamples[aFrom].t;
    // 每段独立解码：AAC 每样本都是 sync，无需关键帧前缀，也不依赖上一段状态；
    // 这样 seek / 段重发不会把 closed codec 一路带下去导致永久无声。
    resetAudio();
    ensureAudioDecoder();
    let failures = 0;
    for (let i = aFrom; i < ai.to && audioDecoder; i++) {
      const s = aSamples[i];
      const data = sliceSample(s, bufs);
      if (!data) continue;
      try {
        audioDecoder.decode(new EncodedAudioChunk({
          type: s.sync ? "key" : "delta",
          timestamp: s.t * 1e6,
          duration: s.dur * 1e6,
          data,
        }));
        lastAudioIdx = i;
      } catch (e) {
        if (failures++ === 0) console.warn("[decodeWorker] audio dec", String(e));
        audioDecoderBroken = true;
        audioConfigured = false;
        lastAudioIdx = -1;
        break;
      }
    }
    if (audioDecoder && !audioDecoderBroken && audioDecoder.state === "configured") {
      await audioDecoder.flush().catch((e) => {
        audioDecoderBroken = true;
        audioConfigured = false;
        console.warn("[decodeWorker] audio flush", String(e));
      });
    }
    emitAudioSegment(seg);
  }

  post({ type: "segmentDone", seg });
}

function emitAudioSegment(seg: number) {
  const chunks = audioCollect;
  audioCollect = null;
  if (!chunks || chunks.length === 0) return;
  const total = chunks.reduce((n, c) => n + (c[0]?.length || 0), 0);
  if (total === 0) return;
  const merged: Float32Array[] = Array.from(
    { length: audioCollectChannels },
    () => new Float32Array(total)
  );
  let off = 0;
  for (const c of chunks) {
    const n = c[0]?.length || 0;
    for (let ch = 0; ch < audioCollectChannels; ch++) {
      if (c[ch]) merged[ch].set(c[ch], off);
    }
    off += n;
  }
  // transfer 只接受 ArrayBuffer，传 Float32Array 视图会抛 DataCloneError → 无声。
  const buffers = merged.map((f) => f.buffer);
  post({
    type: "audioSegment",
    seg,
    start: audioCollectStart,
    rate: audioCollectRate,
    channels: audioCollectChannels,
    data: merged,
  }, buffers as unknown as Transferable[]);
}

function getVideoDescription(track: any, file: any): Uint8Array | null {
  try {
    const trak = file.getTrackById(track.id);
    const entries = trak?.mdia?.minf?.stbl?.stsd?.entries || [];
    for (const e of entries) {
      const box = e.avcC || e.hvcC || e.vpcC || e.av1C;
      if (box) {
        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
        box.write(stream);
        return new Uint8Array(stream.buffer, 8);
      }
    }
  } catch { /* noop */ }
  return null;
}

function getAudioDescription(track: any, file: any): Uint8Array | null {
  try {
    const trak = file.getTrackById(track.id);
    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const spec = entry?.esds?.esd?.descs?.[0]?.descs?.[0]?.specificInfo;
    if (spec) return spec instanceof Uint8Array ? spec : new Uint8Array(spec);
  } catch { /* noop */ }
  return null;
}
