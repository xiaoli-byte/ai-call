import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CallAnalysis,
  CorrectCallAnalysisDto,
  QualityListPage,
  QualityQueryDto,
} from '@ai-call/shared';

export function qualityEndpoints(http: HttpAdapter) {
  return {
    list: (params?: QualityQueryDto) =>
      http.request<QualityListPage>(
        `/quality${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    analyze: (callAttemptId: string) =>
      http.request<CallAnalysis>(`/quality/${callAttemptId}/analyze`, { method: 'POST' }),
    correct: (id: string, dto: CorrectCallAnalysisDto) =>
      http.request<CallAnalysis>(`/quality/${id}`, { method: 'PATCH', body: dto }),
  };
}
