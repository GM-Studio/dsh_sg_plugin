export interface Task {
  id: number;
  title: string;
  completed: boolean;
}
export type TaskInput = Pick<Task, 'title' | 'completed'>;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/tasks' + path, options);
  } catch {
    throw new Error(
      'Cannot reach the server. Check your connection and retry.',
    );
  }
  if (!response.ok) {
    let message = 'Request failed (' + response.status + ')';
    try {
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === 'object' &&
        'message' in body &&
        typeof body.message === 'string'
      ) {
        message = body.message;
      }
    } catch {
      /* A proxy may return a non-JSON error. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
function payload(
  body: TaskInput | { id: number } | (TaskInput & { id: number }),
): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  };
}
export const taskApi = {
  list: () => request<Task[]>(''),
  create: (task: TaskInput) => request<Task>('', payload(task)),
  update: (id: number, task: TaskInput) =>
    request<Task>('/update', payload({ ...task, id })),
  remove: (id: number) =>
    request<{ id: number; deleted: boolean }>('/delete', payload({ id })),
};
