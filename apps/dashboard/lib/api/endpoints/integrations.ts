import type { HttpAdapter } from '../types';
import type {
  CreateIntegrationConnectorDto,
  IntegrationConnector,
  IntegrationTestResult,
  TestIntegrationConnectorDto,
  ToolCallLogPage,
} from '@ai-call/shared';

export function integrationsEndpoints(http: HttpAdapter) {
  return {
    list: () => http.request<IntegrationConnector[]>('/integrations'),
    create: (dto: CreateIntegrationConnectorDto) =>
      http.request<IntegrationConnector>('/integrations', { method: 'POST', body: dto }),
    test: (id: string, dto: TestIntegrationConnectorDto) =>
      http.request<IntegrationTestResult>(`/integrations/${id}/test`, { method: 'POST', body: dto }),
    logs: (params?: { connectorId?: string; limit?: number; cursor?: string }) =>
      http.request<ToolCallLogPage>(
        `/integrations/logs${buildQuery(params)}`,
      ),
  };
}

function buildQuery(params?: Record<string, unknown>) {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}
