'use client';

import useSWR, { useSWRConfig, unstable_serialize } from 'swr';
import { apiClient } from '@/lib/api/client';
import type {
  TaskFlow,
  TaskFlowVersion,
  CreateTaskFlowDto,
  UpdateTaskFlowDto,
} from '@ai-call/shared';
import type { TaskFlowTestResult } from '@/lib/api/endpoints/task-flows';

export const taskFlowsKey = (status?: string) =>
  status ? ['task-flows', status] : ['task-flows'];

export const taskFlowsKeyString = (status?: string) =>
  unstable_serialize(taskFlowsKey(status));

export function useTaskFlows(status?: string, fallback?: TaskFlow[]) {
  return useSWR(taskFlowsKey(status), () => apiClient.taskFlows.list(status), {
    fallbackData: fallback,
  });
}

export const taskFlowKey = (id: string) => ['task-flow', id];

export const taskFlowKeyString = (id: string) =>
  unstable_serialize(taskFlowKey(id));

export function useTaskFlow(id: string | null, fallback?: TaskFlow) {
  return useSWR<TaskFlow>(id ? taskFlowKey(id) : null, () =>
    apiClient.taskFlows.get(id!),
  );
}

export function useTaskFlowVersions(id: string | null) {
  return useSWR<TaskFlowVersion[]>(
    id ? ['task-flow-versions', id] : null,
    () => apiClient.taskFlows.versions(id!),
  );
}

export function useTaskFlowMutations() {
  const { mutate } = useSWRConfig();

  const invalidateLists = async () => {
    await mutate((key) => Array.isArray(key) && key[0] === 'task-flows');
  };

  return {
    create: async (dto: CreateTaskFlowDto) => {
      const flow = await apiClient.taskFlows.create(dto);
      await invalidateLists();
      return flow;
    },
    update: async (id: string, dto: UpdateTaskFlowDto) => {
      const flow = await apiClient.taskFlows.update(id, dto);
      await mutate(taskFlowKey(id), flow, { revalidate: false });
      await invalidateLists();
      return flow;
    },
    remove: async (id: string) => {
      await apiClient.taskFlows.remove(id);
      await mutate(taskFlowKey(id), null, { revalidate: false });
      await invalidateLists();
    },
    publish: async (id: string) => {
      const flow = await apiClient.taskFlows.publish(id);
      await mutate(taskFlowKey(id), flow, { revalidate: false });
      await invalidateLists();
      return flow;
    },
    duplicate: async (id: string) => {
      const flow = await apiClient.taskFlows.duplicate(id);
      await invalidateLists();
      return flow;
    },
    test: async (id: string, input: string) => {
      return await apiClient.taskFlows.test(id, input);
    },
  };
}
