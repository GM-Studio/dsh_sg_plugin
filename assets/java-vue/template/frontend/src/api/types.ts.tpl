export interface ApiResponse<T> {
  code: number | string;
  message: string;
  data: T;
  traceId: string;
}
export interface Task {
  id: number;
  title: string;
  completed: boolean;
}
export type TaskInput = Pick<Task, 'title' | 'completed'>;
export interface PageResult<T> {
  records: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TaskQuery {
  page: number;
  pageSize: number;
  title: string;
  completed: string;
  sortBy: string;
  sortOrder: string;
}
export interface User {
  username: string;
  role: 'ADMIN' | 'VIEWER';
}
export interface ImportResult {
  count: number;
  valid: boolean;
  errors: string[];
}
export interface StoredFile {
  fileId: string;
  name: string;
  mediaType: string;
  size: number;
  downloadUrl: string;
}
