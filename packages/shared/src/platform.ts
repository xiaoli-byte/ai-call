import type { FlowEdge, FlowNode } from './task-flows.js';

export interface PlatformQueryDto {
  from?: string;
  to?: string;
  campaignId?: string;
  scenario?: string;
  provider?: string;
}

export type PlatformComponent =
  | 'stt'
  | 'llm'
  | 'tts'
  | 'telephony'
  | 'scheduler'
  | 'tool'
  | 'database'
  | 'dashboard'
  | 'voice_agent'
  | 'funasr';

export type PlatformHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface PlatformHealthCheck {
  component: PlatformComponent;
  name: string;
  status: PlatformHealthStatus;
  message: string;
  checkedAt: string;
  action?: string;
}

export interface PlatformProviderMetric {
  component: PlatformComponent;
  provider: string;
  eventCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastEventAt?: string;
  status: PlatformHealthStatus;
}

export interface PlatformAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  source: PlatformComponent;
  title: string;
  description: string;
  action: string;
  createdAt: string;
}

export interface ObservabilityOverview {
  generatedAt: string;
  range: {
    from?: string;
    to?: string;
  };
  summary: {
    totalEvents: number;
    successRate: number;
    errorRate: number;
    avgLatencyMs: number;
    activeCalls: number;
    schedulerBacklog: number;
    toolFailureRate: number;
  };
  providers: PlatformProviderMetric[];
  healthChecks: PlatformHealthCheck[];
  alerts: PlatformAlert[];
  recentErrors: Array<{
    id: string;
    source: PlatformComponent;
    message: string;
    createdAt: string;
  }>;
}

export interface CostProviderBreakdown {
  provider: string;
  component: PlatformComponent;
  calls: number;
  tokens: number;
  audioSeconds: number;
  toolCalls: number;
  cost: number;
}

export interface CostCampaignBreakdown {
  campaignId?: string;
  campaignName: string;
  scenario: string;
  calls: number;
  connectedCalls: number;
  totalSeconds: number;
  estimatedTokens: number;
  cost: number;
  avgCostPerCall: number;
}

export interface CostTrendPoint {
  date: string;
  calls: number;
  cost: number;
}

export interface CostOverview {
  generatedAt: string;
  currency: 'CNY' | 'USD';
  summary: {
    callCount: number;
    connectedCalls: number;
    totalSeconds: number;
    totalTokens: number;
    totalCost: number;
    avgCostPerCall: number;
  };
  providers: CostProviderBreakdown[];
  campaigns: CostCampaignBreakdown[];
  trend: CostTrendPoint[];
  assumptions: string[];
}

export interface IndustryTemplate {
  id: string;
  name: string;
  industry: string;
  scenarioKey: string;
  description: string;
  complexity: 'low' | 'medium' | 'high';
  recommendedProviders: string[];
  complianceNotes: string[];
  successMetrics: string[];
  knowledgeSchema: string[];
  qualityRules: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface CloneTemplateDto {
  name?: string;
  scenarioKey?: string;
  publish?: boolean;
}

export interface CloneTemplateResult {
  templateId: string;
  scenarioId: string;
  scenarioKey: string;
  flowId: string;
  flowVersionId?: string;
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  billingStatus: string;
  providerCount: number;
  quotaCount: number;
  usage: Array<{
    metric: string;
    period: string;
    quantity: number;
    eventCount: number;
    bucketStart: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationsOverview {
  generatedAt: string;
  organizations: OrganizationSummary[];
  isolation: {
    defaultTenantId: string;
    coveredResources: string[];
    pendingResources: string[];
    note: string;
  };
}

export interface DatasetSample {
  id: string;
  callAttemptId?: string;
  taskId: string;
  summary: string;
  intent: string;
  refusalReason?: string;
  outcome?: string;
  riskLevel: string;
  confidence: number;
  createdAt: string;
}

export interface InsightBucket {
  label: string;
  count: number;
  rate: number;
}

export interface OptimizationSuggestion {
  id: string;
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  evidence: string;
  targetModule: 'script' | 'knowledge' | 'flow' | 'compliance';
}

export interface DatasetOverview {
  generatedAt: string;
  sampleCount: number;
  labeledSampleCount: number;
  topRefusalReasons: InsightBucket[];
  lowConfidenceQuestions: InsightBucket[];
  riskDistribution: InsightBucket[];
  samples: DatasetSample[];
  suggestions: OptimizationSuggestion[];
}

export interface DemoGuideStep {
  id: string;
  title: string;
  status: 'ready' | 'warning' | 'blocked';
  description: string;
  href?: string;
  action?: string;
}

export interface DemoGuideOverview {
  generatedAt: string;
  readinessScore: number;
  steps: DemoGuideStep[];
  healthChecks: PlatformHealthCheck[];
  sampleData: {
    scenarios: number;
    flows: number;
    campaigns: number;
    tasks: number;
    analyses: number;
  };
  resetCommand: string;
}
