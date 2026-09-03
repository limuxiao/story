<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import AnalysisCard from './AnalysisCard.vue';
import { api, type Analysis, type Exercise, type Submission } from '@/api';
import { state, refreshAll, toast } from '@/stores/app';

const props = defineProps<{
  moduleId: string;
  moduleTitle: string;
  exercise: Exercise;
  submissionId?: number | null;
}>();

const emit = defineEmits<{ (e: 'changed'): void }>();

const title = ref('');
const content = ref('');
const selfNote = ref('');
const status = ref<'draft' | 'done'>('draft');
const id = ref<number | null>(null);
const analyses = ref<Analysis[]>([]);
const analyzing = ref(false);
const saving = ref(false);
const lastSaved = ref('');
let saveTimer: number | undefined;

const wordCount = computed(() => {
  const cjk = (content.value.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (content.value.match(/[A-Za-z]+/g) || []).length;
  return cjk + en;
});

const enough = computed(() => wordCount.value >= props.exercise.min_words);

/** 供右侧 AI 面板读取当前草稿 */
watch([content, title], () => {
  (window as any).__AI_CONTEXT__ =
    `【练习题】${props.exercise.title}\n【题目要求】${props.exercise.prompt}\n【我的草稿】\n${content.value}`;
});

async function load() {
  if (props.submissionId) {
    const s = await api.submission(props.submissionId);
    id.value = s.id;
    title.value = s.title || '';
    content.value = s.content || '';
    selfNote.value = s.self_note || '';
    status.value = (s.status as any) || 'draft';
    analyses.value = s.analyses || [];
  } else {
    id.value = null;
    title.value = '';
    content.value = '';
    selfNote.value = '';
    status.value = 'draft';
    analyses.value = [];
  }
  (window as any).__AI_CONTEXT__ =
    `【练习题】${props.exercise.title}\n【题目要求】${props.exercise.prompt}`;
}

onMounted(load);
watch(() => props.submissionId, load);
watch(() => props.exercise.id, load);

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer);
  lastSaved.value = '编辑中…';
  saveTimer = window.setTimeout(() => persist(), 1200);
}

