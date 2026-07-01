import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CallOutcome,
  SCENARIO_CONFIGS,
  Scenario,
  TaskStatus,
} from '@ai-call/shared';
import type {
  CreateTaskDto,
  OutboundTask,
  TaskFlowVersion,
  TranscriptTurn,
} from '@ai-call/shared';
import { FreeSwitchService } from '../freeswitch/freeswitch.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskFlowsService } from '../task-flows/task-flows.service.js';

type TaskRecord = {
  id: string;
  to: string;
  from: string;
  scenario: string;
  variables: unknown;
  status: string;
  scheduledAt: Date;
  calledAt: Date | null;
  endedAt: Date | null;
  duration: number | null;
  outcome: string | null;
  recordingUrl: string | null;
  intentTags: string[];
  flowId: string | null;
  flowVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  transcripts?: Array<{
    role: string;
    content: string;
    timestamp: number;
    emotion: string | null;
  }>;
  flowVersion?: {
    id: string;
    flowId: string;
    version: number;
    name: string;
    description: string;
    nodes: unknown;
    edges: unknown;
    createdAt: Date;
  } | null;
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
  [TaskStatus.FAILED]: new Set(),
  [TaskStatus.NO_ANSWER]: new Set(),
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
    return this.toDomain(record as TaskRecord);
  }

  async list(filter: {
    scenario?: Scenario;
    status?: TaskStatus;
    outcome?: CallOutcome;
  }): Promise<OutboundTask[]> {
    const records = await this.prisma.outboundTask.findMany({
      where: {
        scenario: filter.scenario,
        status: filter.status,
        outcome: filter.outcome,
      },
      include: this.detailInclude,
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => this.toDomain(record as TaskRecord));
  }

  async get(id: string): Promise<OutboundTask> {
    const record = await this.prisma.outboundTask.findUnique({
      where: { id },
      include: this.detailInclude,
    });
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    return this.toDomain(record as TaskRecord);
  }

  async updateStatus(id: string, status: TaskStatus): Promise<OutboundTask> {
    const current = await this.get(id);
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

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundTask.update({
        where: { id },
        data: { status, calledAt, endedAt, duration },
        include: this.detailInclude,
      });
      await tx.callEvent.create({
        data: { taskId: id, type: 'task.status_changed', payload: { from: current.status, to: status } as never },
      });
      return updated;
    });
    return this.toDomain(record as TaskRecord);
  }

  async appendTranscript(
    id: string,
    turn: TranscriptTurn,
    idempotencyKey?: string,
  ): Promise<OutboundTask> {
    await this.ensureExists(id);
    const record = await this.prisma.$transaction(async (tx) => {
      const existing = idempotencyKey
        ? await tx.transcriptTurn.findUnique({
            where: { taskId_externalId: { taskId: id, externalId: idempotencyKey } },
          })
        : null;
      if (!existing) {
        await tx.transcriptTurn.create({
          data: {
            taskId: id,
            role: turn.role,
            content: turn.content,
            timestamp: turn.timestamp,
            emotion: turn.emotion,
            externalId: idempotencyKey,
          },
        });
      }
      if (!existing) {
        await tx.callEvent.create({
          data: { taskId: id, type: 'transcript.appended', payload: { role: turn.role } as never },
        });
      }
      return tx.outboundTask.findUniqueOrThrow({ where: { id }, include: this.detailInclude });
    });
    return this.toDomain(record as TaskRecord);
  }

  async setOutcome(id: string, outcome: CallOutcome, tags?: string[]): Promise<OutboundTask> {
    await this.ensureExists(id);
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundTask.update({
        where: { id },
        data: { outcome, intentTags: tags },
        include: this.detailInclude,
      });
      await tx.callEvent.create({
        data: { taskId: id, type: 'call.outcome_set', payload: { outcome, tags } as never },
      });
      return updated;
    });
    return this.toDomain(record as TaskRecord);
  }

  async hangup(
    id: string,
    body: { outcome?: CallOutcome; tags?: string[] } = {},
  ): Promise<OutboundTask> {
    const current = await this.get(id);
    const now = new Date();
    const duration = current.calledAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(current.calledAt)) / 1000))
      : undefined;
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundTask.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
          endedAt: now,
          duration,
          outcome: body.outcome,
          intentTags: body.tags,
        },
        include: this.detailInclude,
      });
      await tx.callEvent.create({
        data: { taskId: id, type: 'call.hung_up', payload: { outcome: body.outcome, duration } as never },
      });
      return updated;
    });
    return this.toDomain(record as TaskRecord);
  }

  /** 将派发请求与状态变更写入同一事务，由 outbox worker 可靠执行。 */
  async dispatch(id: string): Promise<OutboundTask> {
    const task = await this.get(id);
    if (!STATUS_TRANSITIONS[task.status].has(TaskStatus.CALLING)) {
      throw new ConflictException(`Task ${id} cannot be dispatched from ${task.status}`);
    }
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundTask.update({
        where: { id },
        data: { status: TaskStatus.CALLING },
        include: this.detailInclude,
      });
      await tx.callEvent.create({
        data: { taskId: id, type: 'call.dispatch_requested', payload: {} as never },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'OutboundTask',
          aggregateId: id,
          type: 'call.dispatch_requested',
          payload: { taskId: id, to: task.to, from: task.from } as never,
        },
      });
      return updated;
    });
    return this.toDomain(record as TaskRecord);
  }

  async transferToHuman(id: string, extension = '9000'): Promise<void> {
    await this.ensureExists(id);
    await this.freeswitch.transfer(id, extension);
    await this.prisma.callEvent.create({
      data: { taskId: id, type: 'call.transferred', payload: { extension } as never },
    });
    this.logger.log(`transfer task=${id} to extension=${extension}`);
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.outboundTask.delete({ where: { id } });
  }

  private readonly detailInclude = {
    transcripts: { orderBy: { createdAt: 'asc' as const } },
    flowVersion: true,
  };

  private async ensureExists(id: string): Promise<void> {
    const count = await this.prisma.outboundTask.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Task ${id} not found`);
  }

  private toDomain(record: TaskRecord): OutboundTask {
    const flowVersion: TaskFlowVersion | undefined = record.flowVersion
      ? {
          ...record.flowVersion,
          nodes: record.flowVersion.nodes as TaskFlowVersion['nodes'],
          edges: record.flowVersion.edges as TaskFlowVersion['edges'],
          createdAt: record.flowVersion.createdAt.toISOString(),
        }
      : undefined;
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
      flowId: record.flowId ?? undefined,
      flowVersionId: record.flowVersionId ?? undefined,
      flowVersion,
      transcript: (record.transcripts ?? []).map((turn) => ({
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
