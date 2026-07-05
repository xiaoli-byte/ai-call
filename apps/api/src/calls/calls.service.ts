import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CallOutcome,
  TaskStatus,
  type CallEventRecord,
  type CallHistoryDetail,
  type CallHistoryItem,
  type CallHistoryPage,
  type ScenarioKey,
  type TranscriptTurn,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: {
    scenario?: ScenarioKey;
    status?: TaskStatus;
    outcome?: CallOutcome;
    cursor?: string;
    limit?: number;
  }): Promise<CallHistoryPage> {
    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const records = await this.prisma.callAttempt.findMany({
      where: {
        status: filter.status,
        task: {
          scenario: filter.scenario,
          outcome: filter.outcome,
        },
      },
      include: this.listInclude,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = records.length > limit;
    const pageRecords = hasMore ? records.slice(0, limit) : records;
    return {
      items: pageRecords.map((record) => this.toListItem(record)),
      nextCursor: hasMore ? pageRecords.at(-1)?.id : undefined,
    };
  }

  async get(id: string): Promise<CallHistoryDetail> {
    const record = await this.prisma.callAttempt.findFirst({
      where: { OR: [{ id }, { providerCallId: id }] },
      include: this.detailInclude,
    });
    if (!record) throw new NotFoundException(`CallAttempt ${id} not found`);
    return this.toDetail(record);
  }

  private readonly listInclude = {
    task: {
      select: {
        id: true,
        to: true,
        from: true,
        scenario: true,
        scenarioId: true,
        outcome: true,
        intentTags: true,
        createdAt: true,
      },
    },
    _count: { select: { transcripts: true, events: true } },
  };

  private readonly detailInclude = {
    task: {
      select: {
        id: true,
        to: true,
        from: true,
        scenario: true,
        scenarioId: true,
        variables: true,
        scheduledAt: true,
        outcome: true,
        intentTags: true,
        flowId: true,
        flowVersionId: true,
        createdAt: true,
      },
    },
    transcripts: { orderBy: { createdAt: 'asc' as const } },
    events: { orderBy: { createdAt: 'desc' as const } },
    _count: { select: { transcripts: true, events: true } },
  };

  private toListItem(record: any): CallHistoryItem {
    return {
      id: record.id,
      taskId: record.taskId,
      attemptNo: record.attemptNo,
      providerCallId: record.providerCallId ?? undefined,
      to: record.task.to,
      from: record.task.from,
      scenario: record.task.scenario as ScenarioKey,
      scenarioId: record.task.scenarioId ?? undefined,
      status: record.status as TaskStatus,
      startedAt: record.startedAt.toISOString(),
      ringingAt: record.ringingAt?.toISOString(),
      answeredAt: record.answeredAt?.toISOString(),
      endedAt: record.endedAt?.toISOString(),
      duration: record.duration ?? undefined,
      hangupCause: record.hangupCause ?? undefined,
      recordingUrl: record.recordingUrl ?? undefined,
      outcome: (record.task.outcome as CallOutcome | null) ?? undefined,
      intentTags: record.task.intentTags,
      transcriptCount: record._count.transcripts,
      eventCount: record._count.events,
      taskCreatedAt: record.task.createdAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toDetail(record: any): CallHistoryDetail {
    const base = this.toListItem(record);
    return {
      ...base,
      scheduledAt: record.task.scheduledAt.toISOString(),
      flowId: record.task.flowId ?? undefined,
      flowVersionId: record.task.flowVersionId ?? undefined,
      variables: record.task.variables as Record<string, string>,
      transcript: (record.transcripts ?? []).map((turn: any): TranscriptTurn => ({
        id: turn.id,
        role: turn.role as TranscriptTurn['role'],
        content: turn.content,
        timestamp: turn.timestamp,
        emotion: turn.emotion ?? undefined,
        createdAt: turn.createdAt?.toISOString?.(),
      })),
      events: (record.events ?? []).map((event: any): CallEventRecord => ({
        id: event.id,
        type: event.type,
        payload: event.payload as Record<string, unknown>,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}
