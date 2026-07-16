import type { HttpAdapter } from '../types';
import type {
  KnowledgeDocument,
  KnowledgeTestRetrieveDto,
  KnowledgeTestRetrieveResult,
} from '@ai-call/shared';

export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  docCount: number;
  indexedCount?: number;
  failedCount?: number;
  staleCount?: number;
  parentId?: string | null;
  children?: KnowledgeBaseSummary[];
}

export interface KnowledgeBaseDoc {
  id: string;
  content: string;
  source: string;
}

export interface KnowledgeBaseDetail {
  id: string;
  name: string;
  docs: KnowledgeBaseDoc[];
  documents?: KnowledgeDocument[];
}

export interface KnowledgeRetrieveResult {
  query: string;
  results: Array<{
    id: string;
    content: string;
    source: string;
    score?: number;
  }>;
}

export function knowledgeEndpoints(http: HttpAdapter) {
  return {
    list: () => http.request<KnowledgeBaseSummary[]>('/knowledge-base'),
    get: (id: string) =>
      http.request<KnowledgeBaseDetail>(`/knowledge-base/${id}`),
    retrieve: (id: string, query: string) =>
      http.request<KnowledgeRetrieveResult>(
        `/knowledge-base/${id}/retrieve`,
        { method: 'POST', body: { query } },
      ),
    testRetrieve: (id: string, dto: KnowledgeTestRetrieveDto) =>
      http.request<KnowledgeTestRetrieveResult>(
        `/knowledge-base/${id}/test-retrieve`,
        { method: 'POST', body: dto },
      ),
  };
}