async function persist() {
  if (!content.value.trim() && !title.value.trim()) return;
  saving.value = true;
  try {
    if (id.value) {
      await api.updateSubmission(id.value, {
        moduleId: props.moduleId,
        exerciseId: props.exercise.id,
        title: title.value,
        content: content.value,
        selfNote: selfNote.value,
        status: status.value,
      });
    } else {
      const res = await api.createSubmission({
        moduleId: props.moduleId,
        exerciseId: props.exercise.id,
        title: title.value,
        content: content.value,
        selfNote: selfNote.value,
        status: status.value,
      });
      id.value = res.id;
    }
    const d = new Date();
    const p = (n: number) => (n < 10 ? '0' : '') + n;
    lastSaved.value = `已保存 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    emit('changed');
    await refreshAll();
  } catch {
    lastSaved.value = '保存失败';
  } finally {
    saving.value = false;
  }
}

async function toggleDone() {
  status.value = status.value === 'done' ? 'draft' : 'done';
  await persist();
  toast(status.value === 'done' ? '已标记完成' : '已改回草稿');
}

async function analyze() {
  if (!content.value.trim()) {
    toast('先写点内容再诊断');
    return;
  }
  analyzing.value = true;
  try {
    await persist();
    const res = await api.analyze(id.value as number);
    const full = await api.submission(id.value as number);
    analyses.value = full.analyses || [];
    emit('changed');
    await refreshAll();
    if (res.source === 'local' && !state.aiEnabled) {
      toast('已生成本地诊断报告');
    }
  } catch (e: any) {
    toast('诊断失败：' + (e?.message || '未知错误'));
  } finally {
    analyzing.value = false;
  }
}

async function newDraft() {
  id.value = null;
  title.value = '';
  content.value = '';
  selfNote.value = '';
  status.value = 'draft';
  analyses.value = [];
  toast('已新建草稿');
}

async function removeDraft() {
  if (!id.value) return;
  if (!confirm('确定删除这份练习和它的诊断记录？')) return;
  await api.deleteSubmission(id.value);
  id.value = null;
  title.value = '';
  content.value = '';
  selfNote.value = '';
  analyses.value = [];
  emit('changed');
  await refreshAll();
  toast('已删除');
}

defineExpose({ load });
</script>

<template>
  <div class="editor card">
    <div class="card-head">
      <Icon name="edit" :size="15" />
      <h3>{{ exercise.title }}</h3>
      <span class="tag" :class="enough ? 'green' : 'amber'">
        <span class="num">{{ wordCount }}</span> / {{ exercise.min_words }} 字
      </span>
      <span v-if="status === 'done'" class="tag green">已完成</span>
      <div class="spacer" />
      <span class="save-state small" :class="{ ok: lastSaved.startsWith('已保存') }">
        {{ lastSaved }}
      </span>
    </div>

    <div class="card-body">
      <div class="prompt-box">
        <h4><Icon name="target" :size="13" /> 题目要求</h4>
        <p>{{ exercise.prompt }}</p>
        <div v-if="exercise.requirements?.length" class="reqs">
          <span v-for="(r, i) in exercise.requirements" :key="i" class="req">{{ r }}</span>
        </div>
        <details v-if="exercise.rubric?.length" class="rubric">
          <summary class="small">评分细则（{{ exercise.rubric.length }} 条）</summary>
          <ul>
            <li v-for="(r, i) in exercise.rubric" :key="i">{{ r }}</li>
          </ul>
        </details>
      </div>

      <div class="field">
        <label>标题（可留空）</label>
        <input
          v-model="title"
          class="input"
          placeholder="给这次练习起个名字"
          @input="scheduleSave"
        />
      </div>

      <div class="field">
        <label>
          练习正文
          <span class="muted" style="font-weight: 400">
            · 写满 {{ exercise.min_words }} 字再诊断，效果最好
          </span>
        </label>
        <textarea
          v-model="content"
          class="textarea tall"
          :placeholder="
            exercise.requirements?.length
              ? '按上面的要求逐条写。先写成稿，再让 AI 或诊断器挑毛病。'
              : '在这里写下你的练习…'
          "
          @input="scheduleSave"
        />
      </div>

      <div class="field">
        <label>
          自述 / 卡在哪<span class="muted" style="font-weight: 400"> · 写给 AI 看，越具体越好</span>
        </label>
        <textarea
          v-model="selfNote"
          class="textarea short"
          placeholder="例如：我不知道这里的转折够不够狠；这段对话我总觉得不像他本人说的……"
          @input="scheduleSave"
        />
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="analyzing" @click="analyze">
          <Icon name="sparkle" :size="15" />
          {{ analyzing ? '正在诊断…' : (state.aiEnabled ? 'AI 分析这份练习' : '生成本地诊断报告') }}
        </button>
        <button class="btn" @click="toggleDone">
          <Icon :name="status === 'done' ? 'close' : 'check'" :size="15" />
          {{ status === 'done' ? '改回草稿' : '标记完成' }}
        </button>
        <div class="spacer" />
        <button v-if="id" class="btn danger" @click="removeDraft">
          <Icon name="trash" :size="15" />
        </button>
        <button class="btn" @click="newDraft">
          <Icon name="plus" :size="15" />
          新建一份
        </button>
      </div>

      <div v-if="analyses.length" class="results">
        <AnalysisCard
          v-for="a in analyses"
          :key="a.id"
          :analysis="a"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.spacer {
  flex: 1;
}
.save-state {
  color: var(--ink-dim);
  font-size: 11.5px;
}
.save-state.ok {
  color: var(--green);
}

.prompt-box {
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 16px;
}
.prompt-box h4 {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--accent-deep);
}
.prompt-box p {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--ink-mid);
  margin-bottom: 8px;
}
.reqs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.req {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  font-size: 11.5px;
  padding: 3px 8px;
  color: var(--ink-mid);
}
.rubric {
  margin-top: 10px;
}
.rubric summary {
  cursor: pointer;
  color: var(--accent);
}
.rubric ul {
  padding-left: 18px;
  margin-top: 6px;
}
.rubric li {
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--ink-mid);
}

.textarea.tall {
  min-height: 300px;
  line-height: 1.9;
}
.textarea.short {
  min-height: 78px;
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-bottom: 4px;
}

.results {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
