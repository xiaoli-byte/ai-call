import type { ScenarioKey } from './scenarios.js';
import type { KnowledgeRetrieveHit } from './knowledge-base.js';

export type ScenarioTestResult = 'pass' | 'warning' | 'fail';

export interface ScenarioTestRun {
  id: string;
  scenarioKey: ScenarioKey | string;
  flowId?: string;
  flowVersionId?: string;
  input: string;
  expectedOutcome?: string;
  modelOutput: string;
  nodePath: string[];
  knowledgeHits: KnowledgeRetrieveHit[];
  result: ScenarioTestResult;
  score: number;
  riskItems: string[];
  golden: boolean;
  createdAt: string;
}

export interface RunScenarioTestDto {
  flowId?: string;
  flowVersionId?: string;
  input: string;
  expectedOutcome?: string;
  golden?: boolean;
}

export interface ScenarioTestListPage {
  items: ScenarioTestRun[];
  passRate: number;
  goldenCoverage: number;
  highRiskItems: string[];
}
