import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CallOutcome,
  SCENARIO_CONFIGS,
  Scenario,
  TaskStatus,
} from '@ai-call/shared';
import type {
  CallAttempt,
  CreateTaskDto,
  OutboundTask,
  OutboundTaskListItem,
  TaskFlowVersion,
  TaskListPage,
  TranscriptTurn,
} from '@ai-call/shared';
import { FreeSwitchService } from '../freeswitch/freeswitch.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskFlowsService } from '../task-flows/task-flows.service.js';

type ResolvedContext = {
  taskId: string;
  attemptId?: string;
  providerCallId?: string;
};

const TERMINAL_STATUSES = new Set<TaskStatus>([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.NO_ANSWER,
  TaskStatus.CANCELLED,
]);

const STATUS_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  [TaskStatus.PENDING]: new Set([TaskStatus.CALLING, TaskStatus.CANCELLED, TaskStatus.FAILED]),
  [TaskStatus.CALLING]: new Set([TaskStatus.IN_CALL, TaskStatus.NO_ANSWER, TaskStatus.FAILED, TaskStatus.CANCELLED]),
  [TaskStatus.IN_CALL]: new Set([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]),
  [TaskStatus.COMPLETED]: new Set(),
  [TaskStatus.FAILED]: new Set([TaskStatus.CALLING]),
  [TaskStatus.NO_ANSWER]: new Set([TaskStatus.CALLING]),
  [TaskStatus.CANCELLED]: new Set(),
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskFlows: TaskFlowsService,
    private readonly freeswitch: FreeSwitchService,
  ) {}

  async create(dto: CreateTaskDto): Promise<OutboundTask> {
    const flowVersion = dto.flowId
      ? await this.taskFlows.resolvePublishedVersion(dto.flowId)
      : undefined;
    const record = await this.prisma.outboundTask.create({
      data: {
        to: dto.to,
        from: process.env.FROM_NUMBER ?? '+10000000000',
        scenario: dto.scenario,
        variables: (dto.variables ?? {}) as never,
        status: TaskStatus.PENDING,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
        flowId: dto.flowId,
        flowVersionId: flowVersion?.id,
        events: {
          create: { type: 'task.created', payload: { flowVersionId: flowVersion?.id } as never },
        },
      },
      include: this.detailInclude,
    });
    return this.toDomain(record);
  }

  async list(filter: {
    scenario?: Scenario;
    status?: TaskStatus;
    outcome?: CallOutcome;
    cursor?: string;
    limit?: number;
  }): Promise<TaskListPage> {
    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const records = await this.prisma.outboundTask.findMany({
      where: {
        scenario: filter.scenario,
        status: filter.status,
        outcome: filter.outcome,
      },
      select: this.listSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  async get(id: string): Promise<OutboundTask> {
    const record = await this.prisma.outboundTask.findUnique({
      where: { id },
      include: this.detailInclude,
    });
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    return this.toDomain(record);
  }

  /** Voice Agent 可使用 taskId、attemptId 或 providerCallId 获取同一任务上下文。 */
  async getContext(id: string): Promise<OutboundTask> {
    const context = await this.resolveContext(id);
    return this.get(context.taskId);
  }

  async updateStatus(id: string, status: TaskStatus): Promise<OutboundTask> {
    const context = await this.resolveContext(id);
    const current = await this.get(context.taskId);
    if (current.status === status) return current;
    if (!STATUS_TRANSITIONS[current.status].has(status)) {
      throw new ConflictException(`Invalid task transition: ${current.status} -> ${status}`);
    }
    const now = new Date();
    const terminal = TERMINAL_STATUSES.has(status);
    const calledAt = status === TaskStatus.IN_CALL && !current.calledAt ? now : undefined;
    const endedAt = terminal ? now : undefined;
    const duration = terminal && current.calledAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(current.calledAt)) / 1000))
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.outboundTask.update({
        where: { id: context.taskId },
        data: { status, calledAt, endedAt, duration },
      });
      if (context.attemptId) {
        const attempt = await tx.callAttempt.findUniqueOrThrow({ where: { id: context.attemptId } });
        const attemptDuration = terminal && attempt.answeredAt
          ? Math.max(0, Math.floor((now.getTime() - attempt.answeredAt.getTime()) / 1000))
          : undefined;
        await tx.callAttempt.update({
          where: { id: context.attemptId },
          data: {
            status,
            ringingAt: status === TaskStatus.CALLING ? (attempt.ringingAt ?? now) : undefined,
            answeredAt: status === TaskStatus.IN_CALL ? (attempt.answeredAt ?? now) : undefined,
            endedAt: terminal ? now : undefined,
            duration: attemptDuration,
          },
        });
      }
      await tx.callEvent.create({
        data: {
          taskId: context.taskId,
          attemptId: context.attemptId,
          type: 'task.status_changed',
          payload: { from: current.status, to: status } as never,
        },
      });
    });
    return this.get(context.taskId);
  }

  async appendTranscript(
    id: string,
    turn: TranscriptTurn,
    idempotencyKey?: string,
  ): Promise<OutboundTask> {
    const context = await this.resolveContext(id);
    await this.prisma.$transaction(async (tx) => {
      const existing = idempotencyKey
        ? await tx.transcriptTurn.findUnique({
            where: { taskId_externalId: { taskId: context.taskId, externalId: idempotencyKey } },
          })
        : null;
      if (!existing) {
        await tx.transcriptTurn.create({
          data: {
            taskId: context.taskId,
            attemptId: context.attemptId,
            role: turn.role,
            content: turn.content,
            timestamp: turn.timestamp,
            emotion: turn.emotion,
            externalId: idempotencyKey,
          },
        });
        await tx.callEvent.create({
          data: {
            taskId: context.taskId,
            attemptId: context.attemptId,
            type: 'transcript.appended',
            payload: { role: turn.role } as never,
          },
        });
      }
    });
    return this.get(context.taskId);
  }

  async setOutcome(id: string, outcome: CallOutcome, tags?: string[]): Promise<OutboundTask> {
    const context = await this.resolveContext(id);
    await this.prisma.$transaction([
      this.prisma.outboundTask.update({
        where: { id: context.taskId },
        data: { outcome, intentTags: tags },
      }),
      this.prisma.callEvent.create({
        data: {
          taskId: context.taskId,
          attemptId: context.attemptId,
          type: 'call.outcome_set',
          payload: { outcome, tags } as never,
        },
      }),
    ]);
    return this.get(context.taskId);
  }

  async hangup(
    id: string,
    body: { outcome?: CallOutcome; tags?: string[] } = {},
  ): Promise<OutboundTask> {
    const context = await this.resolveContext(id);
    const current = await this.get(context.taskId);
    const now = new Date();
    const duration = current.calledAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(current.calledAt)) / 1000))
      : undefined;
    await this.prisma.$transaction(async (tx) => {
      await tx.outboundTask.update({
        where: { id: context.taskId },
        data: {
          status: TaskStatus.COMPLETED,
          endedAt: now,
          duration,
          outcome: body.outcome,
          intentTags: body.tags,
        },
      });
      if (context.attemptId) {
        const attempt = await tx.callAttempt.findUniqueOrThrow({ where: { id: context.attemptId } });
        await tx.callAttempt.update({
          where: { id: context.attemptId },
          data: {
            status: TaskStatus.COMPLETED,
            endedAt: now,
            duration: attempt.answeredAt
              ? Math.max(0, Math.floor((now.getTime() - attempt.answeredAt.getTime()) / 1000))
              : undefined,
          },
        });
      }
      await tx.callEvent.create({
        data: {
          taskId: context.taskId,
          attemptId: context.attemptId,
          type: 'call.hung_up',
          payload: { outcome: body.outcome, duration } as never,
        },
      });
    });
    return this.get(context.taskId);
  }

  /** 创建独立 CallAttempt，并以 attemptId 作为 FreeSWITCH UUID。 */
  async dispatch(id: string): Promise<OutboundTask> {
    const task = await this.get(id);
    if (!STATUS_TRANSITIONS[task.status].has(TaskStatus.CALLING)) {
      throw new ConflictException(`Task ${id} cannot be dispatched from ${task.status}`);
    }
    const attemptId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundTask.update({
        where: { id },
        data: { status: TaskStatus.CALLING, attemptCount: { increment: 1 } },
      });
      await tx.callAttempt.create({
        data: {
          id: attemptId,
          taskId: id,
          attemptNo: updated.attemptCount,
          providerCallId: attemptId,
          status: TaskStatus.CALLING,
        },
      });
      await tx.callEvent.create({
        data: { taskId: id, attemptId, type: 'call.dispatch_requested', payload: {} as never },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CallAttempt',
          aggregateId: attemptId,
          type: 'call.dispatch_requested',
          deduplicationKey: `call.dispatch:${attemptId}`,
          payload: { taskId: id, attemptId, to: task.to, from: task.from } as never,
        },
      });
    });
    return this.get(id);
  }

  async transferToHuman(id: string, extension = '9000'): Promise<void> {
    const context = await this.resolveContext(id, true);
    const channelId = context.providerCallId ?? context.attemptId ?? context.taskId;
    await this.freeswitch.transfer(channelId, extension);
    await this.prisma.callEvent.create({
      data: {
        taskId: context.taskId,
        attemptId: context.attemptId,
        type: 'call.transferred',
        payload: { extension, channelId } as never,
      },
    });
    this.logger.log(`transfer task=${context.taskId} attempt=${context.attemptId ?? '-'} to=${extension}`);
  }

  async enqueueAction(
    id: string,
    actionType: 'sms' | 'api',
    config: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ accepted: true; eventId: string }> {
    const context = await this.resolveContext(id);
    const task = await this.prisma.outboundTask.findUniqueOrThrow({
      where: { id: context.taskId },
      select: { to: true },
    });
    const deduplicationKey = idempotencyKey ?? `flow.action:${randomUUID()}`;
    const existing = await this.prisma.outboxEvent.findUnique({
      where: { deduplicationKey },
      select: { id: true },
    });
    if (existing) return { accepted: true, eventId: existing.id };

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.outboxEvent.create({
        data: {
          aggregateType: 'CallAttempt',
          aggregateId: context.attemptId ?? context.taskId,
          type: `action.${actionType}`,
          deduplicationKey,
          payload: {
            taskId: context.taskId,
            attemptId: context.attemptId,
            to: task.to,
            config,
          } as never,
        },
      });
      await tx.callEvent.create({
        data: {
          taskId: context.taskId,
          attemptId: context.attemptId,
          type: `action.${actionType}.requested`,
          payload: { outboxEventId: created.id } as never,
        },
      });
      return created;
    });
    return { accepted: true, eventId: event.id };
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.outboundTask.delete({ where: { id } });
  }

  private readonly detailInclude = {
    transcripts: { orderBy: { createdAt: 'asc' as const } },
    flowVersion: true,
    attempts: { orderBy: { attemptNo: 'desc' as const } },
  };

  private readonly listSelect = {
    id: true,
    to: true,
    from: true,
    scenario: true,
    status: true,
    scheduledAt: true,
    calledAt: true,
    endedAt: true,
    duration: true,
    outcome: true,
    intentTags: true,
    flowId: true,
    flowVersionId: true,
    attemptCount: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { transcripts: true } },
  };

  private async resolveContext(id: string, preferActiveAttempt = false): Promise<ResolvedContext> {
    const task = await this.prisma.outboundTask.findUnique({
      where: { id },
      select: { id: true },
    });
    if (task) {
      if (preferActiveAttempt) {
        const attempt = await this.prisma.callAttempt.findFirst({
          where: { taskId: id },
          orderBy: { attemptNo: 'desc' },
          select: { id: true, providerCallId: true },
        });
        return {
          taskId: id,
          attemptId: attempt?.id,
          providerCallId: attempt?.providerCallId ?? undefined,
        };
      }
      return { taskId: id };
    }
    const attempt = await this.prisma.callAttempt.findFirst({
      where: { OR: [{ id }, { providerCallId: id }] },
      select: { id: true, taskId: true, providerCallId: true },
    });
    if (!attempt) throw new NotFoundException(`Task or CallAttempt ${id} not found`);
    return {
      taskId: attempt.taskId,
      attemptId: attempt.id,
      providerCallId: attempt.providerCallId ?? undefined,
    };
  }

  private toListItem(record: any): OutboundTaskListItem {
    return {
      id: record.id,
      to: record.to,
      from: record.from,
      scenario: record.scenario as Scenario,
      status: record.status as TaskStatus,
      scheduledAt: record.scheduledAt.toISOString(),
      calledAt: record.calledAt?.toISOString(),
      endedAt: record.endedAt?.toISOString(),
      duration: record.duration ?? undefined,
      outcome: (record.outcome as CallOutcome | null) ?? undefined,
      intentTags: record.intentTags,
      flowId: record.flowId ?? undefined,
      flowVersionId: record.flowVersionId ?? undefined,
      attemptCount: record.attemptCount,
      transcriptCount: record._count.transcripts,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toDomain(record: any): OutboundTask {
    const flowVersion: TaskFlowVersion | undefined = record.flowVersion
      ? {
          ...record.flowVersion,
          nodes: record.flowVersion.nodes as TaskFlowVersion['nodes'],
          edges: record.flowVersion.edges as TaskFlowVersion['edges'],
          createdAt: record.flowVersion.createdAt.toISOString(),
        }
      : undefined;
    const attempts: CallAttempt[] = (record.attempts ?? []).map((attempt: any) => ({
      id: attempt.id,
      taskId: attempt.taskId,
      attemptNo: attempt.attemptNo,
      providerCallId: attempt.providerCallId ?? undefined,
      status: attempt.status as TaskStatus,
      startedAt: attempt.startedAt.toISOString(),
      ringingAt: attempt.ringingAt?.toISOString(),
      answeredAt: attempt.answeredAt?.toISOString(),
      endedAt: attempt.endedAt?.toISOString(),
      duration: attempt.duration ?? undefined,
      hangupCause: attempt.hangupCause ?? undefined,
      recordingUrl: attempt.recordingUrl ?? undefined,
    }));
    return {
      id: record.id,
      to: record.to,
      from: record.from,
      scenario: record.scenario as Scenario,
      scenarioConfig: SCENARIO_CONFIGS[record.scenario as Scenario],
      variables: record.variables as Record<string, string>,
      status: record.status as TaskStatus,
      scheduledAt: record.scheduledAt.toISOString(),
      calledAt: record.calledAt?.toISOString(),
      endedAt: record.endedAt?.toISOString(),
      duration: record.duration ?? undefined,
      outcome: (record.outcome as CallOutcome | null) ?? undefined,
      recordingUrl: record.recordingUrl ?? undefined,
      intentTags: record.intentTags,
      attemptCount: record.attemptCount,
      attempts,
      flowId: record.flowId ?? undefined,
      flowVersionId: record.flowVersionId ?? undefined,
      flowVersion,
      transcript: (record.transcripts ?? []).map((turn: any) => ({
        role: turn.role as TranscriptTurn['role'],
        content: turn.content,
        timestamp: turn.timestamp,
        emotion: turn.emotion ?? undefined,
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
