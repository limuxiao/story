<script setup lang="ts">
import { computed } from 'vue';
import { state } from '@/stores/app';

const stage = computed(() => state.overview?.currentStage || null);
const totalAnalyses = computed(() => state.overview?.totals.analyses || 0);
</script>

<template>
  <footer class="app-footer">
    <span class="small muted">
      <template v-if="stage">
        当前阶段：阶段{{ stage.id }} · {{ stage.name }}（{{ stage.weeks }}）· 进度 {{ stage.progress }}%
      </template>
      <template v-else>学习计划尚未开始</template>
    </span>
    <div class="spacer" />
    <span class="small muted">
      数据保存在本机 SQLite（server/data/studio.db）· 已诊断 {{ totalAnalyses }} 次 · 建议定期导出备份
    </span>
  </footer>
</template>

<style scoped>
.app-footer {
  height: var(--footer-h);
  flex: none;
  background: var(--panel);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
}
.spacer {
  flex: 1;
}
@media (max-width: 900px) {
  .app-footer span:last-child {
    display: none;
  }
}
</style>
