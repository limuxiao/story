<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import AppFooter from '@/components/AppFooter.vue';
import SideNav from '@/components/SideNav.vue';
import AiPanel from '@/components/AiPanel.vue';
import { state, refreshAll } from '@/stores/app';

let timer: number | undefined;

onMounted(() => {
  // 每 60 秒静默刷新一次总览，保持数据新鲜（单向：只更新 state，不触发其他渲染）
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refreshAll().catch(() => {});
  }, 60000);
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div class="app-shell">
    <AppHeader />

    <div class="app-container">
      <SideNav />

      <main class="app-wrapper">
        <div v-if="state.error" class="conn-error">
          <h3>无法连接后端服务</h3>
          <p>
            {{ state.error }}<br />
            请在项目根目录执行 <code>npm run dev</code>（或分别启动 server 与 web），
            后端默认运行在 <code>http://localhost:5178</code>。
          </p>
          <button class="btn primary" @click="refreshAll()">重试</button>
        </div>
        <RouterView v-else v-slot="{ Component }">
          <Suspense>
            <component :is="Component" />
          </Suspense>
        </RouterView>
      </main>

      <AiPanel />
    </div>

    <AppFooter />

    <transition name="toast">
      <div v-if="state.toast" class="app-toast">{{ state.toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.conn-error {
  max-width: 520px;
  margin: 80px auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 28px;
  text-align: center;
  box-shadow: var(--shadow);
}
.conn-error h3 {
  margin-bottom: 12px;
  color: var(--red);
}
.conn-error p {
  color: var(--ink-mid);
  line-height: 2;
  margin-bottom: 18px;
}
.conn-error code {
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 6px;
  font-size: 12.5px;
}

.app-toast {
  position: fixed;
  left: 50%;
  bottom: 60px;
  transform: translateX(-50%);
  background: var(--ink);
  color: #fff;
  font-size: 13px;
  padding: 10px 20px;
  border-radius: 22px;
  box-shadow: var(--shadow-lg);
  z-index: 200;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
