export interface ApiResponse<T> {
  code: number | string;
  message: string;
  data: T;
  traceId: string;
}
export interface PageResult<T> {
  records: T[];
  total: number;
  page: number;
  pageSize: number;
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
