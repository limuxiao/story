# AI 音视频剪辑 Demo 使用说明

> 本文件说明当前可运行的 Demo 能力、前后端技术方案、启动方式，以及在浏览器中如何监控内存/解码器使用情况。
> 整体架构与长期演进目标见同目录 `新形态AI音视频剪辑工具技术方案.html`。

---

## 1. 已实现能力（当前 Demo）

| 模块 | 能力 |
| --- | --- |
| 素材库（左） | 启动拉取「已上传过的素材」；支持「＋上传素材」按钮与拖文件上传；素材卡片作为拖拽源 |
| 预览区（右上） | PixiJS 合成引擎输出 canvas；播放/暂停、时间显示（hh:mm:ss.ff @25fps）、质量选择、**预览尺寸下拉**（1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9 / 9:21）、比例标注、带边框的黑框严格等比，不拉伸 |
| 时间轴（右下） | **多条轨道**支持堆叠（V1 在最上方、层级最高）；从素材库拖素材上轨；片段可拖动改时间位置、可跨轨移动；单击选中、`Delete` 删除；刻度尺点击 seek；红色播放头；缩放滑块 |
| 上传分析 | 上传时 `ffprobe` 分析**宽/高/时长**，结果随相对路径写入 **SQLite**（重启不丢），前端据此按素材原始宽高比 contain 预览 |
| 音频 | 预览可出声（用户点击播放按钮的手势内触发，满足浏览器自动播放策略）；片段离开可见区间自动静音 |
| 解码器扩展 | **活动窗口 + 按素材复用 HLS**：离屏 `<video>` 数量被钉死在播放头附近窗口内，不随片段总数线性增长（详见 §4.3） |

---

## 2. 目录结构

```
mediaEdit/
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── main.py         # 入口：upload / sources / export / ai 路由 + 静态托管
│   │   ├── config.py       # STORAGE / ORIGIN_DIR 等路径
│   │   ├── transcode.py    # ffmpeg 切片 + ffprobe 分析(probe)
│   │   ├── db.py           # SQLite 持久化（素材元数据）
│   │   ├── exporter.py     # 服务端导出（ffmpeg filter 链）
│   │   ├── ai_service.py   # mock 字幕 / 对话式编辑
│   │   └── schemas.py      # 工程 JSON schema
│   ├── storage/            # 运行时生成：origin/(原片) hls/(分片) meta.db(SQLite)
│   ├── venv/               # Python 虚拟环境
│   └── requirements.txt    # fastapi / uvicorn / python-multipart / pydantic
├── frontend/               # React + TypeScript + Vite
│   └── src/
│       ├── main.tsx, App.tsx
│       ├── api/client.ts          # listSources / uploadFile
│       ├── store/editor.ts        # Zustand 全局状态（sources/clips/播放/预览尺寸…）
│       ├── components/
│       │   ├── MediaLibrary.tsx    # 素材库
│       │   ├── Preview.tsx         # 预览区（合成引擎输出 canvas）
│       │   └── Timeline.tsx        # 多轨时间轴
│       ├── engine/Compositor.ts    # PixiJS 合成引擎（隐藏 video→纹理→canvas）
│       └── utils/time.ts           # hh:mm:ss.ff 格式化
└── doc/
    ├── 新形态AI音视频剪辑工具技术方案.html
    └── DEMO使用说明.md
```

---

## 3. 前端技术方案

- **框架**：React 18 + TypeScript + Vite 5。
- **状态**：Zustand（`store/editor.ts`）集中管理 `sources / clips / playing / time / duration / previewAspect / pxPerSec` 等。
- **合成引擎**：`engine/Compositor.ts`（对应方案 3.2 / 4.2 / 第 5 章「模式 B 全帧合成」）
  - 隐藏 `<video>` 经 **hls.js** 解码 → 每帧把当前帧 `texImage2D` 上传为 WebGL 纹理 → PixiJS v8 场景图（图层栈 + `zIndex` 排序）输出到屏幕 canvas。
  - 早期过渡用 `<video>` + drawImage 思路，长期演进为 **WebCodecs 在 Worker 精确解码**（方案 4.2）。
- **预览尺寸**：外层黑框用 `ResizeObserver` 按容器像素 + 所选宽高比算出严格等比尺寸（绕开 CSS `aspect-ratio` 在双向约束下失效的问题），画布分辨率按预览比例换算。
- **性能隔离**：`time` 订阅下沉到极小的 `TimeReadout` / `Playhead` 子组件，避免播放时主组件 60fps 重建。

