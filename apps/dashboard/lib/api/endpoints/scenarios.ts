import type { HttpAdapter } from '../types';
import type { Scenario, ScenarioConfig } from '@ai-call/shared';

export function scenariosEndpoints(http: HttpAdapter) {
  return {
    list: () => http.request<ScenarioConfig[]>('/scenarios'),
    get: (s: Scenario) => http.request<ScenarioConfig>(`/scenarios/${s}`),
  };
}
