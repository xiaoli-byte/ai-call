import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CallOutcome,
  SCENARIO_CONFIGS,
  Scenario,
  TaskPriority,
  TaskStatus,
} from '@ai-call/shared';
import type {
  CallAttempt,
  CreateTaskBatchDto,
  CreateTaskDto,
  OutboundTask,
  OutboundTaskListItem,
  ScenarioConfig,
  TaskBatchCreateResult,
  TaskFlowVersion,
  TaskListPage,
  TranscriptTurn,
} from '@ai-call/shared';
import { FreeSwitchService } from '../freeswitch/freeswitch.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskFlowsService } from '../task-flows/task-flows.service.js';
import { ScenariosService } from '../scenarios/scenarios.service.js';
import { GlobalConfigService } from '../global-config/global-config.service.js';
import { callEventPayload, outboxPayload, toPrismaJson } from './task-payloads.js';
import type { ProviderCallEventDto } from './dto/provider-call-event.dto.js';

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

const NO_ANSWER_HANGUP_CAUSES = new Set([
  'NO_ANSWER',
  'NO_USER_RESPONSE',
  'USER_BUSY',
  'CALL_REJECTED',
  'ORIGINATOR_CANCEL',
  'SUBSCRIBER_ABSENT',
  'UNALLOCATED_NUMBER',
]);

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  [TaskPriority.HIGH]: 3,
  [TaskPriority.NORMAL]: 2,
  [TaskPriority.LOW]: 1,
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskFlows: TaskFlowsService,
    private readonly scenarios: ScenariosService,
    private readonly freeswitch: FreeSwitchService,
    @Optional() private readonly globalConfig?: GlobalConfigService,
  ) {}

  async create(dto: CreateTaskDto): Promise<OutboundTask> {
    const flowVersion = dto.flowId
      ? await this.taskFlows.resolvePublishedVersion(dto.flowId)
      : undefined;
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
    await this.assertOutboundPolicyAllowed(dto.to, scheduledAt);
    const scenarioConfig = await this.resolveCreateScenario(dto, flowVersion);
    const scenarioId = scenarioConfig?.id ?? dto.scenarioId ?? flowVersion?.scenarioId;
    const priority = normalizeTaskPriority(dto.priority ?? dto.variables?.taskPriority ?? dto.variables?.priority);
    const variablesInput = { ...(dto.variables ?? {}), taskPriority: priority };
    const variables = this.globalConfig
      ? await this.globalConfig.mergeDefaultVariables(variablesInput)
      : variablesInput;
    const record = await this.prisma.outboundTask.create({
      data: {
        to: dto.to,
        from: process.env.FROM_NUMBER ?? '+10000000000',
        scenario: scenarioConfig?.scenario ?? dto.scenario,
        scenarioId,
        variables: toPrismaJson(variables),
        status: TaskStatus.PENDING,
        scheduledAt,
        campaignId: dto.campaignId,
        campaignLeadId: dto.campaignLeadId,
        flowId: dto.flowId,
        flowVersionId: flowVersion?.id,
        events: {
          create: {
            type: 'task.created',
            payload: callEventPayload('task.created', { flowVersionId: flowVersion?.id }),
          },
        },
      },
      include: this.detailInclude,
    });
    return this.toDomain(record);
  }

  async createBatch(dto: CreateTaskBatchDto): Promise<TaskBatchCreateResult> {
    const sortedItems = [...dto.items].sort((a, b) => (
      PRIORITY_WEIGHT[normalizeTaskPriority(b.priority ?? b.variables?.taskPriority ?? b.variables?.priority ?? dto.priority)] -
      PRIORITY_WEIGHT[normalizeTaskPriority(a.priority ?? a.variables?.taskPriority ?? a.variables?.priority ?? dto.priority)]
    ));
    const tasks: OutboundTask[] = [];

    for (const item of sortedItems) {
      const variables = {
        ...(dto.variables ?? {}),
        ...(item.variables ?? {}),
      };
      tasks.push(await this.create({
        to: item.to,
        scenario: dto.scenario,
        scenarioId: dto.scenarioId,
        flowId: dto.flowId,
        scheduledAt: item.scheduledAt ?? dto.scheduledAt,
        priority: item.priority ?? dto.priority,
        campaignId: dto.campaignId,
        campaignLeadId: item.campaignLeadId,
        variables,
      }));
    }

    return {
      createdCount: tasks.length,
      tasks: tasks.map((task) => this.domainToListItem(task)),
    };
  }

  async list(filter: {
    scenario?: string;
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
          payload: callEventPayload('task.status_changed', { from: current.status, to: status }),
        },
      });
    });
    return this.get(context.taskId);
  }

  async recordProviderCallEvent(event: ProviderCallEventDto): Promise<OutboundTask> {
    const context = await this.resolveProviderEventContext(event);
    const eventType = normalizeProviderEventType(event.eventType);
    const occurredAt = parseProviderDate(event.occurredAt) ?? new Date();
    const providerCallId = cleanString(event.providerCallId)
      ?? context.providerCallId
      ?? rawString(event.raw, ['Unique-ID', 'Channel-Call-UUID', 'variable_uuid']);
    const hangupCause = cleanString(event.hangupCause)
      ?? rawString(event.raw, ['Hangup-Cause', 'variable_hangup_cause', 'hangup_cause']);
    const recordingPath = cleanString(event.recordingPath)
      ?? rawString(event.raw, [
        'Record-File-Path',
        'Record-File-Name',
        'variable_record_file_path',
        'record_file_path',
      ]);
    const recordingUrl = cleanString(event.recordingUrl)
      ?? (recordingPath ? this.buildRecordingUrl(recordingPath) : undefined);

    await this.prisma.$transaction(async (tx) => {
      const currentTask = await tx.outboundTask.findUnique({
        where: { id: context.taskId },
        select: { status: true, calledAt: true, endedAt: true },
      });
      if (!currentTask) throw new NotFoundException(`Task ${context.taskId} not found`);
      const currentAttempt = context.attemptId
        ? await tx.callAttempt.findUniqueOrThrow({ where: { id: context.attemptId } })
        : undefined;
      const taskUpdate: Record<string, unknown> = {};
      const attemptUpdate: Record<string, unknown> = {};
      const taskStatus = currentTask.status as TaskStatus;
      const attemptStatus = currentAttempt?.status as TaskStatus | undefined;

      if (isAnswerProviderEvent(eventType)) {
        if (!TERMINAL_STATUSES.has(taskStatus)) {
          taskUpdate.status = TaskStatus.IN_CALL;
          taskUpdate.calledAt = currentTask.calledAt ?? occurredAt;
        }
        if (currentAttempt && !TERMINAL_STATUSES.has(attemptStatus ?? TaskStatus.CALLING)) {
          attemptUpdate.status = TaskStatus.IN_CALL;
          attemptUpdate.answeredAt = currentAttempt.answeredAt ?? occurredAt;
        }
      }

      if (isHangupProviderEvent(eventType)) {
        const nextStatus = TERMINAL_STATUSES.has(taskStatus)
          ? taskStatus
          : deriveTerminalStatus(hangupCause, currentTask, currentAttempt);
        taskUpdate.status = nextStatus;
        taskUpdate.endedAt = currentTask.endedAt ?? occurredAt;
        taskUpdate.duration = durationSeconds(currentTask.calledAt, occurredAt);

        if (currentAttempt) {
          const nextAttemptStatus = TERMINAL_STATUSES.has(attemptStatus ?? TaskStatus.CALLING)
            ? attemptStatus
            : nextStatus;
          attemptUpdate.status = nextAttemptStatus;
          attemptUpdate.endedAt = currentAttempt.endedAt ?? occurredAt;
          attemptUpdate.duration = durationSeconds(currentAttempt.answeredAt, occurredAt);
          if (hangupCause) attemptUpdate.hangupCause = hangupCause;
        }
      }

      if (isRecordingProviderEvent(eventType) && recordingUrl) {
        taskUpdate.recordingUrl = recordingUrl;
        if (currentAttempt) attemptUpdate.recordingUrl = recordingUrl;
      }

      if (Object.keys(taskUpdate).length > 0) {
        await tx.outboundTask.update({
          where: { id: context.taskId },
          data: taskUpdate,
        });
      }
      if (context.attemptId && Object.keys(attemptUpdate).length > 0) {
        await tx.callAttempt.update({
          where: { id: context.attemptId },
          data: attemptUpdate,
        });
      }
      await tx.callEvent.create({
        data: {
          taskId: context.taskId,
          attemptId: context.attemptId,
          type: 'call.provider_event',
          payload: callEventPayload('call.provider_event', {
            provider: cleanString(event.provider) ?? 'freeswitch',
            eventType,
            taskId: context.taskId,
            attemptId: context.attemptId,
            providerCallId,
            occurredAt: occurredAt.toISOString(),
            hangupCause,
            recordingPath,
            recordingUrl,
            raw: event.raw,
          }),
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
            payload: callEventPayload('transcript.appended', { role: turn.role }),
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
          payload: callEventPayload('call.outcome_set', { outcome, tags }),
        },
      }),
    ]);
    return this.get(context.taskId);
  }

  async hangup(
    id: string,
    body: { outcome?: CallOutcome; tags?: string[] } = {},
  ): Promise<OutboundTask> {
    const context = await this.resolveContext(id, true);
    const current = await this.get(context.taskId);
    const now = new Date();
    const duration = current.calledAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(current.calledAt)) / 1000))
      : undefined;
    const channelId = context.providerCallId ?? context.attemptId;
    let hangupError: string | undefined;
    if (channelId) {
      try {
        await this.freeswitch.hangup(channelId);
      } catch (err) {
        hangupError = (err as Error).message.slice(0, 1000);
        this.logger.warn(`hangup call control failed channel=${channelId}: ${hangupError}`);
      }
    }
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
          payload: callEventPayload('call.hung_up', {
            outcome: body.outcome,
            duration,
            channelId,
            hangupError,
          }),
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
    await this.assertOutboundPolicyAllowed(task.to, new Date(), id, id);
    const attemptId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.outboundTask.updateMany({
        where: { id, status: task.status },
        data: { status: TaskStatus.CALLING, attemptCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Task ${id} was already claimed for dispatch`);
      }
      const updated = await tx.outboundTask.findUniqueOrThrow({
        where: { id },
        select: { attemptCount: true },
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
        data: {
          taskId: id,
          attemptId,
          type: 'call.dispatch_requested',
          payload: callEventPayload('call.dispatch_requested', {}),
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CallAttempt',
          aggregateId: attemptId,
          type: 'call.dispatch_requested',
          deduplicationKey: `call.dispatch:${attemptId}`,
          payload: outboxPayload('call.dispatch_requested', { taskId: id, attemptId, to: task.to, from: task.from }),
        },
      });
    });
    return this.get(id);
  }

  async dispatchDuePending(
    limit = Number(process.env.TASK_SCHEDULER_BATCH_SIZE ?? 20),
  ): Promise<{ scanned: number; dispatched: number }> {
    const records = await this.prisma.outboundTask.findMany({
      where: {
        status: TaskStatus.PENDING,
        scheduledAt: { lte: new Date() },
      },
      select: { id: true },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(100, Math.max(1, limit)),
    });

    let dispatched = 0;
    for (const record of records) {
      try {
        await this.dispatch(record.id);
        dispatched += 1;
      } catch (err) {
        if (err instanceof ConflictException) continue;
        this.logger.warn(
          `scheduled dispatch failed task=${record.id}: ${(err as Error).message}`,
        );
      }
    }
    return { scanned: records.length, dispatched };
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
        payload: callEventPayload('call.transferred', { extension, channelId }),
      },
    });
    this.logger.log(`transfer task=${context.taskId} attempt=${context.attemptId ?? '-'} to=${extension}`);
  }

  async enqueueAction(
    id: string,
    actionType: 'sms' | 'api' | 'crm',
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
          payload: outboxPayload(`action.${actionType}`, {
            taskId: context.taskId,
            attemptId: context.attemptId,
            to: task.to,
            config,
          }),
        },
      });
      await tx.callEvent.create({
        data: {
          taskId: context.taskId,
          attemptId: context.attemptId,
          type: `action.${actionType}.requested`,
          payload: callEventPayload(`action.${actionType}.requested`, { outboxEventId: created.id }),
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

  private async assertOutboundPolicyAllowed(
    to: string,
    at: Date,
    excludeTaskId?: string,
    eventTaskId?: string,
  ): Promise<void> {
    if (!this.globalConfig) return;
    const dailyCallCount = await this.countScheduledTasksForCallee(to, at, excludeTaskId);
    const decision = await this.globalConfig.evaluateOutboundPolicy({
      to,
      at,
      dailyCallCount,
    });
    if (decision.allowed === true) return;

    if (eventTaskId) {
      await this.prisma.callEvent.create({
        data: {
          taskId: eventTaskId,
          type: 'call.policy_blocked',
          payload: callEventPayload('call.policy_blocked', {
            code: decision.code,
            message: decision.message,
            details: decision.details,
          }),
        },
      }).catch((err: unknown) => {
        this.logger.warn(
          `record policy block failed task=${eventTaskId}: ${(err as Error).message}`,
        );
      });
    }

    throw new BadRequestException({
      code: decision.code,
      message: decision.message,
      details: decision.details,
    });
  }

  private async countScheduledTasksForCallee(
    to: string,
    at: Date,
    excludeTaskId?: string,
  ): Promise<number> {
    const { start, end } = localDayRange(at);
    return this.prisma.outboundTask.count({
      where: {
        to,
        scheduledAt: { gte: start, lt: end },
        status: { not: TaskStatus.CANCELLED },
        ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
      },
    });
  }

  private readonly detailInclude = {
    transcripts: { orderBy: { createdAt: 'asc' as const } },
    flowVersion: true,
    scenarioConfig: true,
    attempts: { orderBy: { attemptNo: 'desc' as const } },
  };

  private readonly listSelect = {
    id: true,
    to: true,
    from: true,
    scenario: true,
    scenarioId: true,
    variables: true,
    status: true,
    scheduledAt: true,
    calledAt: true,
    endedAt: true,
    duration: true,
    outcome: true,
    intentTags: true,
    campaignId: true,
    campaignLeadId: true,
    flowId: true,
    flowVersionId: true,
    attemptCount: true,
    attempts: {
      orderBy: { attemptNo: 'desc' as const },
      take: 1,
      select: { id: true },
    },
    createdAt: true,
    updatedAt: true,
    _count: { select: { transcripts: true } },
  };

  private async resolveCreateScenario(
    dto: CreateTaskDto,
    flowVersion?: TaskFlowVersion,
  ) {
    if (dto.scenarioId) return await this.scenarios.get(dto.scenarioId);
    if (flowVersion?.scenarioConfig) return flowVersion.scenarioConfig;
    if (flowVersion?.scenarioId) return await this.scenarios.get(flowVersion.scenarioId);
    return await this.scenarios.resolveConfig(dto.scenario);
  }

  private async resolveProviderEventContext(event: ProviderCallEventDto): Promise<ResolvedContext> {
    const providerIdentifier = cleanString(event.providerCallId) ?? cleanString(event.attemptId);
    if (providerIdentifier) {
      try {
        const context = await this.resolveContext(providerIdentifier);
        if (!event.taskId || context.taskId === event.taskId) return context;
      } catch (err) {
        if (!event.taskId) throw err;
      }
    }
    if (event.taskId) return this.resolveContext(event.taskId, true);
    throw new BadRequestException('Provider call event requires taskId, attemptId, or providerCallId');
  }

  private buildRecordingUrl(recordingPath: string): string {
    if (isPublicUrl(recordingPath)) return recordingPath;
    const publicBaseUrl = cleanString(process.env.CALL_RECORDING_PUBLIC_BASE_URL) ?? '/recordings';
    const relativePath = this.relativeRecordingPath(recordingPath);
    return joinUrlPath(publicBaseUrl, relativePath);
  }

  private relativeRecordingPath(recordingPath: string): string {
    const normalizedPath = normalizeRecordingPath(recordingPath);
    const roots = [
      process.env.FREESWITCH_SHARED_RECORDINGS_CONTAINER,
      process.env.FREESWITCH_SHARED_RECORDINGS_HOST,
    ]
      .map((value) => cleanString(value))
      .filter((value): value is string => Boolean(value))
      .map(normalizeRecordingPath);

    for (const root of roots) {
      if (normalizedPath.toLowerCase() === root.toLowerCase()) return '';
      const prefix = `${root.replace(/\/+$/, '')}/`;
      if (normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())) {
        return normalizedPath.slice(prefix.length).replace(/^\/+/, '');
      }
    }

    return normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath.replace(/^\/+/, '');
  }

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
      scenario: record.scenario,
      scenarioId: record.scenarioId ?? undefined,
      priority: normalizeTaskPriority(record.variables?.taskPriority ?? record.variables?.priority),
      status: record.status as TaskStatus,
      scheduledAt: record.scheduledAt.toISOString(),
      calledAt: record.calledAt?.toISOString(),
      endedAt: record.endedAt?.toISOString(),
      duration: record.duration ?? undefined,
      outcome: (record.outcome as CallOutcome | null) ?? undefined,
      intentTags: record.intentTags,
      campaignId: record.campaignId ?? undefined,
      campaignLeadId: record.campaignLeadId ?? undefined,
      flowId: record.flowId ?? undefined,
      flowVersionId: record.flowVersionId ?? undefined,
      attemptCount: record.attemptCount,
      latestAttemptId: record.attempts?.[0]?.id,
      transcriptCount: record._count.transcripts,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toDomain(record: any): OutboundTask {
    const flowVersion: TaskFlowVersion | undefined = record.flowVersion
      ? {
          ...record.flowVersion,
          scenarioId: record.flowVersion.scenarioId ?? undefined,
          scenarioConfig: isScenarioConfig(record.flowVersion.scenarioSnapshot)
            ? record.flowVersion.scenarioSnapshot
            : undefined,
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
      scenario: record.scenario,
      scenarioId: record.scenarioId ?? undefined,
      scenarioConfig: record.scenarioConfig
        ? this.scenarios.toDomain(record.scenarioConfig)
        : flowVersion?.scenarioConfig ?? SCENARIO_CONFIGS[record.scenario as Scenario],
      variables: record.variables as Record<string, string>,
      priority: normalizeTaskPriority(record.variables?.taskPriority ?? record.variables?.priority),
      status: record.status as TaskStatus,
      scheduledAt: record.scheduledAt.toISOString(),
      calledAt: record.calledAt?.toISOString(),
      endedAt: record.endedAt?.toISOString(),
      duration: record.duration ?? undefined,
      outcome: (record.outcome as CallOutcome | null) ?? undefined,
      recordingUrl: record.recordingUrl ?? undefined,
      intentTags: record.intentTags,
      campaignId: record.campaignId ?? undefined,
      campaignLeadId: record.campaignLeadId ?? undefined,
      attemptCount: record.attemptCount,
      attempts,
      flowId: record.flowId ?? undefined,
      flowVersionId: record.flowVersionId ?? undefined,
      flowVersion,
      transcript: (record.transcripts ?? []).map((turn: any) => ({
        id: turn.id,
        role: turn.role as TranscriptTurn['role'],
        content: turn.content,
        timestamp: turn.timestamp,
        emotion: turn.emotion ?? undefined,
        createdAt: turn.createdAt?.toISOString?.(),
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private domainToListItem(task: OutboundTask): OutboundTaskListItem {
    return {
      id: task.id,
      to: task.to,
      from: task.from,
      scenario: task.scenario,
      scenarioId: task.scenarioId,
      priority: task.priority,
      status: task.status,
      scheduledAt: task.scheduledAt,
      calledAt: task.calledAt,
      endedAt: task.endedAt,
      duration: task.duration,
      outcome: task.outcome,
      intentTags: task.intentTags,
      campaignId: task.campaignId,
      campaignLeadId: task.campaignLeadId,
      flowId: task.flowId,
      flowVersionId: task.flowVersionId,
      attemptCount: task.attemptCount,
      latestAttemptId: task.attempts?.[0]?.id,
      transcriptCount: task.transcript?.length ?? 0,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

function isScenarioConfig(value: unknown): value is ScenarioConfig {
  return value !== null && typeof value === 'object' && 'scenario' in value && 'systemPrompt' in value;
}

function normalizeTaskPriority(value: unknown): TaskPriority {
  if (value === TaskPriority.HIGH || value === 'urgent' || value === '紧急' || value === '高') {
    return TaskPriority.HIGH;
  }
  if (value === TaskPriority.LOW || value === '低') return TaskPriority.LOW;
  return TaskPriority.NORMAL;
}

function localDayRange(at: Date): { start: Date; end: Date } {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function normalizeProviderEventType(value: string): string {
  return value.trim().replace(/[\s.-]+/g, '_').toUpperCase();
}

function isAnswerProviderEvent(eventType: string): boolean {
  return eventType === 'CHANNEL_ANSWER';
}

function isHangupProviderEvent(eventType: string): boolean {
  return eventType === 'CHANNEL_HANGUP_COMPLETE' || eventType === 'CHANNEL_HANGUP';
}

function isRecordingProviderEvent(eventType: string): boolean {
  return eventType === 'RECORD_STOP' ||
    eventType === 'RECORD_AVAILABLE' ||
    eventType === 'RECORDING_AVAILABLE';
}

function deriveTerminalStatus(
  hangupCause: string | undefined,
  task: { status: string; calledAt?: Date | null },
  attempt?: { answeredAt?: Date | null },
): TaskStatus {
  const normalizedCause = cleanString(hangupCause)?.toUpperCase();
  if (normalizedCause && NO_ANSWER_HANGUP_CAUSES.has(normalizedCause)) {
    return TaskStatus.NO_ANSWER;
  }
  if (normalizedCause === 'NORMAL_CLEARING' || task.status === TaskStatus.IN_CALL || task.calledAt || attempt?.answeredAt) {
    return TaskStatus.COMPLETED;
  }
  return TaskStatus.FAILED;
}

function durationSeconds(start: Date | string | null | undefined, end: Date): number | undefined {
  const startedAt = parseProviderDate(start);
  if (!startedAt) return undefined;
  return Math.max(0, Math.floor((end.getTime() - startedAt.getTime()) / 1000));
}

function parseProviderDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function rawString(raw: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const value = cleanString(raw[key]);
    if (value) return value;
  }
  const entries = Object.entries(raw);
  for (const key of keys) {
    const match = entries.find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    const value = cleanString(match?.[1]);
    if (value) return value;
  }
  return undefined;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isPublicUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeRecordingPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function joinUrlPath(baseUrl: string, relativePath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const relative = encodeRecordingRelativePath(relativePath);
  if (!relative) return base;
  return `${base}/${relative}`;
}

function encodeRecordingRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}
