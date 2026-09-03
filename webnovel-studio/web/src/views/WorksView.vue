<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import AnalysisCard from '@/components/AnalysisCard.vue';
import { api, type Analysis, type Work } from '@/api';
import { refreshAll, toast } from '@/stores/app';

const route = useRoute();
const router = useRouter();

const FIELDS: { key: keyof Work; label: string; hint: string; rows: number; ph: string }[] = [
  { key: 'name', label: '书名', hint: '先随便起一个，写到最后你才知道它该叫什么', rows: 1, ph: '例如：我只是个小怪，凭什么爆史诗' },
  { key: 'genre', label: '类型 / 题材', hint: '玄幻、都市、无限流……', rows: 1, ph: '例如：玄幻 / 复仇 / 轻松' },
  { key: 'liyi', label: '立意', hint: '这本书想表达的最根本的一句话', rows: 4, ph: '这本书为什么值得写？它要戳中读者心里的什么？' },
  { key: 'zhuti', label: '主题', hint: '贯穿全书的核心命题', rows: 3, ph: '例如：身份认同 / 小人物的尊严 / 代价与成长……' },
  { key: 'genggai', label: '一句话梗概', hint: '一句话讲清整个故事', rows: 3, ph: '谁，在什么处境，要做什么，最大的阻碍是什么？' },
  { key: 'shijieguan', label: '世界观设定', hint: '世界规则、地理格局、力量体系、底层法则', rows: 8, ph: '这个世界运转的铁律是什么？什么东西最稀缺？得到它要付什么代价？' },
  { key: 'renwu', label: '人物简介和背景', hint: '主角、配角、反派：来历、动机、关系', rows: 8, ph: '每个重要人物：他是谁？他要什么？他怕什么？他为什么非这样不可？' },
  { key: 'juqing', label: '剧情总纲', hint: '从头到尾的完整故事线', rows: 8, ph: '开端 → 发展 → 转折 → 高潮 → 结局，整条因果链写清楚。' },
  { key: 'fenjuan', label: '分卷大纲', hint: '逐卷拆分，每卷的目标与钩子', rows: 8, ph: '卷一：……（卷末钩子：……）\n卷二：……' },
  { key: 'wenti', label: '当前问题', hint: '写清楚你卡在哪，AI 才能帮你解决', rows: 4, ph: '例如：第二卷中段节奏拖沓；反派动机立不住；某个反转缺乏伏笔……' },
];

const works = ref<Work[]>([]);
const current = ref<Work | null>(null);
const analyses = ref<Analysis[]>([]);
const analyzing = ref(false);
const saving = ref(false);
const lastSaved = ref('');
let timer: number | undefined;

const filledCount = computed(() => {
  if (!current.value) return 0;
  return FIELDS.filter(
    (f) => f.key !== 'name' && f.key !== 'genre' && String(current.value?.[f.key] || '').trim().length >= 20,
  ).length;
});

const totalWords = computed(() => {
  if (!current.value) return 0;
  return FIELDS.reduce((sum, f) => {
    const v = String(current.value?.[f.key] || '');
    return sum + (v.match(/[\u4e00-\u9fa5]/g) || []).length;
  }, 0);
});

async function loadList() {
  works.value = await api.works();
  const rid = route.params.id ? Number(route.params.id) : null;
  if (rid) {
    current.value = await api.work(rid);
  } else if (works.value.length && !current.value) {
    current.value = await api.work(works.value[0].id);
  }
  if (current.value) {
    analyses.value = [];
    setContext();
  }
}

onMounted(loadList);

function setContext() {
  (window as any).__AI_CONTEXT__ = current.value
    ? FIELDS.map((f) => `【${f.label}】${current.value?.[f.key] || '（空白）'}`).join('\n')
    : '';
}

watch(current, () => setContext());

function scheduleSave() {
  if (!current.value) return;
  lastSaved.value = '编辑中…';
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(persist, 1200);
}

