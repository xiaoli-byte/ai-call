import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CallHistoryDetail,
  CallHistoryPage,
  CallOutcome,
  ScenarioKey,
  TaskStatus,
} from '@ai-call/shared';

export interface CallHistoryListParams {
  scenario?: ScenarioKey | string;
  status?: TaskStatus | string;
  outcome?: CallOutcome | string;
  cursor?: string;
  limit?: number;
}

export function callsEndpoints(http: HttpAdapter) {
  return {
    list: (params?: CallHistoryListParams) =>
      http.request<CallHistoryPage>(
        `/calls${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    get: (id: string) => http.request<CallHistoryDetail>(`/calls/${id}`),
  };
}
