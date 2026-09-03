<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ScoreRing from '@/components/ScoreRing.vue';
import ExerciseEditor from '@/components/ExerciseEditor.vue';
import { api, type ModuleDetail } from '@/api';
import { refreshAll, toast, state } from '@/stores/app';

const route = useRoute();
const router = useRouter();

const detail = ref<ModuleDetail | null>(null);
const loading = ref(true);
const tab = ref<'lessons' | 'exercises'>('lessons');
const expanded = ref<string | null>(null);
const activeExerciseId = ref<string>('');
const activeSubmissionId = ref<number | null>(null);
const editorKey = ref(0);

const moduleId = computed(() => route.params.id as string);

async function load() {
  loading.value = true;
  try {
    detail.value = await api.moduleDetail(moduleId.value);
    if (!activeExerciseId.value && detail.value.exercises.length) {
      activeExerciseId.value = detail.value.exercises[0].id;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  applyQuery();
});

watch(moduleId, async () => {
  activeExerciseId.value = '';
  activeSubmissionId.value = null;
  expanded.value = null;
  await load();
  applyQuery();
});

function applyQuery() {
  const sub = route.query.submission ? Number(route.query.submission) : null;
  const ex = route.query.exercise as string | undefined;
  if (ex) activeExerciseId.value = ex;
  if (sub) {
    const found = detail.value?.submissions.find((s) => s.id === sub);
    if (found) {
      activeExerciseId.value = found.exercise_id || activeExerciseId.value;
      activeSubmissionId.value = sub;
      tab.value = 'exercises';
    }
  }
  if (route.query.tab === 'exercises') tab.value = 'exercises';
}

const activeExercise = computed(() =>
  detail.value?.exercises.find((e) => e.id === activeExerciseId.value) || null,
);

const submissionsForExercise = computed(() =>
  (detail.value?.submissions || []).filter(
    (s) => s.exercise_id === activeExerciseId.value,
  ),
);

function selectExercise(id: string) {
  activeExerciseId.value = id;
  const latest = (detail.value?.submissions || []).find(
    (s) => s.exercise_id === id,
  );
  activeSubmissionId.value = latest?.id || null;
  editorKey.value++;
}

function selectSubmission(id: number) {
  activeSubmissionId.value = id;
  editorKey.value++;
}

function toggleLesson(lessonId: string) {
  expanded.value = expanded.value === lessonId ? null : lessonId;
}

async function markLesson(lessonId: string, done: boolean) {
  await api.lessonProgress({ moduleId: moduleId.value, lessonId, done });
  await load();
  await refreshAll();
}

async function onChanged() {
  await load();
  await refreshAll();
}

const stageName = computed(() => {
  const s = state.overview?.stages.find((x) => x.id === detail.value?.stage);
  return s ? `阶段${s.id} · ${s.name}` : '';
});
</script>

<template>
  <div class="page wide">
    <div v-if="loading && !detail" class="loading muted">加载中…</div>

    <template v-else-if="detail">
      <!-- 模块头部 -->
      <section class="hero card fade-in">
        <div class="hero-left">
          <div class="crumbs small muted">
            <RouterLink to="/">总览</RouterLink>
            <Icon name="chevronRight" :size="12" />
            <span>{{ stageName }}</span>
          </div>
          <h1>
            <Icon :name="detail.icon || 'target'" :size="22" />
            {{ detail.title }}
          </h1>
          <p class="subtitle">{{ detail.subtitle }}</p>
          <p class="overview">{{ detail.overview }}</p>

          <div class="goal">
            <Icon name="target" :size="15" />
            <div>
              <strong>本模块目标</strong>
              <span>{{ detail.goal }}</span>
            </div>
          </div>
        </div>

        <div class="hero-right">
          <ScoreRing :progress="detail.progress" :size="86" label="练习完成" />
          <div class="mini-stats">
            <div><b class="num">{{ detail.lessonsDone }}/{{ detail.lessonCount }}</b><i>课程已读</i></div>
            <div><b class="num">{{ detail.doneExercises }}/{{ detail.exerciseCount }}</b><i>练习完成</i></div>
            <div><b class="num">{{ detail.words }}</b><i>累计字数</i></div>
            <div><b class="num">{{ detail.avgScore || '—' }}</b><i>诊断均分</i></div>
          </div>
        </div>
      </section>

      <!-- 达标清单 -->
      <section class="card checklist">
        <div class="card-head">
          <Icon name="check" :size="15" />
          <h3>这一关的达标标准</h3>
        </div>
        <div class="card-body">
          <ul>
            <li v-for="(c, i) in detail.checklist" :key="i">{{ c }}</li>
          </ul>
        </div>
      </section>

      <!-- Tab -->
      <div class="tabs">
        <button :class="{ on: tab === 'lessons' }" @click="tab = 'lessons'">
          <Icon name="book" :size="15" />
          教程（{{ detail.lessonCount }} 课）
        </button>
        <button :class="{ on: tab === 'exercises' }" @click="tab = 'exercises'">
          <Icon name="edit" :size="15" />
          练习（{{ detail.exerciseCount }} 题）
        </button>
      </div>

      <!-- 教程 -->
      <section v-if="tab === 'lessons'" class="lessons">
        <div
          v-for="l in detail.lessons"
          :key="l.id"
          class="lesson card"
          :class="{ open: expanded === l.id }"
        >
          <div class="lesson-head" @click="toggleLesson(l.id)">
            <Icon :name="expanded === l.id ? 'chevronDown' : 'chevronRight'" :size="16" />
            <div class="lesson-title">
              <strong>{{ l.title }}</strong>
              <span class="small muted">{{ l.summary }}</span>
            </div>
            <span class="tag small">{{ l.read_minutes }} 分钟</span>
            <span v-if="l.done" class="tag green">已读</span>
            <button
              class="btn sm"
              @click.stop="markLesson(l.id, !l.done)"
            >
              {{ l.done ? '取消已读' : '标记已读' }}
            </button>
          </div>

          <div v-if="expanded === l.id" class="lesson-body fade-in">
            <div class="prose">
              <p v-for="(p, i) in l.paragraphs" :key="i">{{ p }}</p>
            </div>

            <div class="keypoints">
              <h4><Icon name="check" :size="14" /> 要点</h4>
              <ul>
                <li v-for="(k, i) in l.keypoints" :key="i">{{ k }}</li>
              </ul>
            </div>

            <div class="pitfalls">
              <h4><Icon name="alert" :size="14" /> 常见坑</h4>
              <ul>
                <li v-for="(p, i) in l.pitfalls" :key="i">{{ p }}</li>
              </ul>
            </div>

            <div class="drill">
              <h4><Icon name="lightning" :size="14" /> 随堂练笔</h4>
              <p>{{ l.drill }}</p>
              <button class="btn sm" @click="tab = 'exercises'">去练习区</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 练习 -->
      <section v-else class="exercise-area">
        <div class="exercise-list">
          <button
            v-for="e in detail.exercises"
            :key="e.id"
            class="ex-item"
            :class="{ on: e.id === activeExerciseId }"
            @click="selectExercise(e.id)"
          >
            <span class="ex-no num">{{ e.sort_order }}</span>
            <span class="ex-title">{{ e.title }}</span>
            <span v-if="e.completed" class="tag green">完成</span>
            <span v-else-if="e.submissionCount" class="tag accent">
              草稿 {{ e.submissionCount }}
            </span>
          </button>
        </div>

        <div class="exercise-main">
          <ExerciseEditor
            v-if="activeExercise"
            :key="editorKey"
            :module-id="moduleId"
            :module-title="detail.title"
            :exercise="activeExercise"
            :submission-id="activeSubmissionId"
            @changed="onChanged"
          />

          <div v-if="submissionsForExercise.length > 1" class="card versions">
            <div class="card-head">
              <Icon name="history" :size="15" />
              <h3>这一题的历次稿子</h3>
            </div>
            <div class="card-body">
              <button
                v-for="s in submissionsForExercise"
                :key="s.id"
                class="version"
                :class="{ on: s.id === activeSubmissionId }"
                @click="selectSubmission(s.id)"
              >
                <strong>{{ s.title || '未命名' }}</strong>
                <span class="small muted num">{{ s.word_count }} 字</span>
                <span class="small muted">{{ s.updated_at.slice(0, 10) }}</span>
                <span class="tag" :class="s.status === 'done' ? 'green' : ''">
                  {{ s.status === 'done' ? '完成' : '草稿' }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.loading {
  padding: 60px;
  text-align: center;
}

.hero {
  display: flex;
  gap: 24px;
  padding: 22px 24px;
  margin-bottom: 16px;
}
.hero-left {
  flex: 1;
  min-width: 0;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.hero h1 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 21px;
  margin-bottom: 4px;
}
.subtitle {
  color: var(--accent-deep);
  font-size: 13.5px;
  margin-bottom: 12px;
}
.overview {
  color: var(--ink-mid);
  line-height: 1.9;
  font-size: 13.5px;
  margin-bottom: 14px;
}
.goal {
  display: flex;
  gap: 10px;
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 11px 14px;
  color: var(--accent-deep);
}
.goal div {
  display: flex;
  flex-direction: column;
}
.goal strong {
  font-size: 12.5px;
}
.goal span {
  font-size: 13px;
  color: var(--ink-mid);
  line-height: 1.7;
}

.hero-right {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.mini-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
  text-align: center;
}
.mini-stats div {
  display: flex;
  flex-direction: column;
}
.mini-stats b {
  font-size: 14px;
}
.mini-stats i {
  font-style: normal;
  font-size: 11px;
  color: var(--ink-dim);
}

.checklist {
  margin-bottom: 16px;
}
.checklist ul {
  padding-left: 18px;
}
.checklist li {
  line-height: 1.9;
  color: var(--ink-mid);
  font-size: 13.5px;
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 9px 16px;
  font-size: 14px;
  color: var(--ink-dim);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tabs button:hover {
  color: var(--ink);
}
.tabs button.on {
  color: var(--accent-deep);
  font-weight: 700;
  border-bottom-color: var(--accent);
}

.lessons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lesson-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  cursor: pointer;
}
.lesson-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.lesson-title strong {
  font-size: 14px;
}
.lesson-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lesson-body {
  padding: 4px 20px 20px;
  border-top: 1px solid var(--line-soft);
}
.prose p {
  font-size: 14px;
  line-height: 2;
  color: var(--ink);
  margin-bottom: 12px;
  text-align: justify;
}
.keypoints,
.pitfalls,
.drill {
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-top: 12px;
}
.keypoints {
  background: var(--green-soft);
  border: 1px solid #cfe0c5;
}
.keypoints h4 {
  color: var(--green);
}
.pitfalls {
  background: var(--red-soft);
  border: 1px solid #f0cdc7;
}
.pitfalls h4 {
  color: var(--red);
}
.drill {
  background: var(--accent-soft);
  border: 1px solid #ecd4c8;
}
.drill h4 {
  color: var(--accent-deep);
}
.keypoints h4,
.pitfalls h4,
.drill h4 {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  margin-bottom: 7px;
}
.keypoints ul,
.pitfalls ul {
  padding-left: 18px;
}
.keypoints li,
.pitfalls li {
  font-size: 13px;
  line-height: 1.85;
  color: var(--ink);
}
.drill p {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--ink);
  margin-bottom: 10px;
}

.exercise-area {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: 16px;
  align-items: start;
}
.exercise-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
}
.ex-item {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  border: 1px solid transparent;
  background: var(--panel);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--ink-mid);
  transition: all 0.15s;
}
.ex-item:hover {
  border-color: var(--line);
  background: var(--panel-soft);
}
.ex-item.on {
  background: var(--accent-soft);
  border-color: #ecd4c8;
  color: var(--accent-deep);
  font-weight: 600;
}
.ex-no {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--line-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex: none;
}
.ex-item.on .ex-no {
  background: var(--accent);
  color: #fff;
}
.ex-title {
  flex: 1;
  line-height: 1.5;
}

.versions {
  margin-top: 14px;
}
.version {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--panel-soft);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin-bottom: 6px;
  font-size: 13px;
}
.version:hover {
  border-color: var(--accent);
}
.version.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.version strong {
  flex: 1;
  font-weight: 600;
}

@media (max-width: 900px) {
  .hero {
    flex-direction: column;
  }
  .hero-right {
    flex-direction: row;
    justify-content: flex-start;
  }
  .exercise-area {
    grid-template-columns: 1fr;
  }
  .exercise-list {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .ex-item {
    min-width: 180px;
  }
}
</style>
