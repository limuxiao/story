import type { Project, ProjectDoc, ProjectPayload, ProjectSummary } from "../types";

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

// 时间轴 filmstrip：后端每秒抽一张，0001.jpg 对应源时间 0 秒。
// 编号 = floor(源秒数) + 1，文件内容不变，交给浏览器 immutable 缓存。
export function thumbUrl(sid: string, n: number): string {
  return `${API_BASE.replace(/\/$/, "")}/api/thumb/${sid}/${String(n).padStart(4, "0")}`;
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

// ---- 工程（后端以 project.xml 持久化） ----

const projectUrl = (id: string) => `${API_BASE}/api/projects/${encodeURIComponent(id)}`;
const jsonBody = (payload: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export async function listProjects(): Promise<ProjectSummary[]> {
  const arr = await json(await fetch(API_BASE + "/api/projects"));
  return Array.isArray(arr) ? arr : [];
}

export async function createProject(name: string): Promise<ProjectDoc> {
  return json(await fetch(API_BASE + "/api/projects", jsonBody({ name })));
}

export async function getProject(id: string): Promise<ProjectDoc> {
  return json(await fetch(projectUrl(id)));
}

// 只提交工程内容；项目名由 renameProject 单独维护。
export async function saveProject(id: string, project: ProjectPayload): Promise<ProjectDoc> {
  return json(await fetch(projectUrl(id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  }));
}

export async function renameProject(id: string, name: string): Promise<ProjectDoc> {
  return json(await fetch(projectUrl(id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }));
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(projectUrl(id), { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} 删除失败`);
}

export async function getProjectXml(id: string): Promise<string> {
  const res = await fetch(projectUrl(id) + "/xml");
  if (!res.ok) throw new Error(`${res.status} 读取 XML 失败`);
  return res.text();
}