async function persist() {
  if (!current.value) return;
  saving.value = true;
  try {
    await api.updateWork(current.value.id, current.value as any);
    const d = new Date();
    const p = (n: number) => (n < 10 ? '0' : '') + n;
    lastSaved.value = `已保存 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    setContext();
    await refreshAll();
  } catch {
    lastSaved.value = '保存失败';
  } finally {
    saving.value = false;
  }
}

async function selectWork(id: number) {
  if (timer) window.clearTimeout(timer);
  await persist();
  current.value = await api.work(id);
  analyses.value = [];
  router.push(`/works/${id}`);
}

async function createWork() {
  const res = await api.createWork({ name: '未命名作品' });
  await loadList();
  current.value = await api.work(res.id);
  analyses.value = [];
  router.push(`/works/${res.id}`);
  toast('已新建作品档案');
}

async function removeWork() {
  if (!current.value) return;
  if (!confirm(`确定删除《${current.value.name || '未命名作品'}》？此操作不可恢复。`)) return;
  await api.deleteWork(current.value.id);
  current.value = null;
  await loadList();
  if (works.value.length) {
    current.value = await api.work(works.value[0].id);
  }
  toast('已删除');
}

async function analyze() {
  if (!current.value) return;
  if (filledCount.value < 3) {
    toast('至少填 3 个核心格子再诊断');
    return;
  }
  analyzing.value = true;
  try {
    await persist();
    const res = await api.analyzeWork(current.value.id);
    const full = await api.analyses({ moduleId: 'practice' });
    analyses.value = full.filter((a) => a.submission_id === 0).slice(0, 3) as Analysis[];
    if (!analyses.value.length) {
      analyses.value = [{ ...res } as Analysis];
    }
    toast('诊断完成');
  } catch (e: any) {
    toast('诊断失败：' + (e?.message || '未知错误'));
  } finally {
    analyzing.value = false;
  }
}
</script>

<template>
  <div class="page wide">
    <div class="head">
      <h1><Icon name="sword" :size="20" /> 综合实战 · 九宫格作品档案</h1>
      <p class="muted small">
        九格填满，一本书的骨架就立起来了。九格之间有矛盾的地方，就是你真正需要解决的问题。
        内容自动保存在本机 SQLite。
      </p>
    </div>

    <div class="layout">
      <!-- 作品列表 -->
      <aside class="works card">
        <div class="card-head">
          <Icon name="book" :size="15" />
          <h3>我的作品</h3>
          <div class="spacer" />
          <button class="btn sm primary" @click="createWork">
            <Icon name="plus" :size="13" /> 新建
          </button>
        </div>
        <div class="card-body">
          <button
            v-for="w in works"
            :key="w.id"
            class="work-item"
            :class="{ on: current?.id === w.id }"
            @click="selectWork(w.id)"
          >
            <strong>{{ w.name || '未命名作品' }}</strong>
            <span class="small muted">{{ w.genre || '未分类' }}</span>
            <span class="small muted">{{ w.updated_at.slice(5, 10) }}</span>
          </button>
          <div v-if="!works.length" class="small muted" style="text-align: center; padding: 20px 0">
            还没有作品
          </div>
        </div>
      </aside>

      <!-- 九宫格 -->
      <div class="main-col">
        <template v-if="current">
          <div class="toolbar card">
            <span class="save small" :class="{ ok: lastSaved.startsWith('已保存') }">{{ lastSaved }}</span>
            <span class="tag">已填 {{ filledCount }}/8 格</span>
            <span class="tag">共 <b class="num">{{ totalWords }}</b> 字</span>
            <div class="spacer" />
            <button class="btn danger" @click="removeWork">
              <Icon name="trash" :size="14" /> 删除本书
            </button>
            <button class="btn primary" :disabled="analyzing" @click="analyze">
              <Icon name="sparkle" :size="15" />
              {{ analyzing ? '诊断中…' : '整体诊断这份档案' }}
            </button>
          </div>

          <div class="grid">
            <div
              v-for="f in FIELDS"
              :key="f.key"
              class="cell card"
              :class="{ wide: f.rows >= 6 }"
            >
              <div class="cell-head">
                <label>{{ f.label }}</label>
                <span class="hint small muted">{{ f.hint }}</span>
                <span class="count small muted num">
                  {{ String(current[f.key] || '').replace(/\s/g, '').length }} 字
                </span>
              </div>
              <textarea
                v-if="f.rows > 1"
                v-model="current[f.key]"
                class="textarea"
                :rows="f.rows"
                :placeholder="f.ph"
                @input="scheduleSave"
              />
              <input
                v-else
                v-model="current[f.key]"
                class="input"
                :placeholder="f.ph"
                @input="scheduleSave"
              />
            </div>
          </div>

          <div v-if="analyses.length" class="reports">
            <AnalysisCard v-for="a in analyses" :key="a.id" :analysis="a" />
          </div>

          <div class="tip card">
            <div class="card-body small">
              <strong>填表顺序建议：</strong>
              立意 → 一句话梗概 → 人物 → 世界观 → 剧情总纲 → 分卷大纲 → 书名 → 主题 → 当前问题。
              书名和主题放最后，因为写到最后你才知道这本书到底在讲什么。
            </div>
          </div>
        </template>

        <div v-else class="card empty-state">
          <Icon name="book" :size="30" />
          <p>还没有作品档案，点左上角「新建」开始搭第一本书。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 16px;
}
.head h1 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 20px;
  margin-bottom: 4px;
}

.layout {
  display: grid;
  grid-template-columns: 232px 1fr;
  gap: 16px;
  align-items: start;
}
.works {
  position: sticky;
  top: 0;
}
.work-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: var(--panel-soft);
  border-radius: var(--radius-sm);
  padding: 9px 11px;
  margin-bottom: 6px;
  gap: 1px;
}
.work-item:hover {
  border-color: var(--line);
}
.work-item.on {
  background: var(--accent-soft);
  border-color: #ecd4c8;
}
.work-item strong {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.save {
  color: var(--ink-dim);
  font-size: 11.5px;
}
.save.ok {
  color: var(--green);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.cell {
  padding: 13px 15px 15px;
}
.cell.wide {
  grid-column: span 2;
}
.cell-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
}
.cell-head label {
  font-size: 13.5px;
  font-weight: 700;
}
.cell-head .hint {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell .textarea {
  min-height: 90px;
  line-height: 1.85;
}

.reports {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tip {
  margin-top: 14px;
  background: var(--panel-soft);
}
.tip .card-body {
  color: var(--ink-mid);
  line-height: 1.9;
}
.empty-state {
  padding: 70px 20px;
  text-align: center;
  color: var(--ink-dim);
}
.empty-state p {
  margin-top: 10px;
  font-size: 13.5px;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .works {
    position: static;
  }
  .grid {
    grid-template-columns: 1fr;
  }
  .cell.wide {
    grid-column: span 1;
  }
}
</style>
