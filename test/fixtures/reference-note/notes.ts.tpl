import { mutate, request } from './request';
import type { PageResult } from './types';

export interface Note { id: number; title: string; completed: boolean }
export type NoteInput = Pick<Note, 'title' | 'completed'>;
export const noteApi = {
  list: () => request<PageResult<Note>>('/api/notes'),
  create: (body: NoteInput) => mutate<Note>('/api/notes', body),
  update: (id: number, body: NoteInput) => mutate<Note>('/api/notes/update', {id,...body}),
  remove: (id: number) => mutate<{deleted:boolean}>('/api/notes/delete',{id}),
};
