import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateIntegrationConnectorDto as SharedCreateIntegrationConnectorDto,
  IntegrationConnector,
  IntegrationTestResult,
  TestIntegrationConnectorDto as SharedTestIntegrationConnectorDto,
  ToolCallLog,
  ToolCallLogPage,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrismaJson } from '../common/prisma-json.js';

@Injectable()
export class IntegrationsService {
  private readonly memoryConnectors = new Map<string, any>();

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<IntegrationConnector[]> {
    const records = await (this.prisma as any).integrationConnector.findMany?.({
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
    return (records ?? [...this.memoryConnectors.values()]).map((record: any) => this.toConnector(record));
  }

  async create(dto: SharedCreateIntegrationConnectorDto): Promise<IntegrationConnector> {
    const now = new Date();
    const endpoint = assertAllowedConnectorEndpoint(dto.endpoint);
    const data = {
      name: dto.name.trim(),
      type: dto.type,
      description: dto.description?.trim() ?? '',
      endpoint,
      method: 'POST',
      authType: dto.authType ?? 'none',
      authConfig: toPrismaJson(dto.authConfig ?? {}),
      requestTemplate: toPrismaJson(dto.requestTemplate ?? {}),
      responseMapping: toPrismaJson(dto.responseMapping ?? {}),
      enabled: dto.enabled ?? true,
    };
    const record = await (this.prisma as any).integrationConnector.create({
      data,
    });
    const normalized = {
      ...record,
      method: record.method ?? data.method,
      createdAt: record.createdAt ?? now,
      updatedAt: record.updatedAt ?? now,
    };
    this.memoryConnectors.set(normalized.id, normalized);
    return this.toConnector(normalized);
  }

  async test(
    id: string,
    dto: SharedTestIntegrationConnectorDto,
  ): Promise<IntegrationTestResult> {
    const connector = await this.getRecord(id);
    if (!connector.enabled) throw new BadRequestException('Integration connector is disabled');
    const started = Date.now();
    const method = String(connector.method ?? 'POST').toUpperCase();
    const requestBody = renderTemplate(connector.requestTemplate ?? {}, dto.sampleVariables ?? {});
    const request = {
      method,
      endpoint: connector.endpoint,
      body: requestBody,
    };

    let status: 'success' | 'failed' = 'success';
    let response: { statusCode: number; body?: unknown } | undefined;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    try {
      response = await this.executeConnector(connector, method, requestBody);
    } catch (error) {
      status = 'failed';
      errorCode = 'CONNECTOR_TEST_FAILED';
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const durationMs = Math.max(1, Date.now() - started);
    const log = await (this.prisma as any).toolCallLog.create({
      data: {
        connectorId: connector.id,
        sourceType: 'integration_test',
        sourceId: connector.id,
        taskId: dto.sourceTaskId,
        attemptId: dto.sourceAttemptId,
        status,
        method,
        endpoint: connector.endpoint,
        request: toPrismaJson(request),
        response: response ? toPrismaJson(response) : undefined,
        durationMs,
        errorCode,
        errorMessage,
        retryCount: 0,
      },
    });
    await (this.prisma as any).integrationConnector.update?.({
      where: { id: connector.id },
      data: { lastTestAt: new Date() },
    });
    return {
      connectorId: connector.id,
      status,
      request,
      response,
      durationMs,
      errorCode,
      errorMessage,
      logId: log.id,
    };
  }

  async listLogs(query: { connectorId?: string; limit?: number; cursor?: string } = {}): Promise<ToolCallLogPage> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const records = await (this.prisma as any).toolCallLog.findMany({
      where: { connectorId: query.connectorId },
      include: { connector: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    return {
      items: items.map((record: any) => this.toLog(record)),
      nextCursor: hasMore ? items.at(-1)?.id : undefined,
    };
  }

  private async getRecord(id: string): Promise<any> {
    const record = await (this.prisma as any).integrationConnector.findUnique?.({ where: { id } });
    const connector = record ?? this.memoryConnectors.get(id);
    if (!connector) throw new NotFoundException(`IntegrationConnector ${id} not found`);
    return connector;
  }

  private async executeConnector(
    connector: any,
    method: string,
    body: unknown,
  ): Promise<{ statusCode: number; body?: unknown }> {
    const endpoint = assertAllowedConnectorEndpoint(String(connector.endpoint ?? ''));
    if (endpoint.startsWith('mock://')) {
      return { statusCode: 200, body: { ok: true, id: 'mock-result-1', echo: body } };
    }
    const response = await fetch(endpoint, {
      method,
      headers: {
        'content-type': 'application/json',
        ...buildAuthHeaders(connector.authType, connector.authConfig),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const parsed = safeJson(text);
    if (!response.ok) throw new Error(`HTTP ${response.status}${text ? ` ${text}` : ''}`);
    return { statusCode: response.status, body: parsed ?? text };
  }

  private toConnector(record: any): IntegrationConnector {
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      description: record.description || undefined,
      endpoint: record.endpoint,
      authType: record.authType,
      requestTemplate: record.requestTemplate ?? {},
      responseMapping: asObject(record.responseMapping),
      enabled: Boolean(record.enabled),
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    };
  }

  private toLog(record: any): ToolCallLog {
    return {
      id: record.id,
      connectorId: record.connectorId ?? undefined,
      connectorName: record.connector?.name,
      sourceType: record.sourceType ?? undefined,
      sourceId: record.sourceId ?? undefined,
      taskId: record.taskId ?? undefined,
      attemptId: record.attemptId ?? undefined,
      status: record.status,
      method: record.method,
      endpoint: record.endpoint,
      request: record.request ?? {},
      response: record.response ?? undefined,
      durationMs: record.durationMs,
      errorCode: record.errorCode ?? undefined,
      errorMessage: record.errorMessage ?? undefined,
      retryCount: record.retryCount,
      createdAt: toIso(record.createdAt),
    };
  }
}

function renderTemplate(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '');
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderTemplate(item, variables)]),
    );
  }
  return value;
}

function buildAuthHeaders(type: unknown, config: unknown): Record<string, string> {
  const source = asObject(config);
  if (type === 'bearer' && typeof source.token === 'string') {
    return { authorization: `Bearer ${source.token}` };
  }
  if (type === 'basic' && typeof source.username === 'string' && typeof source.password === 'string') {
    return { authorization: `Basic ${Buffer.from(`${source.username}:${source.password}`).toString('base64')}` };
  }
  if (type === 'api_key' && typeof source.headerName === 'string' && typeof source.value === 'string') {
    return { [source.headerName]: source.value };
  }
  return {};
}

function assertAllowedConnectorEndpoint(rawEndpoint: string): string {
  const endpoint = rawEndpoint.trim();
  if (endpoint.startsWith('mock://')) return endpoint;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BadRequestException('Invalid connector endpoint URL');
  }

  if (url.protocol !== 'https:') {
    throw new BadRequestException('Connector endpoint must use HTTPS');
  }

  const hostname = normalizeHostname(url.hostname);
  if (isUnsafeHostname(hostname)) {
    throw new BadRequestException(`Connector endpoint host is not allowed: ${url.hostname}`);
  }

  const allowlist = connectorEndpointAllowlist();
  if (allowlist.length === 0 || !allowlist.some((allowed) => matchesAllowedHost(hostname, allowed))) {
    throw new BadRequestException(`Connector endpoint host is not allowlisted: ${url.hostname}`);
  }

  return url.toString();
}

function connectorEndpointAllowlist(): string[] {
  return (process.env.INTEGRATION_CONNECTOR_ALLOWLIST ?? '')
    .split(',')
    .map((item) => normalizeHostname(item))
    .filter(Boolean);
}

function matchesAllowedHost(hostname: string, allowed: string): boolean {
  if (allowed.startsWith('*.')) {
    const suffix = allowed.slice(1);
    return hostname.endsWith(suffix) && hostname !== allowed.slice(2);
  }
  return hostname === allowed;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isUnsafeHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '::' || hostname === '::1') return true;
  if (hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) return true;

  const ipv4 = parseIpv4(hostname);
  if (!ipv4) return false;
  const [first, second] = ipv4;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}

function parseIpv4(hostname: string): number[] | undefined {
  const parts = hostname.split('.');
  if (parts.length !== 4) return undefined;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return numbers;
}

function safeJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}
