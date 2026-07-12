import { Injectable } from '@nestjs/common';
import {
  CallOutcome,
  TaskStatus,
  type AnalyticsScenarioSnapshot,
  type AnalyticsOverview,
  type AnalyticsQueryDto,
  type AnalyticsReasonBucket,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(query: AnalyticsQueryDto = {}): Promise<AnalyticsOverview> {
    const tasks = await this.prisma.outboundTask.findMany({
      where: {
        scenario: query.scenario,
        createdAt: buildDateRange(query.from, query.to),
      },
      include: {
        attempts: {
          orderBy: { attemptNo: 'desc' as const },
          select: { status: true, hangupCause: true, duration: true },
        },
      },
    });

    const dialed = tasks.filter((task: any) => isDialed(task)).length;
    const connected = tasks.filter((task: any) => isConnected(task)).length;
    const converted = tasks.filter((task: any) => isConverted(task.outcome)).length;
    const escalated = tasks.filter((task: any) => task.outcome === CallOutcome.ESCALATED).length;
    const failed = tasks.filter((task: any) => isFailed(task)).length;
    const durations = tasks
      .map((task: any) => Number(task.duration ?? task.attempts?.[0]?.duration ?? 0))
      .filter((duration) => duration > 0);

    return {
      funnel: {
        totalTasks: tasks.length,
        validLeads: tasks.length,
        scheduled: tasks.filter((task: any) => task.status === TaskStatus.PENDING).length,
        dialed,
        connected,
        converted,
        escalated,
        failed,
      },
      rates: {
        connectRate: rate(connected, dialed),
        conversionRate: rate(converted, dialed),
        escalationRate: rate(escalated, dialed),
        failureRate: rate(failed, dialed),
      },
      averageDurationSeconds: durations.length
        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
        : 0,
      failureReasons: buildBuckets(tasks, failureReasonOf),
      outcomeBuckets: buildBuckets(tasks, (task: any) => task.outcome ?? '未设置结果'),
      scenarios: buildScenarioSnapshots(tasks),
      generatedAt: new Date().toISOString(),
    };
  }
}

function buildDateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
}

function isDialed(task: any): boolean {
  return (
    Number(task.attemptCount ?? 0) > 0 ||
    task.status === TaskStatus.CALLING ||
    task.status === TaskStatus.IN_CALL ||
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.NO_ANSWER
  );
}

function isConnected(task: any): boolean {
  return (
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.IN_CALL ||
    Number(task.duration ?? 0) > 0
  );
}

function isFailed(task: any): boolean {
  return (
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.NO_ANSWER ||
    task.status === TaskStatus.CANCELLED
  );
}

function isConverted(outcome?: string | null): boolean {
  return outcome === CallOutcome.HIGH_INTENT || outcome === CallOutcome.MEDIUM_INTENT;
}

function failureReasonOf(task: any): string | undefined {
  if (!isFailed(task)) return undefined;
  const latest = task.attempts?.[0];
  if (latest?.hangupCause) return String(latest.hangupCause);
  if (task.status === TaskStatus.NO_ANSWER) return 'NO_ANSWER';
  if (task.status === TaskStatus.CANCELLED) return 'POLICY_OR_MANUAL_CANCELLED';
  return 'FAILED';
}

function buildBuckets(tasks: any[], pick: (task: any) => string | undefined): AnalyticsReasonBucket[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const key = pick(task);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, item) => sum + item, 0);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, rate: rate(count, total) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function buildScenarioSnapshots(tasks: any[]): AnalyticsScenarioSnapshot[] {
  const groups = new Map<string, any[]>();
  for (const task of tasks) {
    const key = task.scenario;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([scenario, records]) => {
    const dialed = records.filter(isDialed).length;
    const connected = records.filter(isConnected).length;
    const converted = records.filter((task) => isConverted(task.outcome)).length;
    return {
      scenario,
      totalTasks: records.length,
      dialed,
      connected,
      converted,
      connectRate: rate(connected, dialed),
      conversionRate: rate(converted, dialed),
    };
  });
}

function rate(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}
