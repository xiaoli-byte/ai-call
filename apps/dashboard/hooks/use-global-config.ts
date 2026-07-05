'use client';

import useSWR from 'swr';
import { useSWRConfig } from 'swr';
import type { UpdateGlobalConfigDto } from '@ai-call/shared';
import { apiClient } from '@/lib/api/client';

export const GLOBAL_CONFIG_KEY = ['global-config'] as const;

export function useGlobalConfig() {
  return useSWR(GLOBAL_CONFIG_KEY, () => apiClient.globalConfig.get());
}

export function useGlobalConfigMutations() {
  const { mutate } = useSWRConfig();

  return {
    update: async (dto: UpdateGlobalConfigDto) => {
      const config = await apiClient.globalConfig.update(dto);
      await mutate(GLOBAL_CONFIG_KEY, config, { revalidate: false });
      return config;
    },
  };
}
