import type { HttpAdapter } from '../types';
import { buildQuery } from '../shared';
import type {
  ComplianceAuditLog,
  CompliancePolicySummary,
  CompliancePolicyUpdateDto,
} from '@ai-call/shared';

export function complianceEndpoints(http: HttpAdapter) {
  return {
    getPolicy: () => http.request<CompliancePolicySummary>('/compliance/policy'),
    updatePolicy: (dto: CompliancePolicyUpdateDto) =>
      http.request<CompliancePolicySummary>('/compliance/policy', { method: 'PATCH', body: dto }),
    listAuditLogs: (params?: { limit?: number }) =>
      http.request<ComplianceAuditLog[]>(
        `/compliance/audit-logs${buildQuery(params as Record<string, unknown> | undefined)}`,
      ),
  };
}
