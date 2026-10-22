import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
} from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import AuditView from '../views/sys/AuditView.vue';
import DepartmentView from '../views/sys/DepartmentView.vue';
import MenuView from '../views/sys/MenuView.vue';
import RoleView from '../views/sys/RoleView.vue';
import UserView from '../views/sys/UserView.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: DashboardView },
  { path: '/sys/roles', name: 'sys-roles', component: RoleView },
  { path: '/sys/users', name: 'sys-users', component: UserView },
  {
    path: '/sys/departments',
    name: 'sys-departments',
    component: DepartmentView,
  },
  { path: '/sys/menus', name: 'sys-menus', component: MenuView },
  { path: '/sys/audits', name: 'sys-audits', component: AuditView },
];

export function createAppRouter() {
  return createRouter({ history: createWebHashHistory(), routes });
}