### 3.1 关键数据流

```
拖素材到轨道 → addClipFromSource（记录 srcIn/srcOut/timelineStart/track/原始宽高）
            → store.clips 更新
            → Compositor.sync(clips) 记录全量片段
播放主时钟(rAF) → setTime → Compositor.update(time, playing)
            → 仅活动窗口内片段创建图层 / 定位 / seek / 上传纹理 / 控制播放
```

---

## 4. 后端技术方案

- **框架**：FastAPI + uvicorn，`app.main:app`。
- **上传链路**（`POST /api/upload`）：
  1. 保存原片到 `storage/origin/{id}_{name}`；
  2. `transcode.probe()` 用 **ffprobe** 取 `width / height / duration`；
  3. `transcode.slice_to_hls()` 用 **ffmpeg** 切 HLS（`storage/hls/{id}/index.m3u8`）；
  4. 元数据（含 `relative_path`）写入 **SQLite**（`db.py`，库文件 `storage/meta.db`），重启不丢。
- **素材列表**（`GET /api/sources`）：从数据库读取。
- **静态托管**：`/storage/*` 由 `StaticFiles` 直接供给 hls.js 拉取分片。
- **其它预留路由**（当前为 mock / 服务端能力）：`POST /api/export`（ffmpeg 导出）、`POST /api/ai/captions`、`POST /api/ai/command`。

---

## 5. 解码层：彻底无 `<video>` 元素（WebCodecs 终态）

直接回答一个常见问题：**「每个片段一个离屏 `<video>`，片段很多时岂不是很多 video？」**

本 Demo **已完全去掉 `<video>` / `<audio>` 元素**，解码层就是技术方案文档 4.2 / 5.2 / 7.2 规定的**终态**：用 **WebCodecs** 在浏览器内精确解码。

### 5.1 数据流（无 media 元素）
```
后端 ffmpeg 生成单文件 MP4(H.264+AAC, /storage/mp4/{id}/clip.mp4)
   ↓  fetch
前端 mp4box 解封装 → 得到编码样本(EncodedVideoChunk / EncodedAudioChunk)
   ↓
VideoDecoder.decode() → VideoFrame（视频）           AudioDecoder.decode() → AudioData（音频）
   ↓                                                   ↓
帧按源时间缓存；渲染时取 srcIn+local 处最近帧         拼成 AudioBuffer → Web Audio 播放
   ↓
VideoFrame → 离屏 <canvas>（非 <video>）→ PixiJS 纹理 → 场景图输出
```
全程不创建任何 `<video>` 或 `<audio>` 元素，因此**根本不存在「离屏 video 数量爆炸」**这一卡顿源（7.1 头号卡顿源被消除）。

### 5.2 解码层设计（`engine/Mp4Source.ts` + `engine/Compositor.ts`）
- **按素材(sourceId)建解码源池**：每个素材只 `fetch` + 解封装 + 解码**一次**，多 clip 复用同一份帧缓存；同一素材切出的多段不再重复下载/解码。
- **帧按时间索引缓存**：`Mp4Source` 把所有视频帧缓存并按源时间排序，渲染时 `getFrameAt(srcIn+local)` 二分取最近帧——**同一素材多轨重叠也能各自取各自时间的帧**，互不干扰（这正是早期 `<video>` 方案出 bug 的场景）。
- **活动窗口图层**：播放头附近 `[t-2s, t+6s]` 的 clip 才建 PixiJS 图层（`MAX_LAYERS=8` 兜底），出窗即回收纹理/离屏 canvas，常驻图层数被钉死在窗口内。
- **音频走 Web Audio**：`AudioDecoder` 解码全量音频 → 拼成 `AudioBuffer`，播放时在用户手势内 `resume()` AudioContext 并从对应源时间 `start()`；seek 跳变（>0.3s）自动重启音频以大致对齐音视频。
- **出声策略**：浏览器自动播放策略要求用户手势，`Compositor.play()` 由「播放」按钮点击同步触发，内部 `audioCtx.resume()`。

