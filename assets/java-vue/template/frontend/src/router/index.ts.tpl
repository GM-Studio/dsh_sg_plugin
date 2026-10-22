import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
} from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import TasksView from '../views/TasksView.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: DashboardView },
  { path: '/tasks', name: 'tasks', component: TasksView },
];

export function createAppRouter() {
  return createRouter({ history: createWebHashHistory(), routes });
}
