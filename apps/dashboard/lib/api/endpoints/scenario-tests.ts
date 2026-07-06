import type { HttpAdapter } from '../types';
import type {
  RunScenarioTestDto,
  ScenarioTestListPage,
  ScenarioTestRun,
} from '@ai-call/shared';

export function scenarioTestsEndpoints(http: HttpAdapter) {
  return {
    list: (scenarioKey: string) =>
      http.request<ScenarioTestListPage>(`/scenarios/${scenarioKey}/tests`),
    run: (scenarioKey: string, dto: RunScenarioTestDto) =>
      http.request<ScenarioTestRun>(`/scenarios/${scenarioKey}/tests/run`, { method: 'POST', body: dto }),
  };
}
