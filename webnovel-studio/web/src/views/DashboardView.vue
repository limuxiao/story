<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ScoreRing from '@/components/ScoreRing.vue';
import { state } from '@/stores/app';
import type { TodoItem } from '@/api';

const router = useRouter();

const overview = computed(() => state.overview);
const totals = computed(() => overview.value?.totals);

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const overdue = computed(() => (overview.value?.todo || []).filter((t) => t.level === 'danger'));
const others = computed(() => (overview.value?.todo || []).filter((t) => t.level !== 'danger'));

/** 最近 35 天热力图：按日期倒序补齐空位 */
const heatCells = computed(() => {
  const map = new Map<string, number>();
  (overview.value?.heatmap || []).forEach((h) => map.set(h.day, h.words));
  const cells: { day: string; words: number }[] = [];
  const d = new Date();
  for (let i = 34; i >= 0; i--) {
    const dt = new Date(d.getTime() - i * 86400000);
    const p = (n: number) => (n < 10 ? '0' : '') + n;
    const key = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
    cells.push({ day: key, words: map.get(key) || 0 });
  }
  return cells;
});

function heatLevel(w: number) {
  if (!w) return 0;
  if (w < 200) return 1;
  if (w < 500) return 2;
  if (w < 1200) return 3;
  return 4;
}

function go(link: string) {
  router.push(link);
}

const levelTag: Record<string, string> = {
  danger: 'red',
  warn: 'amber',
  info: '',
};
const levelText: Record<string, string> = {
  danger: '逾期',
  warn: '待处理',
  info: '建议',
};

function fmtDate(s: string) {
  return s.slice(5, 10).replace('-', '月') + '日';
}
</script>

<template>
  <div class="page wide" v-if="overview">
    <div class="hello">
      <h1>{{ greeting }}，今天写点什么？</h1>
      <p class="muted small">
        今天已写 <b class="num">{{ overview.today.words }}</b> 字 ·
        新增 <b class="num">{{ overview.today.submissions }}</b> 篇练习 ·
        诊断 <b class="num">{{ overview.today.analyses }}</b> 次
      </p>
    </div>

    <!-- 今日要处理 -->
    <section class="card today-card">
      <div class="card-head">
        <Icon name="alert" :size="16" />
        <h3>今天要处理</h3>
        <span v-if="overdue.length" class="tag red">{{ overdue.length }} 项逾期</span>
        <div class="spacer" />
        <span class="small muted">昨天没做完的会自动顺延到这里</span>
      </div>
      <div class="card-body">
        <div v-if="!overdue.length && !others.length" class="empty small muted">
          暂无待办。从下面的阶段里挑一个环节开始，或者去「实战档案」填九宫格。
        </div>

        <div
          v-for="t in [...overdue, ...others]"
          :key="t.type + t.title + t.desc"
          class="todo"
          :class="t.level"
        >
          <span class="tag" :class="levelTag[t.level]">{{ levelText[t.level] }}</span>
          <div class="todo-text">
            <strong>{{ t.title }}</strong>
            <span class="small muted">{{ t.desc }}</span>
          </div>
          <button class="btn sm" @click="go(t.link)">去处理</button>
        </div>
      </div>
    </section>

    <!-- 统计 -->
    <section class="stat-grid">
      <div class="stat-card card">
        <Icon name="edit" :size="17" />
        <b class="num">{{ totals?.words || 0 }}</b>
        <span>累计练笔字</span>
      </div>
      <div class="stat-card card">
        <Icon name="book" :size="17" />
        <b class="num">{{ totals?.submissions || 0 }}</b>
        <span>练习篇数</span>
      </div>
      <div class="stat-card card">
        <Icon name="sparkle" :size="17" />
        <b class="num">{{ totals?.analyses || 0 }}</b>
        <span>诊断次数</span>
      </div>
      <div class="stat-card card">
        <Icon name="chart" :size="17" />
        <b class="num">{{ totals?.avgScore || '—' }}</b>
        <span>诊断均分</span>
      </div>
      <div class="stat-card card">
        <Icon name="check" :size="17" />
        <b class="num">{{ totals?.lessonsDone || 0 }}<i>/{{ totals?.lessonCount || 0 }}</i></b>
        <span>课程已读</span>
      </div>
    </section>

    <!-- 阶段进度 -->
    <section class="stages">
      <h2 class="section-title">分阶段进度</h2>
      <div class="stage-grid">
        <div v-for="s in overview.stages" :key="s.id" class="stage card">
          <div class="stage-head">
            <div>
              <strong>阶段{{ s.id }} · {{ s.name }}</strong>
              <span class="small muted">{{ s.weeks }} · {{ s.subtitle }}</span>
            </div>
            <ScoreRing :progress="s.progress" :size="52" />
          </div>
          <p class="goal small">{{ s.goal }}</p>
          <div class="mods">
            <button
              v-for="m in s.modules"
              :key="m.id"
              class="mod"
              @click="go(m.id === 'practice' ? '/works' : `/module/${m.id}`)"
            >
              <Icon :name="m.icon || 'target'" :size="14" />
              <span class="mod-title">{{ m.title }}</span>
              <span
                class="dot"
                :class="m.status === 'done' ? 'green' : m.status === 'in_progress' ? 'accent' : ''"
              />
            </button>
          </div>
          <div class="stage-foot small muted">
            <span>练习 {{ s.modules.reduce((a, b) => a + b.doneExercises, 0) }}/{{ s.modules.reduce((a, b) => a + b.exerciseCount, 0) }}</span>
            <span>字数 {{ s.modules.reduce((a, b) => a + b.words, 0) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 热力图 -->
    <section class="card heat">
      <div class="card-head">
        <Icon name="plan" :size="16" />
        <h3>最近 35 天练笔</h3>
        <div class="spacer" />
        <span class="small muted">颜色越深，当天写得越多</span>
      </div>
      <div class="card-body">
        <div class="heat-grid">
          <span
            v-for="c in heatCells"
            :key="c.day"
            class="cell"
            :class="'l' + heatLevel(c.words)"
            :title="`${c.day} · ${c.words} 字`"
          />
        </div>
      </div>
    </section>

    <!-- 最近 -->
    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <Icon name="history" :size="16" />
          <h3>最近练习</h3>
        </div>
        <div class="card-body">
          <div v-if="!overview.recent.length" class="empty small muted">还没有练习记录</div>
          <button
            v-for="r in overview.recent"
            :key="r.id"
            class="row"
            @click="go(`/module/${r.module_id}?submission=${r.id}&tab=exercises`)"
          >
            <strong>{{ r.title || '未命名练习' }}</strong>
            <span class="small muted">{{ r.module_title }}</span>
            <span class="small muted num">{{ r.word_count }} 字</span>
            <span class="small muted">{{ fmtDate(r.updated_at) }}</span>
          </button>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <Icon name="sparkle" :size="16" />
          <h3>最近诊断</h3>
        </div>
        <div class="card-body">
          <div v-if="!overview.recentAnalyses.length" class="empty small muted">
            写完练习点「AI 分析」就会出现在这里
          </div>
          <button
            v-for="a in overview.recentAnalyses"
            :key="a.id"
            class="row"
            @click="go(`/module/${a.module_id}?submission=${a.submission_id}&tab=exercises`)"
          >
            <span class="score num" :class="a.score >= 80 ? 'good' : a.score >= 65 ? 'mid' : 'bad'">
              {{ Math.round(a.score) }}
            </span>
            <strong>{{ a.submission_title || '未命名练习' }}</strong>
            <span class="small muted">{{ a.verdict }}</span>
            <span class="tag" :class="a.source === 'ai' ? 'green' : 'amber'">
              {{ a.source === 'ai' ? 'AI' : '本地' }}
            </span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hello {
  margin-bottom: 16px;
}
.hello h1 {
  font-size: 21px;
  margin-bottom: 4px;
}
.hello p b {
  color: var(--ink);
}

.spacer {
  flex: 1;
}

.today-card {
  margin-bottom: 16px;
}
.todo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  margin-bottom: 7px;
  background: var(--panel-soft);
}
.todo.danger {
  border-color: #f0cdc7;
  background: var(--red-soft);
}
.todo.warn {
  border-color: #ecd9a6;
  background: var(--amber-soft);
}
.todo-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.todo-text strong {
  font-size: 13.5px;
}
.todo-text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 14px 0;
  text-align: center;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 22px;
}
.stat-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--accent-deep);
}
.stat-card b {
  font-size: 22px;
  color: var(--ink);
  line-height: 1.3;
}
.stat-card b i {
  font-style: normal;
  font-size: 13px;
  color: var(--ink-dim);
}
.stat-card span {
  font-size: 12px;
  color: var(--ink-dim);
}