### 5.3 浏览器兼容与已知边界
- **WebCodecs** 在 Chrome/Edge 完善；Safari 16.4+/Firefox 较新版本部分支持。不支持时 `Mp4Source.load()` 会明确抛错（控制台可见），需换用支持浏览器。
- **AAC 音频 description**：`AudioDecoder` 配置 AAC 一般需 `AudioSpecificConfig`；代码尽力从 `esds` 提取，提取不到则优雅跳过音频（视频仍正常）。若某些素材无声，多为该原因，可在后端转码时强制写入或后续补 description 提取。
- 当前为**全量解码**（短素材友好）；超长素材可后续改为「窗口化流式解码 + 预解码未来 1–2 秒」（7.2 规定的进阶形态）。

---

## 6. 启动指令

### 6.1 后端（端口 8000）

```bash
cd backend
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt   # 首次或依赖变更时
uvicorn app.main:app --reload --port 8000
```

启动后：
- API：`http://localhost:8000/api/sources`
- 分片：`http://localhost:8000/storage/hls/{id}/index.m3u8`

### 6.2 前端（端口 5173）

```bash
cd frontend
npm install        # 首次
npm run dev        # Vite 默认 5173
```

> `vite.config.ts` 已配置代理：`/api` 与 `/storage` → `http://127.0.0.1:8000`（`127.0.0.1` 而非 `localhost`，规避 Node 把 localhost 解析成 IPv6 `::1` 而后端只监听 IPv4 导致代理 500）。
> `optimizeDeps.include` 已显式加入 `pixi.js`、`hls.js`，避免刷新时临时预构建卡 loading。

### 6.3 使用流程

1. 浏览器打开 `http://localhost:5173`，**硬刷新**（Cmd/Ctrl+Shift+R）确保加载新代码；
2. 左侧「＋上传素材」或拖视频进素材库（上传后会分析宽高/时长）；
3. 把素材卡片拖到右下某条轨道 → 出现蓝色片段；
4. 右上选「预览尺寸」，点 `▶ 播放` 预览（可出声）；拖动片段改位置、跨轨；删除用 `Delete`。

---

## 7. 在浏览器中监控内存 / 解码器使用

核心目的：验证「活动窗口」是否真的把离屏 video 数量钉死在窗口内，而不是随片段数增长。

### 7.1 Performance Monitor（最直观，推荐）
DevTools → 右上角 `⋮` → **More tools → Performance Monitor**：实时看
- **JS heap size**（JS 堆）
- **DOM Nodes**（DOM 节点总数）
- **JS event listeners**
- **GPU memory**（显存占用）

> 操作验证：在轨道上放 20 个片段，拖动播放头从头扫到尾，观察 `DOM Nodes` 是否平稳（说明离屏 video 在被回收），而非一路飙升。

### 7.2 Memory 面板（看对象类型与泄漏）
DevTools → **Memory** → 选 **Heap snapshot** → 拍快照：
- 搜索 `HTMLVideoElement`：数量应 ≈ 当前窗口内片段数（而非工程总片段数）；
- 搜索 `Detached HTMLVideoElement`：若大量增长且不回收，说明有泄漏（正常应在离开窗口后被销毁）；
- 搜索 `PixiJS` / `Texture`：确认纹理随图层回收而释放。

### 7.3 Performance 面板（看帧率/卡顿）
DevTools → **Performance** → 点录制，播放并拖动播放头：
- 看 FPS 与「长任务（Long task）」；若多路解码导致掉帧，对应方案 7.2 的降级（代理分辨率、限制解码路数、跳帧）即在此观测。

### 7.4 任务管理器
浏览器 `Shift+Esc`（Chrome）→ 看每个标签页的**内存占用**与 **GPU 进程内存**；对比「播放中」与「空闲」差异，可定位解码器是否过多。

### 7.5 控制台快速探针
```js
// 实时统计页面内 video 元素数量（含离屏）
setInterval(() => console.log('video 元素数:', document.querySelectorAll('video').length), 1000);
```
正常应稳定在「窗口内片段数 + 1~2」附近波动，不会随总片段数线性增长。

---

## 8. 已知限制 / 后续方向

- **同屏多段同素材且时间重叠**：当前每个片段独立 `<video>`，窗口内会各自解码（正确但非共享），长期由 WebCodecs 统一解码。
- **混音**：当前为「谁在可见区间谁出声」，未做音频混音/音量包络。
- **转场 / 特效**：方案要求 shader 多 pass，当前 Demo 仅做图层合成与 contain 适配。
- **导出**：后端 `/api/export` 已具备 ffmpeg 能力，前端导出按钮待接。
- **Clip 裁剪**：拖动片段两端改 `srcIn/srcOut` 尚未实现。
```
