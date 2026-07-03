'use client';

import useSWR, { unstable_serialize } from 'swr';
import { apiClient } from '@/lib/api/client';
import type { KnowledgeBaseSummary } from '@/lib/api/endpoints/knowledge';

export const KNOWLEDGE_KEY = ['knowledge'] as const;

export const knowledgeKeyString = () => unstable_serialize(KNOWLEDGE_KEY);

export function useKnowledgeBases(fallback?: KnowledgeBaseSummary[]) {
  return useSWR(KNOWLEDGE_KEY, () => apiClient.knowledge.list(), {
    fallbackData: fallback,
  });
}
