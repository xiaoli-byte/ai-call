'use client';

import useSWR, { useSWRConfig, unstable_serialize } from 'swr';
import { apiClient } from '@/lib/api/client';
import type { TaskListPage, OutboundTask, CreateTaskDto } from '@ai-call/shared';
import type { TaskListParams } from '@/lib/api/endpoints/tasks';

export const tasksKey = (params?: TaskListParams) =>
  params ? ['tasks', params] : ['tasks'];

export const tasksKeyString = (params?: TaskListParams) =>
  unstable_serialize(tasksKey(params));

export function useTasks(params?: TaskListParams, fallback?: TaskListPage) {
  return useSWR(tasksKey(params), () => apiClient.tasks.list(params), {
    fallbackData: fallback,
    keepPreviousData: true,
  });
}

export function useTaskMutations() {
  const { mutate } = useSWRConfig();
  return {
    create: async (dto: CreateTaskDto) => {
      const task = await apiClient.tasks.create(dto);
      await mutate((key) => Array.isArray(key) && key[0] === 'tasks');
      return task;
    },
    dispatch: async (id: string) => {
      const task = await apiClient.tasks.dispatch(id);
      await mutate((key) => Array.isArray(key) && key[0] === 'tasks');
      return task;
    },
  };
}

export function useTask(id: string | null) {
  return useSWR<OutboundTask>(id ? ['task', id] : null, () =>
    apiClient.tasks.get(id!),
  );
}
