import type { CallOutcome, TaskPriority, TaskStatus } from './tasks.js';
import type { GlobalOutboundRulesConfig } from './global-config.js';
import type { ScenarioKey } from './scenarios.js';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export type CampaignLeadStatus =
  | 'imported'
  | 'invalid'
  | 'scheduled'
  | 'dialing'
  | 'completed'
  | 'skipped';

export interface CampaignRetryPolicy {
  maxAttempts: number;
  retryIntervalMinutes?: number;
  retryOn?: string[];
}

export interface CampaignEndCondition {
  stopWhenCompleted?: boolean;
  targetConvertedCount?: number;
  endAt?: string;
}

export interface CampaignLeadInput {
  phoneNumber: string;
  name?: string;
  scheduledAt?: string;
  priority?: TaskPriority;
  variables?: Record<string, string>;
}

export interface CreateCampaignDto {
  name: string;
  description?: string;
  scenario: ScenarioKey;
  scenarioId?: string;
  flowId?: string;
  scheduledAt?: string;
  concurrencyLimit?: number;
  retryPolicy?: Partial<CampaignRetryPolicy>;
  endCondition?: CampaignEndCondition;
  variables?: Record<string, string>;
  leads: CampaignLeadInput[];
}

export interface CampaignStats {
  totalLeads: number;
  validLeads: number;
  invalidLeads: number;
  scheduledTasks: number;
  dialed: number;
  connected: number;
  failed: number;
  converted: number;
  escalated: number;
  connectRate: number;
  conversionRate: number;
  averageDurationSeconds: number;
}

export interface CampaignImportBatch {
  id: string;
  campaignId: string;
  filename?: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: CampaignLeadImportError[];
  createdAt: string;
}

export interface CampaignLead {
  id: string;
  campaignId: string;
  batchId?: string;
  rowNumber: number;
  phoneNumber: string;
  displayName?: string;
  variables: Record<string, string>;
  status: CampaignLeadStatus;
  validationError?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignLeadImportError {
  rowNumber: number;
  phoneNumber?: string;
  reason: string;
}

export interface CampaignListItem {
  id: string;
  name: string;
  description?: string;
  scenario: ScenarioKey;
  scenarioId?: string;
  flowId?: string;
  status: CampaignStatus;
  scheduledAt?: string;
  concurrencyLimit: number;
  retryPolicy: CampaignRetryPolicy;
  endCondition: CampaignEndCondition;
  stats: CampaignStats;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignDetail extends CampaignListItem {
  leads: CampaignLead[];
  importBatches: CampaignImportBatch[];
}

export interface CampaignListPage {
  items: CampaignListItem[];
  nextCursor?: string;
}

export interface CampaignQueryDto {
  status?: CampaignStatus;
  scenario?: ScenarioKey | string;
  cursor?: string;
  limit?: number;
}

export interface UpdateCampaignStatusDto {
  status: CampaignStatus;
  reason?: string;
}

export interface AnalyticsQueryDto {
  campaignId?: string;
  scenario?: ScenarioKey | string;
  from?: string;
  to?: string;
}

export interface AnalyticsFunnel {
  totalTasks: number;
  validLeads: number;
  scheduled: number;
  dialed: number;
  connected: number;
  converted: number;
  escalated: number;
  failed: number;
}

export interface AnalyticsRates {
  connectRate: number;
  conversionRate: number;
  escalationRate: number;
  failureRate: number;
}

export interface AnalyticsReasonBucket {
  reason: string;
  count: number;
  rate: number;
}

export interface AnalyticsCampaignSnapshot {
  campaignId?: string;
  campaignName?: string;
  scenario: ScenarioKey | string;
  totalTasks: number;
  dialed: number;
  connected: number;
  converted: number;
  connectRate: number;
  conversionRate: number;
}

export interface AnalyticsOverview {
  funnel: AnalyticsFunnel;
  rates: AnalyticsRates;
  averageDurationSeconds: number;
  failureReasons: AnalyticsReasonBucket[];
  outcomeBuckets: AnalyticsReasonBucket[];
  campaigns: AnalyticsCampaignSnapshot[];
  generatedAt: string;
}

export type QualityRiskLevel = 'low' | 'medium' | 'high';

export interface CallAnalysis {
  id: string;
  callAttemptId: string;
  taskId: string;
  summary: string;
  intent: string;
  outcome?: CallOutcome;
  refusalReason?: string;
  nextAction: string;
  riskLevel: QualityRiskLevel;
  complianceFlags: string[];
  confidence: number;
  correctedAt?: string;
  correctedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QualityListItem extends CallAnalysis {
  to?: string;
  scenario?: ScenarioKey | string;
  status?: TaskStatus;
  duration?: number;
}

export interface QualityListPage {
  items: QualityListItem[];
  nextCursor?: string;
}

export interface QualityQueryDto {
  riskLevel?: QualityRiskLevel;
  outcome?: CallOutcome | string;
  campaignId?: string;
  cursor?: string;
  limit?: number;
}

export interface CorrectCallAnalysisDto {
  summary?: string;
  intent?: string;
  outcome?: CallOutcome;
  refusalReason?: string;
  nextAction?: string;
  riskLevel?: QualityRiskLevel;
  complianceFlags?: string[];
}

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

