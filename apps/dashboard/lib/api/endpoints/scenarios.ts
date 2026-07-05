import type { HttpAdapter } from '../types';
import type {
  CreateScenarioDto,
  ScenarioConfig,
  ScenarioKey,
  UpdateScenarioDto,
} from '@ai-call/shared';

export function scenariosEndpoints(http: HttpAdapter) {
  return {
    list: () => http.request<ScenarioConfig[]>('/scenarios'),
    get: (s: ScenarioKey) => http.request<ScenarioConfig>(`/scenarios/${s}`),
    create: (dto: CreateScenarioDto) =>
      http.request<ScenarioConfig>('/scenarios', { method: 'POST', body: dto }),
    update: (id: string, dto: UpdateScenarioDto) =>
      http.request<ScenarioConfig>(`/scenarios/${id}`, { method: 'PATCH', body: dto }),
    deactivate: (id: string) =>
      http.request<ScenarioConfig>(`/scenarios/${id}/deactivate`, { method: 'POST' }),
  };
}
