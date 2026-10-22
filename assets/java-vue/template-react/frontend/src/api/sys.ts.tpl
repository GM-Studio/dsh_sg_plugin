import { download, mutate, request } from './request';
import type { ImportResult, PageResult, SysOption } from './types';

export type { SysOption };

export interface SysRole {
  id: number;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
}
export interface SysUser {
  id: number;
  username: string;
  displayName: string;
  roleCode: string;
  enabled: boolean;
}
export interface SysRoleQuery {
  page: number;
  pageSize: number;
  code?: string;
  name?: string;
}
export interface SysUserQuery {
  page: number;
  pageSize: number;
  username?: string;
  roleCode?: string;
  enabled?: string;
}
export type SysRoleInput = Pick<
  SysRole,
  'code' | 'name' | 'description' | 'enabled'
>;
export type SysRoleUpdate = SysRoleInput & { id: number };
export type SysUserInput = Pick<
  SysUser,
  'username' | 'displayName' | 'roleCode' | 'enabled'
>;
export type SysUserUpdate = SysUserInput & { id: number };

export interface SysDashboard {
  userCount: number;
  roleCount: number;
  departmentCount: number;
  menuCount: number;
  auditCount: number;
}

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export const sysDashboardApi = {
  summary: () => request<SysDashboard>('/api/sys/dashboard'),
};

export const sysRoleApi = {
  list: (query: SysRoleQuery) =>
    request<PageResult<SysRole>>('/api/sys/roles?' + queryString(query)),
  options: () => request<SysOption[]>('/api/sys/roles/options'),
  create: (body: SysRoleInput) => mutate<SysRole>('/api/sys/roles', body),
  update: (body: SysRoleUpdate) =>
    mutate<SysRole>('/api/sys/roles/update', body),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>('/api/sys/roles/delete', { id }),
  import: (file: File, validate: boolean) => {
    const body = new FormData();
    body.append('file', file);
    return mutate<ImportResult>(
      '/api/sys/roles/import' + (validate ? '/validate' : ''),
      body,
    );
  },
  template: () =>
    download('/api/sys/roles/import/template', 'role-template.csv'),
  export: (query: SysRoleQuery) =>
    download(
      '/api/sys/roles/export?' +
        queryString({ code: query.code || '', name: query.name || '' }),
      'roles.csv',
    ),
};

export const sysUserApi = {
  list: (query: SysUserQuery) =>
    request<PageResult<SysUser>>('/api/sys/users?' + queryString(query)),
  create: (body: SysUserInput) => mutate<SysUser>('/api/sys/users', body),
  update: (body: SysUserUpdate) =>
    mutate<SysUser>('/api/sys/users/update', body),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>('/api/sys/users/delete', { id }),
  batchDelete: (ids: number[]) =>
    mutate<{ count: number }>('/api/sys/users/batch-delete', { ids }),
  import: (file: File, validate: boolean) => {
    const body = new FormData();
    body.append('file', file);
    return mutate<ImportResult>(
      '/api/sys/users/import' + (validate ? '/validate' : ''),
      body,
    );
  },
  template: () =>
    download('/api/sys/users/import/template', 'user-template.csv'),
  export: (query: SysUserQuery) =>
    download(
      '/api/sys/users/export?' +
        queryString({
          username: query.username || '',
          roleCode: query.roleCode || '',
          enabled: query.enabled || '',
        }),
      'users.csv',
    ),
};

export interface SysDepartment {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  enabled: boolean;
}
export interface SysMenu {
  id: number;
  code: string;
  name: string;
  path: string;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}
export interface SysAuditLog {
  id: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
}
export interface SysDepartmentQuery {
  page: number;
  pageSize: number;
  code?: string;
  name?: string;
}
export interface SysMenuQuery {
  page: number;
  pageSize: number;
  code?: string;
  name?: string;
}
export interface SysAuditQuery {
  page: number;
  pageSize: number;
  actor?: string;
  action?: string;
}
export type SysDepartmentInput = Pick<
  SysDepartment,
  'code' | 'name' | 'parentCode' | 'enabled'
>;
export type SysDepartmentUpdate = SysDepartmentInput & { id: number };
export type SysMenuInput = Pick<
  SysMenu,
  'code' | 'name' | 'path' | 'icon' | 'sortOrder' | 'enabled'
>;
export type SysMenuUpdate = SysMenuInput & { id: number };

export const sysDepartmentApi = {
  list: (query: SysDepartmentQuery) =>
    request<PageResult<SysDepartment>>(
      '/api/sys/departments?' + queryString(query),
    ),
  options: () => request<SysOption[]>('/api/sys/departments/options'),
  create: (body: SysDepartmentInput) =>
    mutate<SysDepartment>('/api/sys/departments', body),
  update: (body: SysDepartmentUpdate) =>
    mutate<SysDepartment>('/api/sys/departments/update', body),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>('/api/sys/departments/delete', {
      id,
    }),
};

export const sysMenuApi = {
  list: (query: SysMenuQuery) =>
    request<PageResult<SysMenu>>('/api/sys/menus?' + queryString(query)),
  options: () => request<SysOption[]>('/api/sys/menus/options'),
  create: (body: SysMenuInput) => mutate<SysMenu>('/api/sys/menus', body),
  update: (body: SysMenuUpdate) =>
    mutate<SysMenu>('/api/sys/menus/update', body),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>('/api/sys/menus/delete', { id }),
};

export const sysAuditApi = {
  list: (query: SysAuditQuery) =>
    request<PageResult<SysAuditLog>>('/api/sys/audits?' + queryString(query)),
};
