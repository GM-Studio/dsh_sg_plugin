import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authApi } from '../src/api/auth';
import {
  sysDepartmentApi,
  sysMenuApi,
  sysRoleApi,
  sysUserApi,
} from '../src/api/sys';
import { request, ApiError } from '../src/api/request';

const fetcher = vi.fn();
function ok(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({ code: 0, data, message: 'OK', traceId: 'trace' }),
    { status },
  );
}
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
  fetcher.mockImplementation(async (path: string) =>
    ok(path === '/api/auth/csrf' ? { token: 'csrf-token' } : { id: 1 }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('[AC-001] serializes GET queries and POST JSON mutations with fresh CSRF tokens and same-origin credentials', async () => {
  await sysRoleApi.list({ page: 2, pageSize: 20, code: 'A & B', name: '' });
  expect(fetcher.mock.calls[0][0]).toBe(
    '/api/sys/roles?page=2&pageSize=20&code=A+%26+B',
  );
  await sysRoleApi.create({
    code: 'EDITOR',
    name: 'Editor',
    description: '',
    enabled: true,
  });
  await sysRoleApi.update({
    code: 'EDITOR',
    name: 'Editor',
    description: '',
    enabled: false,
    id: 1,
  });
  await sysRoleApi.remove(1);
  await sysUserApi.create({
    username: 'bob',
    displayName: 'Bob',
    roleCode: 'ADMIN',
    enabled: true,
  });
  await sysUserApi.batchDelete([1, 2]);
  await sysDepartmentApi.update({
    code: 'ENG',
    name: 'Engineering',
    parentCode: null,
    enabled: true,
    id: 1,
  });
  await sysMenuApi.remove(1);
  const writes = fetcher.mock.calls.filter(
    ([, options]) => options.method === 'POST',
  );
  expect(writes.map(([path]) => path)).toEqual([
    '/api/sys/roles',
    '/api/sys/roles/update',
    '/api/sys/roles/delete',
    '/api/sys/users',
    '/api/sys/users/batch-delete',
    '/api/sys/departments/update',
    '/api/sys/menus/delete',
  ]);
  for (const [, options] of writes) {
    expect(options.credentials).toBe('same-origin');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['X-CSRF-TOKEN']).toBe('csrf-token');
  }
  expect(JSON.parse(writes[2][1].body)).toEqual({ id: 1 });
});

it('[AC-004] uses JSON authentication and multipart imports without overriding the browser boundary', async () => {
  await authApi.me();
  await authApi.login('admin', 'test-only');
  await authApi.logout();
  const file = new File(['code,name\nEDITOR,Editor'], 'roles.csv', {
    type: 'text/csv',
  });
  await sysRoleApi.import(file, true);
  await sysRoleApi.import(file, false);
  await sysUserApi.import(file, true);
  const multipart = fetcher.mock.calls.filter(
    ([, options]) => options.body instanceof FormData,
  );
  expect(multipart.map(([path]) => path)).toEqual([
    '/api/sys/roles/import/validate',
    '/api/sys/roles/import',
    '/api/sys/users/import/validate',
  ]);
  for (const [, options] of multipart) {
    expect(options.body.get('file')).toBe(file);
    expect(options.headers['Content-Type']).toBeUndefined();
  }
});

it('[AC-006] preserves safe server errors and trace ids, signals expiration, and reports network/proxy failures', async () => {
  const expired = vi.fn();
  window.addEventListener('session-expired', expired);
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ message: 'Login required', traceId: 'abc' }),
      { status: 401 },
    ),
  );
  await expect(request('/private')).rejects.toMatchObject({
    status: 401,
    traceId: 'abc',
  });
  expect(expired).toHaveBeenCalledOnce();
  window.removeEventListener('session-expired', expired);
  fetcher.mockResolvedValueOnce(new Response('proxy', { status: 502 }));
  await expect(request('/proxy')).rejects.toThrow('502');
  fetcher.mockRejectedValueOnce(new TypeError('network'));
  await expect(request('/offline')).rejects.toThrow('Cannot reach');
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: 'BUSINESS', message: 'Conflict', traceId: 'a' }),
    ),
  );
  await expect(request('/business')).rejects.toBeInstanceOf(ApiError);
});

it('[AC-005] downloads CSV through authenticated fetch and releases temporary object URLs', async () => {
  const create = vi.fn(() => 'blob:test');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  fetcher.mockImplementation(async () => new Response('file'));
  await sysRoleApi.template();
  await sysRoleApi.export({ page: 1, pageSize: 20, code: 'EDITOR', name: '' });
  await sysUserApi.template();
  expect(click).toHaveBeenCalledTimes(3);
  expect(revoke).toHaveBeenCalledTimes(3);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(fetcher.mock.calls[1][0]).toBe('/api/sys/roles/export?code=EDITOR');
});
