import {
  OutboundTask,
  Scenario,
  ScenarioConfig,
  type CreateTaskFlowDto,
  type TaskFlow,
  type UpdateTaskFlowDto,
} from '@ai-call/shared';

/**
 * API 客户端 - 调用 NestJS 后端
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function api<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  // 场景
  listScenarios: () => api<ScenarioConfig[]>('/scenarios'),
  getScenario: (s: Scenario) => api<ScenarioConfig>(`/scenarios/${s}`),

  // 任务
  listTasks: (params?: { scenario?: Scenario; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.scenario) q.set('scenario', params.scenario);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return api<OutboundTask[]>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  getTask: (id: string) => api<OutboundTask>(`/tasks/${id}`),
  createTask: (dto: {
    to: string;
    scenario: Scenario;
    variables?: Record<string, string>;
    flowId?: string;
  }) =>
    api<OutboundTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  dispatchTask: (id: string) =>
    api<OutboundTask>(`/tasks/${id}/dispatch`, { method: 'POST' }),

  // 知识库
  listKnowledgeBases: () =>
    api<Array<{ id: string; name: string; docCount: number }>>(
      '/knowledge-base',
    ),
  getKnowledgeBase: (id: string) =>
    api<{ id: string; name: string; docs: Array<{ id: string; content: string; source: string }> }>(
      `/knowledge-base/${id}`,
    ),
  retrieve: (id: string, query: string) =>
    api<{ query: string; results: Array<{ id: string; content: string; source: string; score?: number }> }>(
      `/knowledge-base/${id}/retrieve`,
      { method: 'POST', body: JSON.stringify({ query }) },
    ),

  // 任务流程
  taskFlows: {
    list: (status?: string) => api<TaskFlow[]>(`/task-flows${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    get: (id: string) => api<TaskFlow>(`/task-flows/${id}`),
    create: (dto: CreateTaskFlowDto) =>
      api<TaskFlow>('/task-flows', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    update: (id: string, dto: UpdateTaskFlowDto) =>
      api<TaskFlow>(`/task-flows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
    remove: (id: string) =>
      api<void>(`/task-flows/${id}`, { method: 'DELETE' }),
    publish: (id: string) =>
      api<TaskFlow>(`/task-flows/${id}/publish`, { method: 'POST' }),
    archive: (id: string) =>
      api<TaskFlow>(`/task-flows/${id}/archive`, { method: 'POST' }),
    duplicate: (id: string) =>
      api<TaskFlow>(`/task-flows/${id}/duplicate`, { method: 'POST' }),
  },
};
