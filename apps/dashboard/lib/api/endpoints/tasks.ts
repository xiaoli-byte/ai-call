import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CreateTaskDto,
  OutboundTask,
  Scenario,
  TaskListPage,
  TaskStatus,
  CallOutcome,
} from '@ai-call/shared';

/** 任务查询参数（保持与原 apiClient 兼容，status/outcome 为宽松 string） */
export interface TaskListParams {
  scenario?: Scenario;
  status?: TaskStatus | string;
  outcome?: CallOutcome | string;
  cursor?: string;
  limit?: number;
}

export function tasksEndpoints(http: HttpAdapter) {
  return {
    list: (params?: TaskListParams) =>
      http.request<TaskListPage>(
        `/tasks${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    get: (id: string) => http.request<OutboundTask>(`/tasks/${id}`),
    create: (dto: CreateTaskDto) =>
      http.request<OutboundTask>('/tasks', { method: 'POST', body: dto }),
    dispatch: (id: string) =>
      http.request<OutboundTask>(`/tasks/${id}/dispatch`, { method: 'POST' }),
  };
}