.section-title {
  font-size: 15px;
  margin-bottom: 10px;
}
.stages {
  margin-bottom: 22px;
}
.stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(258px, 1fr));
  gap: 12px;
}
.stage {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
}
.stage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.stage-head strong {
  font-size: 14px;
  display: block;
}
.stage-head span {
  display: block;
  line-height: 1.6;
}
.goal {
  color: var(--ink-mid);
  line-height: 1.8;
  margin: 8px 0 12px;
}
.mods {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.mod {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  background: var(--panel-soft);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--ink-mid);
  text-align: left;
}
.mod:hover {
  border-color: var(--accent);
  color: var(--accent-deep);
  background: var(--accent-soft);
}
.mod-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line);
  flex: none;
}
.dot.accent {
  background: var(--accent);
}
.dot.green {
  background: var(--green);
}
.stage-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}

.heat {
  margin-bottom: 22px;
}
.heat-grid {
  display: grid;
  grid-template-columns: repeat(35, 1fr);
  gap: 3px;
}
.cell {
  aspect-ratio: 1;
  border-radius: 3px;
  background: var(--line-soft);
}
.cell.l1 {
  background: #f0dcc9;
}
.cell.l2 {
  background: #e2b98d;
}
.cell.l3 {
  background: #cf8f56;
}
.cell.l4 {
  background: var(--accent);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  padding: 9px 2px;
  font-size: 13px;
  color: var(--ink);
}
.row:last-child {
  border-bottom: none;
}
.row:hover strong {
  color: var(--accent);
}
.row strong {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row .small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.score {
  font-size: 15px;
  font-weight: 700;
  width: 30px;
  flex: none;
}
.score.good {
  color: var(--green);
}
.score.mid {
  color: var(--accent);
}
.score.bad {
  color: var(--red);
}

@media (max-width: 900px) {
  .two-col {
    grid-template-columns: 1fr;
  }
  .heat-grid {
    grid-template-columns: repeat(18, 1fr);
  }
}
</style>
