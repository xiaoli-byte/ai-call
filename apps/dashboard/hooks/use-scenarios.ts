'use client';

import useSWR, { unstable_serialize } from 'swr';
import { useSWRConfig } from 'swr';
import { apiClient } from '@/lib/api/client';
import type { CreateScenarioDto, ScenarioConfig, UpdateScenarioDto } from '@ai-call/shared';

export const SCENARIOS_KEY = ['scenarios'] as const;

export const scenariosKeyString = () => unstable_serialize(SCENARIOS_KEY);

export function useScenarios(fallback?: ScenarioConfig[]) {
  return useSWR(SCENARIOS_KEY, () => apiClient.scenarios.list(), {
    fallbackData: fallback,
  });
}

export function useScenarioMutations() {
  const { mutate } = useSWRConfig();

  const refresh = async () => {
    await mutate(SCENARIOS_KEY);
  };

  return {
    create: async (dto: CreateScenarioDto) => {
      const scenario = await apiClient.scenarios.create(dto);
      await refresh();
      return scenario;
    },
    update: async (id: string, dto: UpdateScenarioDto) => {
      const scenario = await apiClient.scenarios.update(id, dto);
      await refresh();
      return scenario;
    },
    deactivate: async (id: string) => {
      const scenario = await apiClient.scenarios.deactivate(id);
      await refresh();
      return scenario;
    },
  };
}
