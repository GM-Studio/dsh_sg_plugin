import { mutate, request } from './request';
import type { User } from './types';

export const authApi = {
  me: () => request<User>('/api/auth/me'),
  login: (username: string, password: string) =>
    mutate<User>('/api/auth/login', { username, password }),
  logout: () => mutate<void>('/api/auth/logout', {}),
};
