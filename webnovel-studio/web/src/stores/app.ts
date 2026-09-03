import { reactive } from 'vue';
import { api, type ModuleStat, type Overview } from '@/api';

export const state = reactive({
  overview: null as Overview | null,
  modules: [] as ModuleStat[],
  stages: [] as any[],
  aiEnabled: false,
  aiModel: '' as string | null,
  booted: false,
  error: '',
  navOpen: false,
  aiOpen: true,
  toast: '' as string,
});

let toastTimer: number | undefined;

export function toast(msg: string) {
  state.toast = msg;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (state.toast = ''), 2400);
}

/** 统一刷新入口：只允许"交互 → 改数据 → refreshAll"，各渲染逻辑独立读取最新数据 */
export async function refreshAll() {
  try {
    const [overview, modules, health] = await Promise.all([
      api.overview(),
      api.modules(),
      api.health(),
    ]);
    state.overview = overview;
    state.modules = modules;
    state.stages = overview.stages;
    state.aiEnabled = health.aiEnabled;
    state.aiModel = health.model;
    state.error = '';
  } catch (e: any) {
    state.error = e?.message || '无法连接后端服务';
    throw e;
  }
}

export async function bootstrap() {
  await refreshAll();
  state.booted = true;
}

export function moduleById(id: string) {
  return state.modules.find((m) => m.id === id) || null;
}
