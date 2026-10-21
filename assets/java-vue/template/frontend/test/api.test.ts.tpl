import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { taskApi, queryString } from '../src/api/tasks';
import { authApi } from '../src/api/auth';
import { fileApi } from '../src/api/files';
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

it('[AC-001] serializes GET queries and POST JSON with fresh CSRF tokens and same-origin credentials', async () => {
  await taskApi.list({ page: 2, pageSize: 20, title: 'A & B', completed: '' });
  expect(fetcher.mock.calls[0][0]).toBe(
    '/api/tasks?page=2&pageSize=20&title=A+%26+B',
  );
  await taskApi.get(1);
  await taskApi.create({ title: 'one', completed: false });
  await taskApi.update(1, { title: 'two', completed: true });
  await taskApi.remove(1);
  await taskApi.batchDelete([1, 2]);
  await taskApi.batchStatus([1], true);
  const writes = fetcher.mock.calls.filter(
    ([, options]) => options.method === 'POST',
  );
  expect(writes.map(([path]) => path)).toEqual([
    '/api/tasks',
    '/api/tasks/update',
    '/api/tasks/delete',
    '/api/tasks/batch-delete',
    '/api/tasks/batch-update-status',
  ]);
  for (const [, options] of writes) {
    expect(options.credentials).toBe('same-origin');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['X-CSRF-TOKEN']).toBe('csrf-token');
  }
  expect(JSON.parse(writes[1][1].body)).toEqual({
    id: 1,
    title: 'two',
    completed: true,
  });
  expect(JSON.parse(writes[2][1].body)).toEqual({ id: 1 });
  expect(queryString({})).toBe('');
});

it('[AC-004] uses JSON authentication and multipart uploads without overriding the browser boundary', async () => {
  await authApi.me();
  await authApi.login('admin', 'test-only');
  await authApi.logout();
  const file = new File(['title,completed\nTask,false'], 'test.csv', {
    type: 'text/csv',
  });
  await taskApi.import(file, true);
  await taskApi.import(file, false);
  await fileApi.list();
  await fileApi.metadata('a/b');
  await fileApi.upload(file);
  const multipart = fetcher.mock.calls.filter(
    ([, options]) => options.body instanceof FormData,
  );
  expect(multipart.map(([path]) => path)).toEqual([
    '/api/tasks/import/validate',
    '/api/tasks/import',
    '/api/files/upload',
  ]);
  for (const [, options] of multipart) {
    expect(options.body.get('file')).toBe(file);
    expect(options.headers['Content-Type']).toBeUndefined();
  }
  expect(fetcher.mock.calls.some(([path]) => path === '/api/files/a%2Fb')).toBe(
    true,
  );
});

it('[AC-003] preserves safe server errors and trace ids, signals expiration, and reports network/proxy failures', async () => {
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

it('[AC-006] downloads through authenticated fetch and releases temporary object URLs', async () => {
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
  await taskApi.template();
  await taskApi.export({ title: 'A', completed: 'true' });
  await taskApi.export({});
  await fileApi.download({
    fileId: 'id',
    name: 'note.txt',
    size: 4,
    mediaType: 'text/plain',
    downloadUrl: '/ignored',
  });
  expect(click).toHaveBeenCalledTimes(4);
  expect(revoke).toHaveBeenCalledTimes(4);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(fetcher.mock.calls[1][0]).toBe(
    '/api/tasks/export?title=A&completed=true',
  );
});
