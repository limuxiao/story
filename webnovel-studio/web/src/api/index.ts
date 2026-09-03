const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`请求失败 ${res.status}：${path}`);
  }
  return (await res.json()) as T;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: any) =>
  request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(p: string, body?: any) =>
  request<T>(p, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' });

export interface Overview {
  stages: StageItem[];
  totals: {
    words: number;
    submissions: number;
    analyses: number;
    avgScore: number;
    lessonsDone: number;
    lessonCount: number;
    exerciseCount: number;
    works: number;
  };
  todo: TodoItem[];
  today: { words: number; submissions: number; analyses: number };
  heatmap: { day: string; words: number; submissions: number; analyses: number }[];
  recent: {
    id: number;
    title: string;
    module_id: string;
    module_title: string;
    word_count: number;
    updated_at: string;
  }[];
  recentAnalyses: {
    id: number;
    submission_id: number;
    module_id: string;
    score: number;
    verdict: string;
    created_at: string;
    source: string;
    submission_title: string;
  }[];
  currentStage: StageItem | null;
}

export interface StageItem {
  id: number;
  name: string;
  subtitle: string;
  weeks: string;
  goal: string;
  focus: string;
  sortOrder: number;
  moduleIds: string[];
  modules: ModuleStat[];
  status: string;
  progress: number;
}

export interface ModuleStat {
  id: string;
  title: string;
  subtitle: string;
  stage: number;
  icon: string;
  goal: string;
  lessonCount: number;
  lessonsDone: number;
  exerciseCount: number;
  doneExercises: number;
  words: number;
  avgScore: number;
  status: string;
  progress: number;
}

export interface TodoItem {
  type: string;
  level: string;
  title: string;
  desc: string;
  link: string;
}

export interface ModuleDetail {
  id: string;
  title: string;
  subtitle: string;
  stage: number;
  goal: string;
  overview: string;
  checklist: string[];
  dimensions: string[];
  target_words: number;
  icon: string;
  lessonCount: number;
  exerciseCount: number;
  lessonsDone: number;
  submissionCount: number;
  words: number;
  doneExercises: number;
  avgScore: number;
  status: string;
  progress: number;
  lessons: Lesson[];
  exercises: Exercise[];
  submissions: SubmissionBrief[];
}

export interface Lesson {
  id: string;
  module_id: string;
  sort_order: number;
  title: string;
  summary: string;
  body: string;
  paragraphs: string[];
  keypoints: string[];
  pitfalls: string[];
  drill: string;
  read_minutes: number;
  done: boolean;
}

export interface Exercise {
  id: string;
  module_id: string;
  sort_order: number;
  title: string;
  prompt: string;
  requirements: string[];
  min_words: number;
  reference: string;
  rubric: string[];
  submissionCount: number;
  latestSubmissionId: number | null;
  completed: boolean;
}

export interface SubmissionBrief {
  id: number;
  module_id: string;
  exercise_id: string | null;
  title: string;
  word_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Submission {
  id: number;
  module_id: string;
  exercise_id: string | null;
  title: string;
  content: string;
  word_count: number;
  self_note: string;
  status: string;
  created_at: string;
  updated_at: string;
  analyses?: Analysis[];
}

export interface Analysis {
  id: number;
  submission_id: number;
  module_id: string;
  score: number;
  verdict: string;
  dimensions: { name: string; score: number; comment: string }[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  rewrite: string;
  source: string;
  stats: Record<string, number>;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

export interface Work {
  id: number;
  name: string;
  genre: string;
  liyi: string;
  zhuti: string;
  genggai: string;
  shijieguan: string;
  renwu: string;
  juqing: string;
  fenjuan: string;
  wenti: string;
  created_at: string;
  updated_at: string;
}

export const api = {
  health: () => get<{ ok: boolean; aiEnabled: boolean; model: string | null }>('/health'),

  overview: () => get<Overview>('/overview'),
  stages: () => get<any[]>('/stages'),
  modules: () => get<ModuleStat[]>('/modules'),
  moduleDetail: (id: string) => get<ModuleDetail>(`/modules/${id}`),
  exercises: (moduleId?: string) =>
    get<Exercise[]>(moduleId ? `/exercises?moduleId=${moduleId}` : '/exercises'),

  submissions: (params: { moduleId?: string; exerciseId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.moduleId) q.set('moduleId', params.moduleId);
    if (params.exerciseId) q.set('exerciseId', params.exerciseId);
    const s = q.toString();
    return get<SubmissionBrief[]>(`/submissions${s ? '?' + s : ''}`);
  },
  submission: (id: number) => get<Submission>(`/submissions/${id}`),
  createSubmission: (body: any) => post<{ id: number }>('/submissions', body),
  updateSubmission: (id: number, body: any) =>
    put<{ ok: boolean; wordCount: number }>(`/submissions/${id}`, body),
  deleteSubmission: (id: number) => del<{ ok: boolean }>(`/submissions/${id}`),
  analyze: (id: number) => post<Analysis>(`/submissions/${id}/analyze`),
  analyses: (params: { submissionId?: number; moduleId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.submissionId) q.set('submissionId', String(params.submissionId));
    if (params.moduleId) q.set('moduleId', params.moduleId);
    const s = q.toString();
    return get<Analysis[]>(`/analyses${s ? '?' + s : ''}`);
  },
  deleteAnalysis: (id: number) => del<{ ok: boolean }>(`/analyses/${id}`),

  lessonProgress: (body: { moduleId: string; lessonId: string; done: boolean }) =>
    put<{ ok: boolean }>('/lesson-progress', body),

  chatHistory: (moduleId?: string) =>
    get<ChatMessage[]>(moduleId ? `/chat?moduleId=${moduleId}` : '/chat'),
  chat: (body: { moduleId?: string; message: string; context?: string }) =>
    post<{ role: string; content: string; source: string }>('/chat', body),
  clearChat: (moduleId?: string) =>
    del<{ ok: boolean }>(moduleId ? `/chat?moduleId=${moduleId}` : '/chat'),

  works: () => get<Work[]>('/works'),
  work: (id: number) => get<Work>(`/works/${id}`),
  createWork: (body: any) => post<{ id: number }>('/works', body),
  updateWork: (id: number, body: any) => put<{ ok: boolean }>(`/works/${id}`, body),
  deleteWork: (id: number) => del<{ ok: boolean }>(`/works/${id}`),
  analyzeWork: (id: number) => post<any>(`/works/${id}/analyze`),

  aiSettings: () =>
    get<{ enabled: boolean; baseUrl: string; model: string; hasKey: boolean }>(
      '/settings/ai',
    ),
  saveAiSettings: (body: any) => put<any>('/settings/ai', body),

  exportAll: () => get<any>('/export'),
  importAll: (data: any) => post<{ ok: boolean }>('/import', data),
  reset: () => post<{ ok: boolean }>('/danger/reset'),
};
