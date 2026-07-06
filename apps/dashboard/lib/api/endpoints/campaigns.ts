import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CampaignDetail,
  CampaignListPage,
  CampaignQueryDto,
  CampaignStrategySimulation,
  CreateCampaignDto,
  UpdateCampaignStatusDto,
} from '@ai-call/shared';

export function campaignsEndpoints(http: HttpAdapter) {
  return {
    list: (params?: CampaignQueryDto) =>
      http.request<CampaignListPage>(
        `/campaigns${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
    get: (id: string) => http.request<CampaignDetail>(`/campaigns/${id}`),
    create: (dto: CreateCampaignDto) =>
      http.request<CampaignDetail>('/campaigns', { method: 'POST', body: dto }),
    updateStatus: (id: string, dto: UpdateCampaignStatusDto) =>
      http.request<CampaignDetail>(`/campaigns/${id}/status`, { method: 'PATCH', body: dto }),
    strategySimulation: (id: string) =>
      http.request<CampaignStrategySimulation>(`/campaigns/${id}/strategy-simulation`),
  };
}
