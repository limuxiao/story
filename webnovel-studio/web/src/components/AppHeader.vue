<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from './Icon.vue';
import AiSettingsDialog from './AiSettingsDialog.vue';
import { state, refreshAll, toast } from '@/stores/app';
import { api } from '@/api';

const route = useRoute();
const router = useRouter();

const currentTitle = computed(() => {
  const id = route.params.id as string;
  if (route.name === 'module' && id) {
    const m = state.modules.find((x) => x.id === id);
    return m ? m.title : '练习';
  }
  const map: Record<string, string> = {
    dashboard: '学习总览',
    plan: '学习计划',
    works: '综合实战档案',
    history: '练习记录',
  };
  return map[route.name as string] || '';
});

const totalWords = computed(() => state.overview?.totals.words || 0);

async function exportBackup() {
  const data = await api.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  a.download = `网文写作台备份-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('备份已导出');
}

async function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!confirm('导入会覆盖当前所有练习数据，确定继续吗？')) return;
      await api.importAll(data);
      await refreshAll();
      toast('数据已导入');
      router.push('/');
    } catch (e: any) {
      toast('导入失败：文件格式不正确');
    }
  };
  input.click();
}
</script>

<template>
  <header class="app-header">
    <button
      class="icon-btn only-narrow"
      title="菜单"
      @click="state.navOpen = !state.navOpen"
    >
      <Icon name="menu" :size="19" />
    </button>

    <div class="brand" @click="router.push('/')">
      <span class="logo"><Icon name="sword" :size="17" /></span>
      <div class="brand-text">
        <strong>网文写作学习目标管理台</strong>
        <span class="muted small">分阶段 · 九环节 · 教程 + 练习 + AI 诊断</span>
      </div>
    </div>

    <nav class="top-nav">
      <RouterLink to="/" :class="{ on: route.name === 'dashboard' }">总览</RouterLink>
      <RouterLink to="/plan" :class="{ on: route.name === 'plan' }">学习计划</RouterLink>
      <RouterLink to="/works" :class="{ on: route.name === 'works' }">实战档案</RouterLink>
      <RouterLink to="/history" :class="{ on: route.name === 'history' }">练习记录</RouterLink>
    </nav>

    <div class="spacer" />

    <div class="metrics">
      <span class="metric"><i class="num">{{ totalWords }}</i> 累计字</span>
      <span class="metric"><i class="num">{{ state.overview?.totals.submissions || 0 }}</i> 篇练习</span>
      <span class="metric" v-if="state.overview?.totals.analyses">
        <i class="num">{{ state.overview?.totals.avgScore || 0 }}</i> 平均分
      </span>
    </div>

    <div
      class="ai-status"
      :class="state.aiEnabled ? 'on' : 'off'"
      :title="state.aiEnabled ? `已接入模型：${state.aiModel}` : '未配置，当前为本地规则诊断'"
    >
      <Icon name="sparkle" :size="14" />
      <span>{{ state.aiEnabled ? `AI 已接入 · ${state.aiModel}` : '本地诊断模式' }}</span>
    </div>

    <AiSettingsDialog />

    <button class="icon-btn" title="导出 JSON 备份" @click="exportBackup">
      <Icon name="download" :size="18" />
    </button>
    <button class="icon-btn" title="从备份恢复" @click="importBackup">
      <Icon name="upload" :size="18" />
    </button>
    <button
      class="icon-btn"
      :title="state.aiOpen ? '收起 AI 面板' : '展开 AI 面板'"
      @click="state.aiOpen = !state.aiOpen"
    >
      <Icon name="chat" :size="18" />
    </button>
  </header>
</template>

<style scoped>
.app-header {
  height: var(--header-h);
  flex: none;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  z-index: 30;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.logo {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text strong {
  font-size: 14.5px;
  letter-spacing: 0.3px;
}
.brand-text span {
  font-size: 11px;
}

.top-nav {
  display: flex;
  gap: 2px;
  margin-left: 18px;
}
.top-nav a {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ink-mid);
  transition: background 0.15s, color 0.15s;
}
.top-nav a:hover {
  background: var(--panel-soft);
  color: var(--ink);
}
.top-nav a.on {
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.metrics {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--ink-dim);
}
.metrics i {
  font-style: normal;
  font-weight: 700;
  color: var(--ink);
  font-size: 13px;
}

.ai-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid var(--line);
  max-width: 210px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ai-status.on {
  background: var(--green-soft);
  border-color: #cfe0c5;
  color: var(--green);
}
.ai-status.off {
  background: var(--amber-soft);
  border-color: #ecd9a6;
  color: var(--amber);
}

.icon-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 9px;
  color: var(--ink-mid);
  transition: all 0.15s;
}
.icon-btn:hover {
  background: var(--panel-soft);
  border-color: var(--line);
  color: var(--accent);
}

.only-narrow {
  display: none;
}

@media (max-width: 1280px) {
  .metrics .metric:nth-child(3) {
    display: none;
  }
}
@media (max-width: 1080px) {
  .metrics {
    display: none;
  }
}
@media (max-width: 900px) {
  .top-nav {
    display: none;
  }
  .brand-text span {
    display: none;
  }
  .ai-status span {
    display: none;
  }
  .ai-status {
    padding: 6px;
    max-width: none;
  }
  .only-narrow {
    display: flex;
  }
}
</style>
