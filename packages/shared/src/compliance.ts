import type { GlobalOutboundRulesConfig } from './global-config.js';

export interface CompliancePolicySummary extends GlobalOutboundRulesConfig {
  blockedNumberCount: number;
  whitelistCount: number;
  aiDisclosureTemplate: string;
}

export interface ComplianceAuditLog {
  id: string;
  action: string;
  subjectType?: string;
  subjectId?: string;
  actorId?: string;
  actorName?: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface CompliancePolicyUpdateDto {
  outboundRules: GlobalOutboundRulesConfig;
  reason?: string;
}
