<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';
import ScoreRing from './ScoreRing.vue';
import type { Analysis } from '@/api';

const props = defineProps<{ analysis: Analysis; compact?: boolean }>();

const scoreColor = computed(() => {
  const s = props.analysis.score || 0;
  if (s >= 85) return 'var(--green)';
  if (s >= 70) return 'var(--accent)';
  if (s >= 55) return 'var(--amber)';
  return 'var(--red)';
});

const createdAt = computed(() => {
  const d = new Date(props.analysis.created_at);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
});

const statsEntries = computed(() => Object.entries(props.analysis.stats || {}));
</script>

<template>
  <div class="analysis card fade-in">
    <div class="card-head">
      <Icon name="sparkle" :size="16" />
      <h3>诊断报告</h3>
      <span class="tag" :class="analysis.source === 'ai' ? 'green' : 'amber'">
        {{ analysis.source === 'ai' ? 'AI 批改' : '本地规则诊断' }}
      </span>
      <div class="spacer" />
      <span class="small muted num">{{ createdAt }}</span>
    </div>

    <div class="card-body">
      <div class="top">
        <ScoreRing :progress="analysis.score" :size="82" />
        <div class="verdict">
          <p class="verdict-text">{{ analysis.verdict }}</p>
          <div v-if="statsEntries.length" class="stats">
            <span v-for="[k, v] in statsEntries" :key="k" class="stat">
              <b class="num">{{ v }}</b>
              <i>{{ k }}</i>
            </span>
          </div>
        </div>
      </div>

      <div class="dims">
        <div v-for="d in analysis.dimensions" :key="d.name" class="dim">
          <div class="dim-top">
            <span class="dim-name">{{ d.name }}</span>
            <span class="dim-score num" :style="{ color: scoreColor }">{{ d.score }}</span>
          </div>
          <div class="dim-bar">
            <i :style="{ width: d.score + '%', background: scoreColor }" />
          </div>
          <p v-if="d.comment" class="dim-comment small muted">{{ d.comment }}</p>
        </div>
      </div>

      <div class="cols">
        <div v-if="analysis.strengths?.length" class="col">
          <h4 class="green-t"><Icon name="check" :size="14" /> 做得好的地方</h4>
          <ul>
            <li v-for="(s, i) in analysis.strengths" :key="i">{{ s }}</li>
          </ul>
        </div>
        <div v-if="analysis.weaknesses?.length" class="col">
          <h4 class="red-t"><Icon name="alert" :size="14" /> 问题所在</h4>
          <ul>
            <li v-for="(s, i) in analysis.weaknesses" :key="i">{{ s }}</li>
          </ul>
        </div>
      </div>

      <div v-if="analysis.suggestions?.length" class="suggest">
        <h4><Icon name="lightning" :size="14" /> 下一步怎么改</h4>
        <ol>
          <li v-for="(s, i) in analysis.suggestions" :key="i">{{ s }}</li>
        </ol>
      </div>

      <div v-if="analysis.rewrite" class="rewrite">
        <h4><Icon name="edit" :size="14" /> 改写示范</h4>
        <pre>{{ analysis.rewrite }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spacer {
  flex: 1;
}
.top {
  display: flex;
  gap: 18px;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--line);
  margin-bottom: 16px;
}
.verdict {
  flex: 1;
  min-width: 0;
}
.verdict-text {
  font-size: 14px;
  line-height: 1.85;
  color: var(--ink);
  margin-bottom: 8px;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.stat {
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 2px 8px;
  font-size: 11.5px;
  color: var(--ink-dim);
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.stat b {
  color: var(--ink);
  font-size: 12.5px;
}
.stat i {
  font-style: normal;
}

.dims {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}
.dim-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}
.dim-name {
  font-size: 13px;
  font-weight: 600;
}
.dim-score {
  font-size: 14px;
  font-weight: 700;
}
.dim-bar {
  height: 6px;
  background: var(--line-soft);
  border-radius: 6px;
  overflow: hidden;
}
.dim-bar i {
  display: block;
  height: 100%;
  border-radius: 6px;
  transition: width 0.5s;
}
.dim-comment {
  margin-top: 4px;
  line-height: 1.6;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.col h4,
.suggest h4,
.rewrite h4 {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  margin-bottom: 8px;
}
.green-t {
  color: var(--green);
}
.red-t {
  color: var(--red);
}
ul,
ol {
  padding-left: 18px;
}
li {
  font-size: 13px;
  line-height: 1.85;
  color: var(--ink-mid);
  margin-bottom: 3px;
}

.suggest {
  background: var(--accent-soft);
  border: 1px solid #ecd4c8;
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 14px;
}
.suggest h4 {
  color: var(--accent-deep);
}
.suggest ol li {
  color: var(--ink);
}

.rewrite {
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}
.rewrite pre {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ink-mid);
}

@media (max-width: 720px) {
  .cols {
    grid-template-columns: 1fr;
  }
  .top {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
