import { Injectable } from '@nestjs/common';
import type {
  ObservabilityOverview,
  PlatformAlert,
  PlatformComponent,
  PlatformHealthCheck,
  PlatformHealthStatus,
  PlatformProviderMetric,
  PlatformQueryDto,
} from '@ai-call/shared';
import { MetricsService } from '../metrics/metrics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthChecksService } from './health-checks.service.js';
import {
  asObject,
  avg,
  buildDateRange,
  dateValue,
  endpointHost,
  envProvider,
  numberValue,
  p95,
  rate,
  stringValue,
  toIso,
} from './platform-utils.js';

type MetricAccumulator = {
  component: PlatformComponent;
  provider: string;
  eventCount: number;
  successCount: number;
  errorCount: number;
  latencies: number[];
  lastEventAt?: Date;
};

@Injectable()
export class ObservabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly healthChecks: HealthChecksService,
  ) {}

  async getOverview(query: PlatformQueryDto = {}): Promise<ObservabilityOverview> {
    const dateRange = buildDateRange(query);
    const [events, toolLogs, activeCalls, schedulerBacklog, healthChecks] = await Promise.all([
      (this.prisma as any).callEvent.findMany({
        where: { createdAt: dateRange },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      (this.prisma as any).toolCallLog.findMany({
        where: { createdAt: dateRange },
        include: { connector: { select: { name: true, type: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      (this.prisma as any).callAttempt.count({
        where: { status: { in: ['calling', 'in_call'] } },
      }),
      (this.prisma as any).outboxEvent.count({
        where: { status: 'pending' },
      }),
      this.healthChecks.getPlatformHealthChecks(),
    ]);

    const providers = buildProviderMetrics(events, toolLogs, this.metrics.snapshot());
    return {
      generatedAt: new Date().toISOString(),
      range: { from: query.from, to: query.to },
      summary: buildObservabilitySummary(providers, activeCalls, schedulerBacklog, toolLogs),
      providers,
      healthChecks,
      alerts: buildAlerts(providers, healthChecks, activeCalls, schedulerBacklog),
      recentErrors: buildRecentErrors(events, toolLogs),
    };
  }
}

function buildProviderMetrics(
  events: any[],
  toolLogs: any[],
  runtime: ReturnType<MetricsService['snapshot']>,
): PlatformProviderMetric[] {
  const groups = new Map<string, MetricAccumulator>();
  for (const event of events) {
    const payload = asObject(event.payload);
    const component = eventComponent(event.type);
    const provider = eventProvider(event.type, payload);
    addMetric(groups, component, provider, {
      success: !isFailedEvent(event.type, payload),
      latencyMs: latencyFromPayload(payload),
      createdAt: event.createdAt,
    });
  }
  for (const log of toolLogs) {
    addMetric(groups, 'tool', log.connector?.name ?? endpointHost(log.endpoint) ?? 'tool', {
      success: log.status === 'success',
      latencyMs: Number(log.durationMs ?? 0),
      createdAt: log.createdAt,
    });
  }
  for (const [name, duration] of Object.entries(runtime.durations)) {
    if (name.startsWith('scheduler.')) {
      addMetric(groups, 'scheduler', 'scheduler', {
        success: true,
        latencyMs: duration.lastMs,
        createdAt: runtime.capturedAt,
      });
    }
    if (name.startsWith('outbox.')) {
      addMetric(groups, 'scheduler', 'outbox', {
        success: true,
        latencyMs: duration.lastMs,
        createdAt: runtime.capturedAt,
      });
    }
  }
  ensureConfiguredProvider(groups, 'stt', envProvider('STT_PROVIDER', 'mock'));
  ensureConfiguredProvider(groups, 'llm', envProvider('LLM_PROVIDER', 'mock'));
  ensureConfiguredProvider(groups, 'tts', envProvider('TTS_PROVIDER', 'mock'));

  return [...groups.values()]
    .map((item) => {
      const successRate = rate(item.successCount, item.eventCount);
      const errorRate = rate(item.errorCount, item.eventCount);
      return {
        component: item.component,
        provider: item.provider,
        eventCount: item.eventCount,
        successCount: item.successCount,
        errorCount: item.errorCount,
        successRate,
        errorRate,
        avgLatencyMs: avg(item.latencies),
        p95LatencyMs: p95(item.latencies),
        lastEventAt: item.lastEventAt?.toISOString(),
        status: statusFromMetric(errorRate, item.eventCount),
      };
    })
    .sort((a, b) => b.eventCount - a.eventCount || a.component.localeCompare(b.component));
}

function buildObservabilitySummary(
  providers: PlatformProviderMetric[],
  activeCalls: number,
  schedulerBacklog: number,
  toolLogs: any[],
): ObservabilityOverview['summary'] {
  const totalEvents = providers.reduce((sum, item) => sum + item.eventCount, 0);
  const successes = providers.reduce((sum, item) => sum + item.successCount, 0);
  const errors = providers.reduce((sum, item) => sum + item.errorCount, 0);
  const latencyEvents = providers.filter((item) => item.avgLatencyMs > 0 && item.eventCount > 0);
  return {
    totalEvents,
    successRate: rate(successes, totalEvents),
    errorRate: rate(errors, totalEvents),
    avgLatencyMs: latencyEvents.length
      ? Math.round(latencyEvents.reduce((sum, item) => sum + item.avgLatencyMs, 0) / latencyEvents.length)
      : 0,
    activeCalls,
    schedulerBacklog,
    toolFailureRate: rate(toolLogs.filter((log) => log.status !== 'success').length, toolLogs.length),
  };
}

function buildAlerts(
  providers: PlatformProviderMetric[],
  checks: PlatformHealthCheck[],
  activeCalls: number,
  schedulerBacklog: number,
): PlatformAlert[] {
  const now = new Date().toISOString();
  const alerts: PlatformAlert[] = [];
  for (const check of checks) {
    if (check.status === 'down' || check.status === 'degraded') {
      alerts.push({
        id: `health-${check.component}-${check.name}`,
        severity: check.status === 'down' ? 'critical' : 'warning',
        source: check.component,
        title: `${check.name} ${check.status}`,
        description: check.message,
        action: check.action ?? 'Review provider configuration.',
        createdAt: now,
      });
    }
  }
  for (const provider of providers) {
    if (provider.eventCount >= 5 && provider.errorRate >= 20) {
      alerts.push({
        id: `provider-${provider.component}-${provider.provider}`,
        severity: provider.errorRate >= 50 ? 'critical' : 'warning',
        source: provider.component,
        title: `${provider.provider} error rate ${provider.errorRate}%`,
        description: `${provider.errorCount}/${provider.eventCount} recent events failed.`,
        action: 'Inspect recent errors and consider provider fallback or throttling.',
        createdAt: now,
      });
    }
  }
  if (schedulerBacklog > Math.max(10, activeCalls * 5)) {
    alerts.push({
      id: 'scheduler-backlog',
      severity: 'warning',
      source: 'scheduler',
      title: 'Scheduler backlog is growing',
      description: `${schedulerBacklog} pending outbox events are waiting for delivery.`,
      action: 'Check outbox worker and FreeSWITCH connectivity.',
      createdAt: now,
    });
  }
  return alerts.slice(0, 12);
}

function buildRecentErrors(events: any[], toolLogs: any[]): ObservabilityOverview['recentErrors'] {
  const callErrors = events
    .filter((event) => isFailedEvent(event.type, asObject(event.payload)))
    .map((event) => ({
      id: event.id,
      source: eventComponent(event.type),
      message: errorMessage(event.type, asObject(event.payload)),
      createdAt: toIso(event.createdAt),
    }));
  const toolErrors = toolLogs
    .filter((log) => log.status !== 'success')
    .map((log) => ({
      id: log.id,
      source: 'tool' as PlatformComponent,
      message: log.errorMessage ?? log.errorCode ?? `${log.endpoint} failed`,
      createdAt: toIso(log.createdAt),
    }));
  return [...callErrors, ...toolErrors]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10);
}

function addMetric(
  groups: Map<string, MetricAccumulator>,
  component: PlatformComponent,
  provider: string,
  input: { success: boolean; latencyMs?: number; createdAt?: Date | string },
): void {
  const key = `${component}:${provider}`;
  const current = groups.get(key) ?? {
    component,
    provider,
    eventCount: 0,
    successCount: 0,
    errorCount: 0,
    latencies: [],
  };
  current.eventCount += 1;
  if (input.success) current.successCount += 1;
  else current.errorCount += 1;
  if (input.latencyMs && input.latencyMs > 0) current.latencies.push(input.latencyMs);
  const at = dateValue(input.createdAt);
  if (at && (!current.lastEventAt || at > current.lastEventAt)) current.lastEventAt = at;
  groups.set(key, current);
}

function ensureConfiguredProvider(
  groups: Map<string, MetricAccumulator>,
  component: PlatformComponent,
  provider: string,
): void {
  const key = `${component}:${provider}`;
  if (!groups.has(key)) {
    groups.set(key, {
      component,
      provider,
      eventCount: 0,
      successCount: 0,
      errorCount: 0,
      latencies: [],
    });
  }
}

function eventComponent(type: string): PlatformComponent {
  if (type.startsWith('action.')) return 'tool';
  if (type.startsWith('call.dispatch')) return 'scheduler';
  if (type === 'call.provider_event' || type.startsWith('call.')) return 'telephony';
  return 'scheduler';
}

function eventProvider(type: string, payload: Record<string, unknown>): string {
  if (type === 'call.provider_event') return stringValue(payload.provider) ?? 'freeswitch';
  if (type.startsWith('action.')) return type.split('.')[1] ?? 'tool';
  if (type.startsWith('call.dispatch')) return 'outbox';
  return 'platform';
}

function isFailedEvent(type: string, payload: Record<string, unknown>): boolean {
  const eventType = stringValue(payload.eventType)?.toLowerCase() ?? '';
  const hangupCause = stringValue(payload.hangupCause)?.toUpperCase();
  return (
    type.endsWith('.failed') ||
    type.endsWith('.retrying') ||
    Boolean(payload.error || payload.hangupError) ||
    eventType.includes('error') ||
    eventType.includes('fail') ||
    Boolean(hangupCause && !['NORMAL_CLEARING', 'ORIGINATOR_CANCEL'].includes(hangupCause))
  );
}

function errorMessage(type: string, payload: Record<string, unknown>): string {
  return stringValue(payload.error) ??
    stringValue(payload.hangupError) ??
    stringValue(payload.hangupCause) ??
    stringValue(payload.eventType) ??
    type;
}

function latencyFromPayload(payload: Record<string, unknown>): number {
  const raw = asObject(payload.raw);
  return numberValue(payload.latencyMs) ||
    numberValue(payload.durationMs) ||
    numberValue(payload.elapsedMs) ||
    numberValue(raw.latencyMs) ||
    numberValue(raw.duration_ms);
}

function statusFromMetric(errorRate: number, eventCount: number): PlatformHealthStatus {
  if (eventCount === 0) return 'unknown';
  if (errorRate >= 50) return 'down';
  if (errorRate >= 10) return 'degraded';
  return 'healthy';
}
