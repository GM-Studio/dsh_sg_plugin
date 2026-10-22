import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
} from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import RoleView from '../views/sys/RoleView.vue';
import TasksView from '../views/TasksView.vue';
import UserView from '../views/sys/UserView.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: DashboardView },
  { path: '/tasks', name: 'tasks', component: TasksView },
  { path: '/sys/roles', name: 'sys-roles', component: RoleView },
  { path: '/sys/users', name: 'sys-users', component: UserView },
];

export function createAppRouter() {
  return createRouter({ history: createWebHashHistory(), routes });
}
