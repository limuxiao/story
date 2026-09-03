<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { api, type Analysis, type SubmissionBrief } from '@/api';
import { refreshAll, state, toast } from '@/stores/app';

const router = useRouter();
const items = ref<SubmissionBrief[]>([]);
const loading = ref(true);
const filter = ref<string>('all');
const keyword = ref('');

async function load() {
  loading.value = true;
  try {
    items.value = await api.submissions();
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const filtered = computed(() => {
  let list = items.value;
  if (filter.value === 'draft') list = list.filter((i) => i.status === 'draft');
  if (filter.value === 'done') list = list.filter((i) => i.status === 'done');
  if (keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase();
    list = list.filter(
      (i) =>
        (i.title || '').toLowerCase().includes(k) ||
        (i.module_id || '').toLowerCase().includes(k),
    );
  }
  return list;
});

const grouped = computed(() => {
  const map = new Map<string, SubmissionBrief[]>();
  filtered.value.forEach((i) => {
    if (!map.has(i.module_id)) map.set(i.module_id, []);
    map.get(i.module_id)?.push(i);
  });
  return [...map.entries()];
});

function moduleTitle(id: string) {
  const m = state.modules.find((x) => x.id === id);
  return m ? m.title : id;
}

function moduleIcon(id: string) {
  const m = state.modules.find((x) => x.id === id);
  return m?.icon || 'target';
}

function open(item: SubmissionBrief) {
  router.push(`/module/${item.module_id}?submission=${item.id}&tab=exercises`);
}

async function remove(item: SubmissionBrief) {
  if (!confirm(`确定删除《${item.title || '未命名练习'}》及其诊断记录？`)) return;
  await api.deleteSubmission(item.id);
  await load();
  await refreshAll();
  toast('已删除');
}

const totalWords = computed(() => filtered.value.reduce((a, b) => a + b.word_count, 0));
</script>

<template>
  <div class="page wide">
    <div class="head">
      <h1><Icon name="history" :size="20" /> 练习记录</h1>
      <p class="muted small">
        共 {{ filtered.length }} 篇 · 累计 <b class="num">{{ totalWords }}</b> 字。
        点任意一条可直接跳回该练习继续改。
      </p>
    </div>

    <div class="toolbar card">
      <div class="filters">
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ on: filter === 'draft' }" @click="filter = 'draft'">草稿</button>
        <button :class="{ on: filter === 'done' }" @click="filter = 'done'">已完成</button>
      </div>
      <input v-model="keyword" class="input search" placeholder="搜索标题…" />
    </div>

    <div v-if="loading" class="muted" style="padding: 40px; text-align: center">加载中…</div>

    <div v-else-if="!grouped.length" class="card empty">
      <p class="muted">还没有练习记录。挑一个环节开始写吧。</p>
      <button class="btn primary" @click="router.push('/plan')">去看学习计划</button>
    </div>

    <section v-for="[mid, list] in grouped" :key="mid" class="group">
      <h2>
        <Icon :name="moduleIcon(mid)" :size="15" />
        {{ moduleTitle(mid) }}
        <span class="tag">{{ list.length }} 篇</span>
      </h2>
      <div class="list card">
        <div v-for="i in list" :key="i.id" class="row">
          <button class="row-main" @click="open(i)">
            <strong>{{ i.title || '未命名练习' }}</strong>
            <span class="small muted num">{{ i.word_count }} 字</span>
            <span class="small muted">{{ i.updated_at.slice(0, 16).replace('T', ' ') }}</span>
            <span class="tag" :class="i.status === 'done' ? 'green' : ''">
              {{ i.status === 'done' ? '已完成' : '草稿' }}
            </span>
          </button>
          <button class="icon-btn" title="删除" @click="remove(i)">
            <Icon name="trash" :size="15" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 14px;
}
.head h1 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 20px;
  margin-bottom: 4px;
}
.head p b {
  color: var(--ink);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
}
.filters {
  display: flex;
  gap: 4px;
}
.filters button {
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--ink-mid);
}
.filters button.on {
  background: var(--accent-soft);
  border-color: #ecd4c8;
  color: var(--accent-deep);
  font-weight: 600;
}
.search {
  max-width: 240px;
  margin-left: auto;
}

.empty {
  padding: 60px 20px;
  text-align: center;
}
.empty p {
  margin-bottom: 14px;
}

.group {
  margin-bottom: 18px;
}
.group h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14.5px;
  margin-bottom: 8px;
}
.row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--line-soft);
}
.row:last-child {
  border-bottom: none;
}
.row-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  border: none;
  background: transparent;
  padding: 11px 16px;
  text-align: left;
  font-size: 13.5px;
  color: var(--ink);
}
.row-main:hover strong {
  color: var(--accent);
}
.row-main strong {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.icon-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: transparent;
  color: var(--ink-dim);
  display: flex;
  align-items: center;
  justify-content: center;
}
.icon-btn:hover {
  color: var(--red);
}
</style>
