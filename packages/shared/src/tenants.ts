/**
 * Phase 3 tenant foundation contract.
 *
 * Existing product tables intentionally remain tenant-agnostic for now. New
 * platform code should attach tenant-scoped data to DEFAULT_TENANT_ID until a
 * feature is migrated behind an explicit tenant boundary.
 */
export const DEFAULT_TENANT_ID = 'default';
export const DEFAULT_TENANT_SLUG = 'default';
export const DEFAULT_TENANT_NAME = 'Default Tenant';

export const TenantStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  ARCHIVED: 'archived',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const TenantProviderType = {
  STT: 'stt',
  LLM: 'llm',
  TTS: 'tts',
  TELEPHONY: 'telephony',
  TOOL: 'tool',
} as const;
export type TenantProviderType =
  (typeof TenantProviderType)[keyof typeof TenantProviderType];

export const UsageMetric = {
  CALL_SECONDS: 'call_seconds',
  CALL_ATTEMPTS: 'call_attempts',
  LLM_TOKENS: 'llm_tokens',
  TTS_CHARACTERS: 'tts_characters',
  STT_SECONDS: 'stt_seconds',
} as const;
export type UsageMetric = (typeof UsageMetric)[keyof typeof UsageMetric];

export const UsagePeriod = {
  DAY: 'day',
  MONTH: 'month',
} as const;
export type UsagePeriod = (typeof UsagePeriod)[keyof typeof UsagePeriod];

export const BillingAccountStatus = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CLOSED: 'closed',
} as const;
export type BillingAccountStatus =
  (typeof BillingAccountStatus)[keyof typeof BillingAccountStatus];

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantDto {
  slug: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTenantDto {
  name?: string;
  status?: TenantStatus;
  metadata?: Record<string, unknown>;
}

export interface TenantProviderConfig {
  id: string;
  tenantId: string;
  providerType: TenantProviderType;
  providerName: string;
  enabled: boolean;
  secretRef?: string;
  configEncrypted: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTenantProviderConfigDto {
  providerType: TenantProviderType;
  providerName: string;
  enabled?: boolean;
  secretRef?: string;
  configEncrypted?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface TenantQuotaPolicy {
  id: string;
  tenantId: string;
  metric: UsageMetric;
  period: UsagePeriod;
  limit: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetTenantQuotaPolicyDto {
  metric: UsageMetric;
  period: UsagePeriod;
  limit: number;
  enabled?: boolean;
}

export interface CheckTenantQuotaDto {
  tenantId?: string;
  metric: UsageMetric;
  period: UsagePeriod;
  quantity?: number;
  at?: Date | string;
}

export type TenantQuotaDecision =
  | {
      allowed: true;
      tenantId: string;
      metric: UsageMetric;
      period: UsagePeriod;
      limit?: number;
      used: number;
      remaining?: number;
    }
  | {
      allowed: false;
      tenantId: string;
      metric: UsageMetric;
      period: UsagePeriod;
      reason: 'quota_exceeded';
      limit: number;
      used: number;
      remaining: number;
    };

export interface UsageEvent {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  metric: UsageMetric;
  period: UsagePeriod;
  quantity: number;
  eventAt: string;
  source?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageAggregate {
  id: string;
  tenantId: string;
  metric: UsageMetric;
  period: UsagePeriod;
  bucketStart: string;
  quantity: number;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecordUsageEventDto {
  tenantId?: string;
  idempotencyKey: string;
  metric: UsageMetric;
  period?: UsagePeriod;
  quantity?: number;
  at?: Date | string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordUsageEventResult {
  event: UsageEvent;
  aggregate: UsageAggregate;
  duplicate: boolean;
}

export interface BillingAccount {
  id: string;
  tenantId: string;
  status: BillingAccountStatus;
  providerCustomerRef?: string;
  billingEmail?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
