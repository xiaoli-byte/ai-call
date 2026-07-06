import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type { AnalyticsOverview, AnalyticsQueryDto } from '@ai-call/shared';

export function analyticsEndpoints(http: HttpAdapter) {
  return {
    overview: (params?: AnalyticsQueryDto) =>
      http.request<AnalyticsOverview>(
        `/analytics/overview${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
  };
}
