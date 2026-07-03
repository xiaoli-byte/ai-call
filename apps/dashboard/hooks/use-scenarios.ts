'use client';

import useSWR, { unstable_serialize } from 'swr';
import { apiClient } from '@/lib/api/client';
import type { ScenarioConfig } from '@ai-call/shared';

export const SCENARIOS_KEY = ['scenarios'] as const;

export const scenariosKeyString = () => unstable_serialize(SCENARIOS_KEY);

export function useScenarios(fallback?: ScenarioConfig[]) {
  return useSWR(SCENARIOS_KEY, () => apiClient.scenarios.list(), {
    fallbackData: fallback,
  });
}
