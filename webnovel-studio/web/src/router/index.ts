import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
  { path: '/plan', name: 'plan', component: () => import('@/views/PlanView.vue') },
  {
    path: '/module/:id',
    name: 'module',
    component: () => import('@/views/ModuleView.vue'),
  },
  { path: '/works', name: 'works', component: () => import('@/views/WorksView.vue') },
  { path: '/works/:id', name: 'work', component: () => import('@/views/WorksView.vue') },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/views/HistoryView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});
