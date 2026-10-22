import { createHashRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import App from '../App';
import DashboardPage from '../views/DashboardPage';
import AuditsPage from '../views/sys/AuditsPage';
import DepartmentsPage from '../views/sys/DepartmentsPage';
import MenusPage from '../views/sys/MenusPage';
import RolesPage from '../views/sys/RolesPage';
import UsersPage from '../views/sys/UsersPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'sys/roles', element: <RolesPage /> },
      { path: 'sys/users', element: <UsersPage /> },
      { path: 'sys/departments', element: <DepartmentsPage /> },
      { path: 'sys/menus', element: <MenusPage /> },
      { path: 'sys/audits', element: <AuditsPage /> },
    ],
  },
];

export function createAppRouter() {
  return createHashRouter(routes);
}
