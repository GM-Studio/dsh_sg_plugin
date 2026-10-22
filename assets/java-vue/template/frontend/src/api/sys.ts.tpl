import { mutate, request } from './request';
import type { PageResult } from './types';

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
export interface SysOption {
  value: string;
  label: string;
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

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export const sysRoleApi = {
  list: (query: SysRoleQuery) =>
    request<PageResult<SysRole>>('/api/sys/roles?' + queryString(query)),
  options: () => request<SysOption[]>('/api/sys/roles/options'),
  create: (body: SysRoleInput) => mutate<SysRole>('/api/sys/roles', body),
  update: (body: SysRoleUpdate) =>
    mutate<SysRole>('/api/sys/roles/update', body),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>('/api/sys/roles/delete', { id }),
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
};
