import type {
  CloneTemplateDto,
  CloneTemplateResult,
  CostOverview,
  DatasetOverview,
  DemoGuideOverview,
  IndustryTemplate,
  ObservabilityOverview,
  OrganizationsOverview,
  PlatformQueryDto,
} from '@ai-call/shared';
import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';

export function platformEndpoints(http: HttpAdapter) {
  return {
    observability: (params?: PlatformQueryDto) =>
      http.request<ObservabilityOverview>(
        `/observability/overview${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    costs: (params?: PlatformQueryDto) =>
      http.request<CostOverview>(
        `/costs/overview${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    templates: () => http.request<IndustryTemplate[]>('/templates'),
    cloneTemplate: (id: string, dto: CloneTemplateDto) =>
      http.request<CloneTemplateResult>(`/templates/${id}/clone`, {
        method: 'POST',
        body: dto,
      }),
    organizations: () => http.request<OrganizationsOverview>('/organizations/overview'),
    datasets: () => http.request<DatasetOverview>('/datasets/overview'),
    demoGuide: () => http.request<DemoGuideOverview>('/demo-guide'),
  };
}
