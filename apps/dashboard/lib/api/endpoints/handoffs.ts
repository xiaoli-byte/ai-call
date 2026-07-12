import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  CreateCallbackTaskDto,
  HandoffListPage,
  HandoffTicket,
  HandoffTicketStatus,
  UpdateHandoffTicketDto,
} from '@ai-call/shared';

export function handoffsEndpoints(http: HttpAdapter) {
  return {
    list: (params?: { status?: HandoffTicketStatus; limit?: number; cursor?: string }) =>
      http.request<HandoffListPage>(`/handoffs${buildQuery(params as Record<string, unknown> | undefined)}`),
    get: (id: string) => http.request<HandoffTicket>(`/handoffs/${id}`),
    update: (id: string, dto: UpdateHandoffTicketDto) =>
      http.request<HandoffTicket>(`/handoffs/${id}`, { method: 'PATCH', body: dto }),
    createCallbackTask: (id: string, dto: CreateCallbackTaskDto) =>
      http.request<HandoffTicket>(`/handoffs/${id}/callback-task`, { method: 'POST', body: dto }),
    createFromAnalysis: (analysisId: string) =>
      http.request<HandoffTicket>(`/handoffs/from-analysis/${analysisId}`, { method: 'POST' }),
  };
}
