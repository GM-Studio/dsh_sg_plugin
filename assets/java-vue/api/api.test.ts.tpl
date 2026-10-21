import { afterEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from '../src/api';

afterEach(() => vi.unstubAllGlobals());
describe('task HTTP client', () => {
  it('[AC-001] queries with GET and mutates with POST JSON, including deletion receipt', async () => {
    const task = { id: 1, title: 'hello', completed: false };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([task])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(task), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...task, completed: true })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, deleted: true })),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await taskApi.list()).toEqual([task]);
    expect(await taskApi.create({ title: 'hello', completed: false })).toEqual(
      task,
    );
    expect(
      (await taskApi.update(1, { title: 'hello', completed: true })).completed,
    ).toBe(true);
    await expect(taskApi.remove(1)).resolves.toEqual({ id: 1, deleted: true });
    expect(fetcher.mock.calls[1]).toEqual([
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{"title":"hello","completed":false}',
      },
    ]);
    expect(fetcher.mock.calls[2]).toEqual([
      '/api/tasks/update',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'hello', completed: true, id: 1 }),
      },
    ]);
    expect(fetcher.mock.calls[3]).toEqual([
      '/api/tasks/delete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ id: 1 }),
      },
    ]);
  });
  it('[AC-001] reports server, proxy and network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('{"message":"Invalid task"}', { status: 400 }),
        )
        .mockResolvedValueOnce(
          new Response('proxy unavailable', { status: 502 }),
        )
        .mockRejectedValueOnce(new TypeError('network')),
    );
    await expect(taskApi.list()).rejects.toThrow('Invalid task');
    await expect(taskApi.list()).rejects.toThrow('502');
    await expect(taskApi.list()).rejects.toThrow('Cannot reach');
  });
});
