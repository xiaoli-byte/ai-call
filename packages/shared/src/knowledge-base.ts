export type KnowledgeIndexStatus = 'uploaded' | 'chunked' | 'indexed' | 'failed';

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  filename: string;
  mimeType?: string;
  chunkCount: number;
  indexStatus: KnowledgeIndexStatus;
  indexError?: string;
  version: number;
  indexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseSummaryV2 {
  id: string;
  name: string;
  docCount: number;
  indexedCount: number;
  failedCount: number;
  staleCount: number;
}

export interface KnowledgeRetrieveHit {
  id: string;
  documentId?: string;
  content: string;
  source: string;
  score: number;
}

export interface KnowledgeTestRetrieveDto {
  query: string;
  topK?: number;
}

export interface KnowledgeTestRetrieveResult {
  query: string;
  answer: string;
  results: KnowledgeRetrieveHit[];
  lowConfidence: boolean;
  fallbackAction?: 'answer' | 'handoff' | 'fallback_script';
  generatedAt: string;
}
