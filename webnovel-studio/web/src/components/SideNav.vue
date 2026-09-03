<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon from './Icon.vue';
import { state } from '@/stores/app';

const route = useRoute();

const groups = computed(() => {
  const stages = state.overview?.stages || [];
  return stages.map((s: any) => ({
    id: s.id,
    name: s.name,
    weeks: s.weeks,
    status: s.status,
    modules: s.modules || [],
  }));
});

const statusTag = (status: string) => {
  if (status === 'done') return { cls: 'green', text: '已完成' };
  if (status === 'in_progress') return { cls: 'accent', text: '进行中' };
  return { cls: '', text: '未开始' };
};

function closeOnMobile() {
  if (window.innerWidth <= 720) state.navOpen = false;
}
</script>

<template>
  <aside class="side-nav" :class="{ open: state.navOpen }">
    <div class="nav-scroll">
      <div class="nav-block">
        <RouterLink to="/" class="nav-item" :class="{ on: route.name === 'dashboard' }" @click="closeOnMobile">
          <Icon name="home" :size="17" />
          <span>学习总览</span>
        </RouterLink>
        <RouterLink to="/plan" class="nav-item" :class="{ on: route.name === 'plan' }" @click="closeOnMobile">
          <Icon name="plan" :size="17" />
          <span>分阶段计划</span>
        </RouterLink>
      </div>

      <div v-for="g in groups" :key="g.id" class="nav-block">
        <div class="nav-group">
          <span class="stage-name">阶段{{ g.id }} · {{ g.name }}</span>
          <span class="tag" :class="statusTag(g.status).cls">{{ statusTag(g.status).text }}</span>
        </div>
        <div class="nav-sub small muted">{{ g.weeks }}</div>

        <RouterLink
          v-for="m in g.modules"
          :key="m.id"
          :to="m.id === 'practice' ? '/works' : `/module/${m.id}`"
          class="nav-item sub"
          :class="{ on: route.params.id === m.id || (m.id === 'practice' && route.name === 'works') }"
          @click="closeOnMobile"
        >
          <Icon :name="m.icon || 'target'" :size="16" />
          <span class="nav-title">{{ m.title }}</span>
          <span v-if="m.status === 'done'" class="dot green"><Icon name="check" :size="11" /></span>
          <span v-else-if="m.status === 'in_progress'" class="dot accent" />
          <span v-else class="dot" />
        </RouterLink>
      </div>

      <div class="nav-block">
        <RouterLink to="/history" class="nav-item" :class="{ on: route.name === 'history' }" @click="closeOnMobile">
          <Icon name="history" :size="17" />
          <span>练习记录</span>
        </RouterLink>
      </div>
    </div>

    <div class="nav-foot small muted">
      <div class="progress-line">
        <span>课程已读</span>
        <b class="num">{{ state.overview?.totals.lessonsDone || 0 }} / {{ state.overview?.totals.lessonCount || 0 }}</b>
      </div>
      <div class="bar">
        <i :style="{ width: ((state.overview?.totals.lessonsDone || 0) / Math.max(1, state.overview?.totals.lessonCount || 1)) * 100 + '%' }" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.side-nav {
  width: var(--nav-w);
  flex: none;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.nav-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px 6px;
}
.nav-block {
  margin-bottom: 12px;
}
.nav-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 2px;
}
.stage-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-mid);
  letter-spacing: 0.3px;
}
.nav-sub {
  padding: 0 8px 4px;
  font-size: 11px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--ink-mid);
  font-size: 13.5px;
  transition: background 0.14s, color 0.14s;
  border: 1px solid transparent;
  min-height: 38px;
}
.nav-item:hover {
  background: var(--panel-soft);
  color: var(--ink);
}
.nav-item.on {
  background: var(--accent-soft);
  border-color: #ecd4c8;
  color: var(--accent-deep);
  font-weight: 600;
}
.nav-item.sub {
  padding-left: 12px;
}
.nav-title {
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.dot.accent {
  background: var(--accent);
}
.dot.green {
  background: var(--green);
  color: #fff;
  width: 14px;
  height: 14px;
}
.nav-foot {
  border-top: 1px solid var(--line-soft);
  padding: 10px 14px 12px;
}
.progress-line {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  margin-bottom: 6px;
}
.progress-line b {
  color: var(--ink);
}
.bar {
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
  .side-nav {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 40;
    width: 250px;
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    box-shadow: var(--shadow-lg);
  }
  .side-nav.open {
    transform: none;
  }
}
</style>
