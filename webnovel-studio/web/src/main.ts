import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { bootstrap } from './stores/app';
import './styles/global.css';

bootstrap().catch(() => {
  // 错误已在 store 中记录，页面会显示连接提示
});

createApp(App).use(router).mount('#app');
