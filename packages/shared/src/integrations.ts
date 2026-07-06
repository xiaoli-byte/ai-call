export type IntegrationConnectorType = 'webhook' | 'crm' | 'sms' | 'internal_api';
export type IntegrationAuthType = 'none' | 'bearer' | 'basic' | 'api_key';
export type ToolCallStatus = 'success' | 'failed';

export interface IntegrationConnector {
  id: string;
  name: string;
  type: IntegrationConnectorType;
  description?: string;
  endpoint: string;
  authType: IntegrationAuthType;
  requestTemplate: unknown;
  responseMapping?: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntegrationConnectorDto {
  name: string;
  type: IntegrationConnectorType;
  description?: string;
  endpoint: string;
  authType?: IntegrationAuthType;
  authConfig?: Record<string, unknown>;
  requestTemplate?: unknown;
  responseMapping?: Record<string, unknown>;
  enabled?: boolean;
}

export interface TestIntegrationConnectorDto {
  sampleVariables?: Record<string, string>;
  sourceTaskId?: string;
  sourceAttemptId?: string;
}

export interface IntegrationTestResult {
  connectorId: string;
  status: ToolCallStatus;
  request: {
    method: string;
    endpoint: string;
    body?: unknown;
  };
  response?: {
    statusCode: number;
    body?: unknown;
  };
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  logId: string;
}

export interface ToolCallLog {
  id: string;
  connectorId?: string;
  connectorName?: string;
  sourceType?: string;
  sourceId?: string;
  taskId?: string;
  attemptId?: string;
  status: ToolCallStatus;
  method: string;
  endpoint: string;
  request: unknown;
  response?: unknown;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: string;
}

export interface ToolCallLogPage {
  items: ToolCallLog[];
  nextCursor?: string;
}
