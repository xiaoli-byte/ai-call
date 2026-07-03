import type { HttpAdapter } from '../types';
import type {
  AuthResponse,
  LoginDto,
  UserProfile,
} from '@ai-call/shared';

export function authEndpoints(http: HttpAdapter) {
  return {
    login: (dto: LoginDto) =>
      http.request<AuthResponse>('/auth/login', { method: 'POST', body: dto }),
    logout: () => http.request<void>('/auth/logout', { method: 'POST' }),
    refresh: () => http.request<AuthResponse>('/auth/refresh', { method: 'POST' }),
    me: () => http.request<UserProfile>('/auth/me'),
  };
}
