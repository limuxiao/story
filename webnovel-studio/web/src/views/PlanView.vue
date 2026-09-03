<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ScoreRing from '@/components/ScoreRing.vue';
import { state } from '@/stores/app';

const router = useRouter();
const stages = computed(() => state.overview?.stages || []);

const totalWeeks = computed(() => {
  const w = stages.value.map((s) => s.weeks.match(/\d+/g)?.map(Number) || []);
  const all = w.flat();
  return all.length ? Math.max(...all) : 0;
});

const statusMeta: Record<string, { cls: string; text: string }> = {
  done: { cls: 'green', text: '已完成' },
  in_progress: { cls: 'accent', text: '进行中' },
  not_started: { cls: '', text: '未开始' },
};

function go(id: string) {
  router.push(id === 'practice' ? '/works' : `/module/${id}`);
}
</script>

<template>
  <div class="page wide">
    <div class="head">
      <h1>分阶段学习计划</h1>
      <p class="muted small">
        共 {{ stages.length }} 个阶段 · 约 {{ totalWeeks }} 周 · 9 个练习环节 · 36 节课 · 36 道练习题。
        每个阶段只盯一件事，过完再进下一阶段。
      </p>
    </div>

    <section class="card method">
      <div class="card-head">
        <Icon name="book" :size="16" />
        <h3>这份计划怎么用</h3>
      </div>
      <div class="card-body">
        <ol>
          <li>
            <strong>每周两个动作</strong>：精读 2 节课（点开课程卡片，读完点「标记已读」），
            完成 1 道练习题（写够字数后点「AI 分析」）。
          </li>
          <li>
            <strong>顺序不是死的，但层次是死的</strong>：立意没立住就别急着练文笔；
            结构塌了就别急着抠句子。上一层的问题，下一层救不回来。
          </li>
          <li>
            <strong>诊断低于 70 分就返工</strong>：总览的「今天要处理」会自动把低分练习挑出来。
          </li>
          <li>
            <strong>每阶段结束做一次复盘</strong>：回到「实战档案」，把九宫格对应的一格填满或重写。
          </li>
        </ol>
      </div>
    </section>

    <div class="stage-list">
      <section v-for="s in stages" :key="s.id" class="stage card">
        <div class="stage-top">
          <div class="stage-badge num">{{ s.id }}</div>
          <div class="stage-info">
            <div class="stage-title">
              <h2>{{ s.name }}</h2>
              <span class="tag" :class="statusMeta[s.status].cls">{{ statusMeta[s.status].text }}</span>
              <span class="tag">{{ s.weeks }}</span>
            </div>
            <p class="subtitle small muted">{{ s.subtitle }}</p>
            <p class="goal">{{ s.goal }}</p>
            <p class="focus small">
              <Icon name="lightning" :size="13" />
              {{ s.focus }}
            </p>
          </div>
          <ScoreRing :progress="s.progress" :size="72" />
        </div>

        <div class="mods">
          <div v-for="m in s.modules" :key="m.id" class="mod">
            <button class="mod-main" @click="go(m.id)">
              <Icon :name="m.icon || 'target'" :size="17" />
              <div class="mod-text">
                <strong>{{ m.title }}</strong>
                <span class="small muted">{{ m.subtitle }}</span>
              </div>
              <span class="tag" :class="statusMeta[m.status].cls">
                {{ statusMeta[m.status].text }}
              </span>
              <Icon name="chevronRight" :size="15" />
            </button>
            <div class="mod-bar">
              <div class="bar">
                <i :style="{ width: m.progress + '%' }" />
              </div>
              <span class="small muted num">
                练习 {{ m.doneExercises }}/{{ m.exerciseCount }} · 课程 {{ m.lessonsDone }}/{{ m.lessonCount }} · {{ m.words }} 字
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 16px;
}
.head h1 {
  font-size: 21px;
  margin-bottom: 4px;
}

.method {
  margin-bottom: 20px;
}
.method ol {
  padding-left: 18px;
}
.method li {
  line-height: 1.95;
  font-size: 13.5px;
  color: var(--ink-mid);
  margin-bottom: 4px;
}
.method strong {
  color: var(--ink);
}

.stage-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.stage {
  padding: 18px 20px;
}
.stage-top {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.stage-badge {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
  flex: none;
}
.stage-info {
  flex: 1;
  min-width: 0;
}
.stage-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.stage-title h2 {
  font-size: 17px;
}
.goal {
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--ink-mid);
  margin-top: 8px;
}
.focus {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--accent-deep);
  margin-top: 6px;
  background: var(--accent-soft);
  border-radius: 7px;
  padding: 5px 10px;
  width: fit-content;
}

.mods {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}
.mod-main {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--panel-soft);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  color: var(--ink);
}
.mod-main:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.mod-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.mod-text strong {
  font-size: 13.5px;
}
.mod-text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mod-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 0 2px;
}
.bar {
  flex: 1;
  height: 5px;
  background: var(--line-soft);
  border-radius: 6px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 6px;
  transition: width 0.4s;
}

@media (max-width: 720px) {
  .stage-top {
    flex-wrap: wrap;
  }
}
</style>
