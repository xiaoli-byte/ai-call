import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CreateTaskFlowDto,
  TaskFlow,
  TaskFlowVersion,
  UpdateTaskFlowDto,
} from '@ai-call/shared';

export interface TaskFlowTestResult {
  flowId: string;
  flowName: string;
  nodeId: string;
  nodeName: string;
  input: string;
  reply: string;
}

export function taskFlowsEndpoints(http: HttpAdapter) {
  return {
    list: (status?: string) =>
      http.request<TaskFlow[]>(
        `/task-flows${buildQuery(status ? { status } : undefined)}`,
      ),
    get: (id: string) => http.request<TaskFlow>(`/task-flows/${id}`),
    create: (dto: CreateTaskFlowDto) =>
      http.request<TaskFlow>('/task-flows', { method: 'POST', body: dto }),
    update: (id: string, dto: UpdateTaskFlowDto) =>
      http.request<TaskFlow>(`/task-flows/${id}`, {
        method: 'PATCH',
        body: dto,
      }),
    remove: (id: string) =>
      http.request<void>(`/task-flows/${id}`, { method: 'DELETE' }),
    publish: (id: string) =>
      http.request<TaskFlow>(`/task-flows/${id}/publish`, { method: 'POST' }),
    duplicate: (id: string) =>
      http.request<TaskFlow>(`/task-flows/${id}/duplicate`, { method: 'POST' }),
    versions: (id: string) =>
      http.request<TaskFlowVersion[]>(`/task-flows/${id}/versions`),
    test: (id: string, input: string) =>
      http.request<TaskFlowTestResult>(`/task-flows/${id}/test`, {
        method: 'POST',
        body: { input },
      }),
  };
}
