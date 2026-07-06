import type { TaskPriority } from './tasks.js';
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

export interface CampaignRetryByFailureRule {
  maxAttempts: number;
  intervalMinutes?: number;
}

export interface CampaignRetryPolicy {
  maxAttempts: number;
  retryIntervalMinutes?: number;
  retryOn?: string[];
  failureReasonRules?: Record<string, CampaignRetryByFailureRule>;
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

export interface CampaignLeadImportError {
  rowNumber: number;
  phoneNumber?: string;
  reason: string;
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

export interface CampaignStrategySimulation {
  campaignId: string;
  totalLeads: number;
  callableLeads: number;
  blockedLeads: number;
  estimatedTasks: number;
  blockReasons: Array<{
    reason:
      | 'blocked_number'
      | 'daily_limit'
      | 'max_attempts_per_number'
      | 'failure_reason_retry_limit'
      | 'duplicate_in_campaign';
    count: number;
    phoneNumbers: string[];
  }>;
  generatedAt: string;
}
