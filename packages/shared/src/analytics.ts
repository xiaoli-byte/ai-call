import type { ScenarioKey } from './scenarios.js';

export interface AnalyticsQueryDto {
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

export interface AnalyticsScenarioSnapshot {
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
  scenarios: AnalyticsScenarioSnapshot[];
  generatedAt: string;
}
