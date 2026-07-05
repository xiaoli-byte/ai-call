import type { HttpAdapter } from '../types';
import type { GlobalConfig, UpdateGlobalConfigDto } from '@ai-call/shared';

export function globalConfigEndpoints(http: HttpAdapter) {
  return {
    get: () => http.request<GlobalConfig>('/global-config'),
    update: (dto: UpdateGlobalConfigDto) =>
      http.request<GlobalConfig>('/global-config', { method: 'PATCH', body: dto }),
  };
}
