import { Injectable } from '@nestjs/common';
import type {
  CostCampaignBreakdown,
  CostOverview,
  CostProviderBreakdown,
  PlatformQueryDto,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildDateRange,
  envProvider,
  money,
  numberValue,
  toIso,
} from './platform-utils.js';

const COST_RATES = {
  telephonyPerMinuteCny: 0.08,
  sttPerMinuteCny: 0.02,
  llmPerThousandTokensCny: 0.012,
  ttsPerThousandCharsCny: 0.02,
  toolCallCny: 0.001,
};

@Injectable()
export class CostsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(query: PlatformQueryDto = {}): Promise<CostOverview> {
    const dateRange = buildDateRange(query);
    const [tasks, toolLogCount, usageAggregates] = await Promise.all([
      (this.prisma as any).outboundTask.findMany({
        where: {
          campaignId: query.campaignId,
          scenario: query.scenario,
          createdAt: dateRange,
        },
        include: {
          campaign: { select: { id: true, name: true } },
          transcripts: { select: { role: true, content: true } },
          attempts: { select: { duration: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      (this.prisma as any).toolCallLog.count({ where: { createdAt: dateRange } }),
      (this.prisma as any).usageAggregate.findMany({
        where: dateRange ? { bucketStart: dateRange } : undefined,
      }),
    ]);

    const totalSeconds = tasks.reduce((sum: number, task: any) => sum + taskDurationSeconds(task), 0);
    const connectedCalls = tasks.filter((task: any) => taskDurationSeconds(task) > 0).length;
    const transcriptStats = transcriptUsage(tasks);
    const usage = aggregateUsage(usageAggregates);
    const totalTokens = usage.llmTokens || transcriptStats.estimatedTokens;
    const sttSeconds = usage.sttSeconds || totalSeconds;
    const ttsCharacters = usage.ttsCharacters || transcriptStats.agentCharacters;

    const providers = buildProviderBreakdown({
      tasks,
      connectedCalls,
      totalSeconds,
      totalTokens,
      sttSeconds,
      ttsCharacters,
      toolLogCount,
    });
    const totalCost = money(providers.reduce((sum, item) => sum + item.cost, 0));

    return {
      generatedAt: new Date().toISOString(),
      currency: 'CNY',
      summary: {
        callCount: tasks.length,
        connectedCalls,
        totalSeconds,
        totalTokens,
        totalCost,
        avgCostPerCall: money(tasks.length ? totalCost / tasks.length : 0),
      },
      providers,
      campaigns: buildCostCampaigns(tasks),
      trend: buildCostTrend(tasks),
      assumptions: [
        `Telephony: CNY ${COST_RATES.telephonyPerMinuteCny}/minute`,
        `STT: CNY ${COST_RATES.sttPerMinuteCny}/minute`,
        `LLM: CNY ${COST_RATES.llmPerThousandTokensCny}/1K tokens`,
        `TTS: CNY ${COST_RATES.ttsPerThousandCharsCny}/1K chars`,
        'When UsageAggregate is empty, token and audio usage are estimated from transcripts and call duration.',
      ],
    };
  }
}

function buildProviderBreakdown(input: {
  tasks: any[];
  connectedCalls: number;
  totalSeconds: number;
  totalTokens: number;
  sttSeconds: number;
  ttsCharacters: number;
  toolLogCount: number;
}): CostProviderBreakdown[] {
  return [
    {
      provider: 'FreeSWITCH',
      component: 'telephony',
      calls: input.tasks.length,
      tokens: 0,
      audioSeconds: input.totalSeconds,
      toolCalls: 0,
      cost: money((input.totalSeconds / 60) * COST_RATES.telephonyPerMinuteCny),
    },
    {
      provider: envProvider('STT_PROVIDER', 'funasr'),
      component: 'stt',
      calls: input.connectedCalls,
      tokens: 0,
      audioSeconds: input.sttSeconds,
      toolCalls: 0,
      cost: money((input.sttSeconds / 60) * COST_RATES.sttPerMinuteCny),
    },
    {
      provider: envProvider('LLM_PROVIDER', 'mock'),
      component: 'llm',
      calls: input.connectedCalls,
      tokens: input.totalTokens,
      audioSeconds: 0,
      toolCalls: 0,
      cost: money((input.totalTokens / 1000) * COST_RATES.llmPerThousandTokensCny),
    },
    {
      provider: envProvider('TTS_PROVIDER', 'mock'),
      component: 'tts',
      calls: input.connectedCalls,
      tokens: input.ttsCharacters,
      audioSeconds: 0,
      toolCalls: 0,
      cost: money((input.ttsCharacters / 1000) * COST_RATES.ttsPerThousandCharsCny),
    },
    {
      provider: 'Integration tools',
      component: 'tool',
      calls: 0,
      tokens: 0,
      audioSeconds: 0,
      toolCalls: input.toolLogCount,
      cost: money(input.toolLogCount * COST_RATES.toolCallCny),
    },
  ];
}

function buildCostCampaigns(tasks: any[]): CostCampaignBreakdown[] {
  const groups = new Map<string, any[]>();
  for (const task of tasks) {
    const key = task.campaignId ?? `uncampaigned:${task.scenario}`;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((records) => {
      const seconds = records.reduce((sum, task) => sum + taskDurationSeconds(task), 0);
      const transcriptStats = transcriptUsage(records);
      const cost = estimateTaskGroupCost(records);
      const first = records[0];
      return {
        campaignId: first.campaignId ?? undefined,
        campaignName: first.campaign?.name ?? 'Unassigned campaign',
        scenario: first.scenario,
        calls: records.length,
        connectedCalls: records.filter((task) => taskDurationSeconds(task) > 0).length,
        totalSeconds: seconds,
        estimatedTokens: transcriptStats.estimatedTokens,
        cost,
        avgCostPerCall: money(records.length ? cost / records.length : 0),
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

function buildCostTrend(tasks: any[]): CostOverview['trend'] {
  const groups = new Map<string, any[]>();
  for (const task of tasks) {
    const key = toIso(task.createdAt).slice(0, 10);
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, records]) => ({
      date,
      calls: records.length,
      cost: estimateTaskGroupCost(records),
    }));
}

function estimateTaskGroupCost(tasks: any[]): number {
  const seconds = tasks.reduce((sum, task) => sum + taskDurationSeconds(task), 0);
  const transcriptStats = transcriptUsage(tasks);
  return money(
    (seconds / 60) * (COST_RATES.telephonyPerMinuteCny + COST_RATES.sttPerMinuteCny) +
    (transcriptStats.estimatedTokens / 1000) * COST_RATES.llmPerThousandTokensCny +
    (transcriptStats.agentCharacters / 1000) * COST_RATES.ttsPerThousandCharsCny,
  );
}

function taskDurationSeconds(task: any): number {
  const taskDuration = numberValue(task.duration);
  if (taskDuration > 0) return taskDuration;
  return (task.attempts ?? []).reduce((sum: number, attempt: any) => sum + numberValue(attempt.duration), 0);
}

function transcriptUsage(tasks: any[]): { estimatedTokens: number; agentCharacters: number } {
  let characters = 0;
  let agentCharacters = 0;
  for (const task of tasks) {
    for (const turn of task.transcripts ?? []) {
      const length = String(turn.content ?? '').length;
      characters += length;
      if (turn.role === 'assistant' || turn.role === 'agent') agentCharacters += length;
    }
  }
  return {
    estimatedTokens: Math.ceil(characters / 1.8),
    agentCharacters,
  };
}

function aggregateUsage(records: any[]): { llmTokens: number; sttSeconds: number; ttsCharacters: number } {
  const usage = { llmTokens: 0, sttSeconds: 0, ttsCharacters: 0 };
  for (const record of records ?? []) {
    const quantity = numberValue(record.quantity);
    if (record.metric === 'llm_tokens') usage.llmTokens += quantity;
    if (record.metric === 'stt_seconds') usage.sttSeconds += quantity;
    if (record.metric === 'tts_characters') usage.ttsCharacters += quantity;
  }
  return usage;
}
