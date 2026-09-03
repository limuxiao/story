<script setup lang="ts">
import { computed } from 'vue';
import { state } from '@/stores/app';

const props = defineProps<{ size?: number; progress?: number; label?: string }>();

const r = computed(() => (props.size ? props.size / 2 - 5 : 26));
const c = computed(() => 2 * Math.PI * r.value);
const dash = computed(() => {
  const p = Math.max(0, Math.min(100, props.progress || 0));
  return `${(c.value * p) / 100} ${c.value}`;
});
const size = computed(() => props.size || 62);
const color = computed(() => {
  const p = props.progress || 0;
  if (p >= 100) return 'var(--green)';
  if (p >= 60) return 'var(--accent)';
  if (p > 0) return 'var(--amber)';
  return 'var(--line)';
});
</script>

<template>
  <div class="ring-wrap" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        stroke="var(--line)"
        stroke-width="6"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        :stroke="color"
        stroke-width="6"
        stroke-linecap="round"
        :stroke-dasharray="dash"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        style="transition: stroke-dasharray 0.5s ease"
      />
    </svg>
    <div class="ring-label">
      <strong class="num">{{ Math.round(progress || 0) }}<i>%</i></strong>
      <span v-if="label" class="muted">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.ring-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}
.ring-label strong {
  font-size: 15px;
  font-weight: 700;
}
.ring-label strong i {
  font-size: 10px;
  font-style: normal;
  color: var(--ink-dim);
}
.ring-label span {
  font-size: 10px;
  margin-top: 1px;
}
</style>
