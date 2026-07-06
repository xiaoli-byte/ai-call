import type { CallOutcome, TaskStatus } from './tasks.js';
import type { ScenarioKey } from './scenarios.js';

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
