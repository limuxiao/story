import type { Project } from "../types";

// 直连后端基准地址；不依赖 vite 代理，避免 dev/preview/静态托管下 /api 落到 SPA 兜底返回 HTML。
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) || "http://127.0.0.1:8000";

// 把后端返回的相对 /storage/... 路径补全为可跨域请求的完整 URL。
export function absUrl(path: string): string {
  if (!path) return path;
  if (/^https?:/i.test(path)) return path;
  return API_BASE.replace(/\/$/, "") + path;
}

// 预览不再整文件下载：把 /storage/mp4/<sid>/clip_<tag>.mp4 映射到支持 Range 的端点。
// 解码 Worker 用它按 5 秒窗口取字节；非本项目素材路径则原样直连。
export function rangeUrl(previewUrl: string): string {
  const m = previewUrl.match(/\/storage\/mp4\/([A-Za-z0-9_-]+)\/clip_(720|480)\.mp4/);
  if (!m) return absUrl(previewUrl);
  return `${API_BASE.replace(/\/$/, "")}/api/media/${m[1]}/${m[2]}`;
}

async function json(res: Response) {
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("接口未返回 JSON：" + text.slice(0, 120));
  }
}

// 后端字段为 snake_case(preview_url/original_url)，前端 Source 用 camelCase。
// 在数据入口统一归一化；契约再次漂移时立刻可见报错，不再退化为静默黑屏。
function normalizeSource(s: any) {
  if (!s || typeof s !== "object") return s;
  const previewUrl = s.previewUrl ?? s.preview_url;
  const originalUrl = s.originalUrl ?? s.original_url;
  if (!previewUrl) {
    throw new Error(
      `素材 ${s.id ?? "?"} 缺少 preview_url（后端字段：${Object.keys(s).join(",")}）`
    );
  }
  return { ...s, previewUrl, originalUrl };
}

export async function listSources(): Promise<any[]> {
  const arr = await json(await fetch(API_BASE + "/api/sources"));
  return Array.isArray(arr) ? arr.map(normalizeSource) : [];
}

export async function uploadFile(file: File): Promise<any> {
  const fd = new FormData();
  fd.append("file", file);
  return normalizeSource(await json(await fetch(API_BASE + "/api/upload", { method: "POST", body: fd })));
}

export async function exportProject(project: Project): Promise<{ url: string }> {
  return json(
    await fetch(API_BASE + "/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    })
  );
}

export async function aiCommand(text: string, clip: any): Promise<any> {
  return json(
    await fetch(API_BASE + "/api/ai/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, clip }),
    })
  );
}
