import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CreateTaskBatchDto,
  CreateTaskDto,
  OutboundTask,
  ScenarioKey,
  TaskBatchCreateResult,
  TaskListPage,
  TaskSummary,
  TaskStatus,
  CallOutcome,
} from '@ai-call/shared';

/** 任务查询参数（保持与原 apiClient 兼容，status/outcome 为宽松 string） */
export interface TaskListParams {
  scenario?: ScenarioKey | string;
  status?: TaskStatus | string;
  outcome?: CallOutcome | string;
  cursor?: string;
  limit?: number;
}

/** dispatch 通道：缺省 freeswitch（现行为）；web = 浏览器模拟外呼，不经 FreeSWITCH originate */
export type TaskDispatchChannel = 'freeswitch' | 'web';

/**
 * dispatch 响应：在 OutboundTask 基础上扩展 attemptId 等字段
 * （契约：`POST /tasks/:id/dispatch` 返回 { taskId, attemptId, status }，
 * web 通道浏览器需要 attemptId 作为 WS 首帧 dialog_id）。
 */
export type TaskDispatchResult = OutboundTask & {
  taskId?: string;
  attemptId?: string;
};

export function tasksEndpoints(http: HttpAdapter) {
  return {
    list: (params?: TaskListParams) =>
      http.request<TaskListPage>(
        `/tasks${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    summary: () => http.request<TaskSummary>('/tasks/summary'),
    get: (id: string) => http.request<OutboundTask>(`/tasks/${id}`),
    create: (dto: CreateTaskDto) =>
      http.request<OutboundTask>('/tasks', { method: 'POST', body: dto }),
    createBatch: (dto: CreateTaskBatchDto) =>
      http.request<TaskBatchCreateResult>('/tasks/batch', { method: 'POST', body: dto }),
    dispatch: (id: string, options?: { channel?: TaskDispatchChannel }) =>
      http.request<TaskDispatchResult>(`/tasks/${id}/dispatch`, {
        method: 'POST',
        ...(options?.channel ? { body: { channel: options.channel } } : {}),
      }),
  };
}
