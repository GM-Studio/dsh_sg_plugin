import { download, mutate, request } from './request';
import type {
  ImportResult,
  PageResult,
  Task,
  TaskInput,
  TaskQuery,
} from './types';

export function queryString(query: Partial<TaskQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== '') params.set(key, String(value));
  return params.toString();
}
export const taskApi = {
  list: (query: Partial<TaskQuery> = {}) =>
    request<PageResult<Task>>('/api/tasks?' + queryString(query)),
  get: (id: number) => request<Task>(`/api/tasks/${id}`),
  create: (body: TaskInput) => mutate<Task>('/api/tasks', body),
  update: (id: number, body: TaskInput) =>
    mutate<Task>('/api/tasks/update', { ...body, id }),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>('/api/tasks/delete', { id }),
  batchDelete: (ids: number[]) =>
    mutate<{ count: number }>('/api/tasks/batch-delete', { ids }),
  batchStatus: (ids: number[], completed: boolean) =>
    mutate<{ count: number }>('/api/tasks/batch-update-status', {
      ids,
      completed,
    }),
  import: (file: File, validate: boolean) => {
    const body = new FormData();
    body.append('file', file);
    return mutate<ImportResult>(
      '/api/tasks/import' + (validate ? '/validate' : ''),
      body,
    );
  },
  template: () => download('/api/tasks/import/template', 'task-template.csv'),
  export: (query: Partial<TaskQuery>) =>
    download(
      '/api/tasks/export?' +
        queryString({
          title: query.title || '',
          completed: query.completed || '',
        }),
      'tasks.csv',
    ),
};
