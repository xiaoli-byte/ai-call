import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { createHash, randomUUID } from 'node:crypto';
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
import type { ProviderActiveSnapshotDto } from './dto/provider-active-snapshot.dto.js';
import {
  hasViewPerm,
  isTaskAclBypass,
  taskGrantWhere,
  taskVisibilityWhere,
  type TaskAclSubject,
} from './task-acl.js';
import type { Prisma } from '../generated/prisma/client.js';

type ResolvedContext = {
  taskId: string;
  attemptId?: string;
  providerCallId?: string;
  providerJobId?: string;
  channel?: string;
};

type ProviderAttemptContext = {
  id: string;
  taskId: string;
  attemptNo: number;
  channel: string;
  providerCallId: string | null;
  providerJobId: string | null;
  status: string;
  startedAt: Date;
  ringingAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  duration: number | null;
  hangupCause: string | null;
  recordingUrl: string | null;
  lastProviderEventAt: Date | null;
  lastProviderSnapshotId: string | null;
  lastProviderSnapshotAt: Date | null;
  missingProviderSnapshotCount: number;
};

type ResolvedProviderEventContext = {
  taskId: string;
  attempt: ProviderAttemptContext;
};

export type ProviderActiveSnapshotResult = {
  accepted: true;
  scanned: number;
  active: number;
  missing: number;
  reconciled: number;
};

export type DispatchChannel = 'freeswitch' | 'web';

export type DispatchTaskResult = OutboundTask & {
  taskId: string;
  attemptId: string;
};

type ContactAttemptHistoryData = {
  phoneNumber: string;
  phoneHash: string;
  campaignId?: string | null;
  campaignLeadId?: string | null;
  taskId?: string;
  attemptId?: string;
  status?: string;
  outcome?: string | null;
  attemptedAt: Date;
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
  'NORMAL_CLEARING',
]);

const FAILED_HANGUP_CAUSES = new Set([
  'USER_NOT_REGISTERED',
  'NO_ROUTE',
  'NO_ROUTE_DESTINATION',
  'UNALLOCATED_NUMBER',
  'INVALID_NUMBER_FORMAT',
  'DESTINATION_OUT_OF_ORDER',
  'NETWORK_OUT_OF_ORDER',
  'NORMAL_TEMPORARY_FAILURE',
  'SWITCH_CONGESTION',
  'REQUESTED_CHAN_UNAVAIL',
  'RECOVERY_ON_TIMER_EXPIRE',
  'BEARERCAPABILITY_NOTAVAIL',
  'INCOMPATIBLE_DESTINATION',
  'PROTOCOL_ERROR',
  'MEDIA_ERROR',
  'MEDIA_TIMEOUT',
  'AUDIO_FORK_ERROR',
  'BACKGROUND_JOB_FAILED',
  'EVENT_LOSS_RECONCILED',
]);

const PROVIDER_EVENT_TRANSACTION_RETRIES = 3;
const DEFAULT_PROVIDER_SNAPSHOT_GRACE_MS = 60_000;
const EVENT_LOSS_RECONCILED = 'EVENT_LOSS_RECONCILED';

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
    @Optional() private readonly cls?: ClsService,
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
        // CALL-05：记录创建人；无 CLS 用户上下文（系统/worker）时留空，
        // 该任务按 task-acl.ts 的策略对租户内 task:read 持有者可见。
        ownerId: this.cls?.get<string | undefined>('userId'),
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
    const visibility = await this.buildTaskVisibilityWhere();
    const records = await this.prisma.outboundTask.findMany({
      where: {
        AND: [
          {
            scenario: filter.scenario,
            status: filter.status,
            outcome: filter.outcome,
          },
          visibility,
        ],
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

  /**
   * CALL-05：详情端点的资源级 ACL 校验（供 controller 在 `get()` 之后调用）。
   * 未命中可见性规则时抛 404 而非 403——避免向非授权用户泄露任务是否存在。
   * 仅用于用户可见的 `GET /tasks/:id`；voice-agent 的 `/context`、worker 内部读取
   * (`getContext`/`updateStatus` 等经 `get()`) 不经过本方法，不受 ACL 收紧影响。
   */
  async assertTaskVisible(id: string): Promise<void> {
    const subject = this.aclSubject();
    if (!subject.userId || isTaskAclBypass(subject.roles)) return;
    const task = await this.prisma.outboundTask.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!task) return; // 交由调用方的 get() 统一抛 404
    if (task.ownerId == null || task.ownerId === subject.userId) return;
    const grant = await this.prisma.resourceGrant.findFirst({
      where: { ...taskGrantWhere(subject), resourceId: id },
      select: { perms: true },
    });
    if (grant && hasViewPerm(grant.perms)) return;
    throw new NotFoundException(`Task ${id} not found`);
  }

  private aclSubject(): TaskAclSubject {
    return {
      userId: this.cls?.get<string | undefined>('userId'),
      roles: this.cls?.get<string[] | undefined>('roles') ?? [],
    };
  }

  private async buildTaskVisibilityWhere(): Promise<Prisma.OutboundTaskWhereInput> {
    const subject = this.aclSubject();
    if (!subject.userId || isTaskAclBypass(subject.roles)) return {};
    const grants = await this.prisma.resourceGrant.findMany({
      where: taskGrantWhere(subject),
      select: { resourceId: true, perms: true },
    });
    const grantedIds = grants.filter((g) => hasViewPerm(g.perms)).map((g) => g.resourceId);
    return taskVisibilityWhere(subject, grantedIds);
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
    const provider = normalizeProvider(event.provider);
    const providerEventId = cleanString(event.providerEventId);
    const eventType = normalizeProviderEventType(event.eventType);
    const occurredAt = parseProviderDate(event.occurredAt) ?? new Date();
    const reportedHangupCause = normalizeHangupCause(
      cleanString(event.hangupCause)
        ?? rawString(event.raw, ['Hangup-Cause', 'variable_hangup_cause', 'hangup_cause']),
    );
    const recordingPath = cleanString(event.recordingPath)
      ?? rawString(event.raw, [
        'Record-File-Path',
        'Record-File-Name',
        'variable_record_file_path',
        'record_file_path',
      ]);
    const recordingUrl = cleanString(event.recordingUrl)
      ?? (recordingPath ? this.buildRecordingUrl(recordingPath) : undefined);
    let resolvedTaskId: string | undefined;

    try {
      resolvedTaskId = await this.runSerializableTransaction(async (tx) => {
        const context = await this.resolveProviderEventContext(event, tx);
        resolvedTaskId = context.taskId;

        if (providerEventId) {
          const duplicate = await tx.callEvent.findUnique({
            where: { provider_providerEventId: { provider, providerEventId } },
            select: { taskId: true, attemptId: true },
          });
          if (duplicate) {
            assertProviderEventIdentity(duplicate, context);
            return context.taskId;
          }
        }

        const currentAttempt = context.attempt;
        const currentTask = await tx.outboundTask.findUnique({
          where: { id: context.taskId },
          select: {
            status: true,
            calledAt: true,
            endedAt: true,
            to: true,
            campaignId: true,
            campaignLeadId: true,
            outcome: true,
            attemptCount: true,
          },
        });
        if (!currentTask) throw new NotFoundException(`Task ${context.taskId} not found`);

        const taskUpdate: Record<string, unknown> = {};
        const attemptUpdate: Record<string, unknown> = {};
        const taskStatus = currentTask.status as TaskStatus;
        const attemptStatus = currentAttempt.status as TaskStatus;
        const isLatestAttempt = currentTask.attemptCount === currentAttempt.attemptNo;
        let effectiveHangupCause = reportedHangupCause;
        let terminalHistoryStatus: TaskStatus | undefined;

        const lastProviderEventAt = parseProviderDate(currentAttempt.lastProviderEventAt);
        if (!lastProviderEventAt || occurredAt > lastProviderEventAt) {
          attemptUpdate.lastProviderEventAt = occurredAt;
        }
        const lastSnapshotAt = parseProviderDate(currentAttempt.lastProviderSnapshotAt);
        if (
          currentAttempt.missingProviderSnapshotCount > 0 &&
          (!lastSnapshotAt || occurredAt >= lastSnapshotAt)
        ) {
          attemptUpdate.missingProviderSnapshotCount = 0;
        }

        if (isProgressProviderEvent(eventType)) {
          const ringingAt = parseProviderDate(currentAttempt.ringingAt);
          if (!ringingAt || occurredAt < ringingAt) {
            attemptUpdate.ringingAt = occurredAt;
          }
        }

        if (isAnswerProviderEvent(eventType) && !TERMINAL_STATUSES.has(attemptStatus)) {
          const answeredAt = parseProviderDate(currentAttempt.answeredAt);
          attemptUpdate.status = TaskStatus.IN_CALL;
          if (!answeredAt || occurredAt < answeredAt) {
            attemptUpdate.answeredAt = occurredAt;
          }
          if (isLatestAttempt && !TERMINAL_STATUSES.has(taskStatus)) {
            const calledAt = parseProviderDate(currentTask.calledAt);
            taskUpdate.status = TaskStatus.IN_CALL;
            if (!calledAt || occurredAt < calledAt) taskUpdate.calledAt = occurredAt;
          }
        }

        const backgroundFailure = eventType === 'BACKGROUND_JOB'
          ? backgroundJobFailureCause(event.backgroundJobResult)
          : undefined;
        if (backgroundFailure && !TERMINAL_STATUSES.has(attemptStatus)) {
          effectiveHangupCause = isFatalHangupCause(reportedHangupCause)
            ? reportedHangupCause
            : backgroundFailure;
          terminalHistoryStatus = TaskStatus.FAILED;
          attemptUpdate.status = TaskStatus.FAILED;
          attemptUpdate.endedAt = currentAttempt.endedAt ?? occurredAt;
          attemptUpdate.duration = durationSeconds(currentAttempt.answeredAt, occurredAt);
          attemptUpdate.hangupCause = effectiveHangupCause;
          if (isLatestAttempt && !TERMINAL_STATUSES.has(taskStatus)) {
            taskUpdate.status = TaskStatus.FAILED;
            taskUpdate.endedAt = currentTask.endedAt ?? occurredAt;
            taskUpdate.duration = durationSeconds(currentTask.calledAt, occurredAt);
          }
        }

        if (isTerminalHangupProviderEvent(eventType) && !TERMINAL_STATUSES.has(attemptStatus)) {
          const existingFatalCause = isFatalHangupCause(currentAttempt.hangupCause)
            ? normalizeHangupCause(currentAttempt.hangupCause)
            : undefined;
          effectiveHangupCause = existingFatalCause ?? reportedHangupCause;
          const nextStatus = deriveTerminalStatus(
            effectiveHangupCause,
            Boolean(currentAttempt.answeredAt || (isLatestAttempt && currentTask.calledAt)),
          );
          terminalHistoryStatus = nextStatus;
          attemptUpdate.status = nextStatus;
          attemptUpdate.endedAt = currentAttempt.endedAt ?? occurredAt;
          attemptUpdate.duration = durationSeconds(currentAttempt.answeredAt, occurredAt);
          if (effectiveHangupCause) attemptUpdate.hangupCause = effectiveHangupCause;
          if (isLatestAttempt && !TERMINAL_STATUSES.has(taskStatus)) {
            taskUpdate.status = nextStatus;
            taskUpdate.endedAt = currentTask.endedAt ?? occurredAt;
            taskUpdate.duration = durationSeconds(currentTask.calledAt, occurredAt);
          }
        }

        if (isRecordingProviderEvent(eventType) && recordingUrl) {
          if (currentAttempt.recordingUrl !== recordingUrl) attemptUpdate.recordingUrl = recordingUrl;
          if (isLatestAttempt) taskUpdate.recordingUrl = recordingUrl;
        }

        if (Object.keys(taskUpdate).length > 0) {
          await tx.outboundTask.update({
            where: { id: context.taskId },
            data: taskUpdate,
          });
        }
        if (Object.keys(attemptUpdate).length > 0) {
          await tx.callAttempt.update({
            where: { id: currentAttempt.id },
            data: attemptUpdate,
          });
        }
        await tx.callEvent.create({
          data: {
            taskId: context.taskId,
            attemptId: currentAttempt.id,
            type: 'call.provider_event',
            provider,
            providerEventId,
            payload: callEventPayload('call.provider_event', {
              provider,
              providerEventId,
              eventType,
              taskId: context.taskId,
              attemptId: currentAttempt.id,
              providerCallId: cleanString(event.providerCallId)
                ?? currentAttempt.providerCallId
                ?? rawString(event.raw, ['Unique-ID', 'Channel-Call-UUID', 'variable_uuid']),
              jobId: cleanString(event.jobId) ?? currentAttempt.providerJobId ?? undefined,
              backgroundJobResult: cleanString(event.backgroundJobResult),
              occurredAt: occurredAt.toISOString(),
              hangupCause: effectiveHangupCause,
              recordingPath,
              recordingUrl,
              raw: event.raw,
            }),
          },
        });
        if (terminalHistoryStatus) {
          await recordContactAttemptHistory(tx, {
            phoneNumber: currentTask.to,
            phoneHash: hashPhone(currentTask.to),
            campaignId: currentTask.campaignId,
            campaignLeadId: currentTask.campaignLeadId,
            taskId: context.taskId,
            attemptId: currentAttempt.id,
            status: terminalHistoryStatus,
            outcome: effectiveHangupCause ?? currentTask.outcome,
            attemptedAt: occurredAt,
          });
        }
        return context.taskId;
      });
    } catch (error) {
      if (providerEventId && isProviderEventUniqueViolation(error)) {
        const context = await this.resolveProviderEventContext(event, this.prisma);
        const duplicate = await this.prisma.callEvent.findUnique({
          where: { provider_providerEventId: { provider, providerEventId } },
          select: { taskId: true, attemptId: true },
        });
        if (duplicate) {
          assertProviderEventIdentity(duplicate, context);
          return this.get(context.taskId);
        }
      }
      throw error;
    }

    if (!resolvedTaskId) throw new Error('Provider event transaction completed without a task');
    return this.get(resolvedTaskId);
  }

  async recordProviderActiveSnapshot(
    snapshot: ProviderActiveSnapshotDto,
  ): Promise<ProviderActiveSnapshotResult> {
    const provider = normalizeProvider(snapshot.provider);
    const snapshotId = snapshot.snapshotId.trim();
    const observedAt = parseProviderDate(snapshot.observedAt);
    if (!observedAt) throw new BadRequestException('Provider snapshot observedAt is invalid');
    const activeChannelIds = new Set(snapshot.activeChannelIds.map((id) => id.toLowerCase()));
    const graceMs = providerSnapshotGraceMs();

    return this.runSerializableTransaction(async (tx) => {
      const attempts = await tx.callAttempt.findMany({
        where: {
          channel: provider,
          status: { in: [TaskStatus.CALLING, TaskStatus.IN_CALL] },
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          taskId: true,
          attemptNo: true,
          providerCallId: true,
          status: true,
          startedAt: true,
          answeredAt: true,
          endedAt: true,
          lastProviderSnapshotId: true,
          lastProviderSnapshotAt: true,
          missingProviderSnapshotCount: true,
          task: {
            select: {
              status: true,
              calledAt: true,
              endedAt: true,
              to: true,
              campaignId: true,
              campaignLeadId: true,
              outcome: true,
              attemptCount: true,
            },
          },
        },
      });

      const result: ProviderActiveSnapshotResult = {
        accepted: true,
        scanned: attempts.length,
        active: 0,
        missing: 0,
        reconciled: 0,
      };

      for (const attempt of attempts) {
        const lastSnapshotAt = parseProviderDate(attempt.lastProviderSnapshotAt);
        if (
          attempt.lastProviderSnapshotId === snapshotId ||
          (lastSnapshotAt && observedAt <= lastSnapshotAt)
        ) {
          continue;
        }

        const snapshotUpdate: Record<string, unknown> = {
          lastProviderSnapshotId: snapshotId,
          lastProviderSnapshotAt: observedAt,
        };
        const channelId = (attempt.providerCallId ?? attempt.id).toLowerCase();
        if (activeChannelIds.has(channelId)) {
          result.active += 1;
          snapshotUpdate.missingProviderSnapshotCount = 0;
          await tx.callAttempt.update({ where: { id: attempt.id }, data: snapshotUpdate });
          continue;
        }

        const startedAt = parseProviderDate(attempt.startedAt) ?? observedAt;
        if (observedAt.getTime() - startedAt.getTime() < graceMs) {
          snapshotUpdate.missingProviderSnapshotCount = 0;
          await tx.callAttempt.update({ where: { id: attempt.id }, data: snapshotUpdate });
          continue;
        }

        result.missing += 1;
        const missingCount = attempt.missingProviderSnapshotCount + 1;
        snapshotUpdate.missingProviderSnapshotCount = missingCount;
        if (missingCount < 2) {
          await tx.callAttempt.update({ where: { id: attempt.id }, data: snapshotUpdate });
          continue;
        }

        const terminalStatus = attempt.answeredAt
          ? TaskStatus.COMPLETED
          : TaskStatus.FAILED;
        Object.assign(snapshotUpdate, {
          status: terminalStatus,
          endedAt: attempt.endedAt ?? observedAt,
          duration: durationSeconds(attempt.answeredAt, observedAt),
          hangupCause: EVENT_LOSS_RECONCILED,
        });
        await tx.callAttempt.update({ where: { id: attempt.id }, data: snapshotUpdate });

        const taskStatus = attempt.task.status as TaskStatus;
        const isLatestAttempt = attempt.task.attemptCount === attempt.attemptNo;
        if (isLatestAttempt && !TERMINAL_STATUSES.has(taskStatus)) {
          await tx.outboundTask.update({
            where: { id: attempt.taskId },
            data: {
              status: terminalStatus,
              endedAt: attempt.task.endedAt ?? observedAt,
              duration: durationSeconds(attempt.task.calledAt, observedAt),
            },
          });
        }
        await tx.callEvent.create({
          data: {
            taskId: attempt.taskId,
            attemptId: attempt.id,
            type: 'call.event_loss_reconciled',
            payload: callEventPayload('call.event_loss_reconciled', {
              snapshotId,
              status: terminalStatus,
              reason: EVENT_LOSS_RECONCILED,
            }),
          },
        });
        await recordContactAttemptHistory(tx, {
          phoneNumber: attempt.task.to,
          phoneHash: hashPhone(attempt.task.to),
          campaignId: attempt.task.campaignId,
          campaignLeadId: attempt.task.campaignLeadId,
          taskId: attempt.taskId,
          attemptId: attempt.id,
          status: terminalStatus,
          outcome: EVENT_LOSS_RECONCILED,
          attemptedAt: observedAt,
        });
        result.reconciled += 1;
      }

      return result;
    });
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
    if (TERMINAL_STATUSES.has(current.status)) return current;
    const now = new Date();
    const duration = current.calledAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(current.calledAt)) / 1000))
      : undefined;
    const channelId = context.providerCallId ?? context.attemptId;
    if (!context.attemptId || !channelId) {
      throw new ConflictException(`Task ${context.taskId} has no call attempt to hang up`);
    }

    if (context.channel !== 'web') {
      await this.prisma.$transaction(async (tx) => {
        await tx.outboundTask.update({
          where: { id: context.taskId },
          data: { outcome: body.outcome, intentTags: body.tags },
        });
        await tx.callEvent.create({
          data: {
            taskId: context.taskId,
            attemptId: context.attemptId,
            type: 'call.hangup_requested',
            payload: callEventPayload('call.hangup_requested', {
              channelId,
              outcome: body.outcome,
              tags: body.tags,
            }),
          },
        });
      });

      try {
        await this.freeswitch.hangup(channelId);
      } catch (err) {
        const hangupError = safeErrorMessage(err);
        this.logger.warn(`hangup call control failed channel=${channelId}: ${hangupError}`);
        await this.prisma.callEvent.create({
          data: {
            taskId: context.taskId,
            attemptId: context.attemptId,
            type: 'call.hangup_request_failed',
            payload: callEventPayload('call.hangup_request_failed', {
              channelId,
              error: hangupError,
            }),
          },
        });
      }
      return this.get(context.taskId);
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
          }),
        },
      });
      await recordContactAttemptHistory(tx, {
        phoneNumber: current.to,
        phoneHash: hashPhone(current.to),
        campaignId: current.campaignId,
        campaignLeadId: current.campaignLeadId,
        taskId: context.taskId,
        attemptId: context.attemptId,
        status: TaskStatus.COMPLETED,
        outcome: body.outcome,
        attemptedAt: now,
      });
    });
    return this.get(context.taskId);
  }

  /** 创建独立 CallAttempt，并以 attemptId 作为 FreeSWITCH UUID。 */
  async dispatch(id: string, channel: DispatchChannel = 'freeswitch'): Promise<DispatchTaskResult> {
    const task = await this.get(id);
    if (!STATUS_TRANSITIONS[task.status].has(TaskStatus.CALLING)) {
      throw new ConflictException(`Task ${id} cannot be dispatched from ${task.status}`);
    }
    await this.assertOutboundPolicyAllowed(task.to, new Date(), id, id);
    const attemptId = randomUUID();
    const now = new Date();
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
          channel,
          providerCallId: attemptId,
          status: TaskStatus.CALLING,
          ...(channel === 'web' ? { ringingAt: now } : {}),
        },
      });
      if (channel === 'web') {
        // web 通道：跳过 FreeSWITCH originate outbox，直接确认接受。
        await tx.callEvent.create({
          data: {
            taskId: id,
            attemptId,
            type: 'call.dispatch_accepted',
            payload: callEventPayload('call.dispatch_accepted', { channel: 'web' }),
          },
        });
      } else {
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
      }
    });
    const dispatched = await this.get(id);
    return { ...dispatched, taskId: dispatched.id, attemptId };
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

  private async resolveProviderEventContext(
    event: ProviderCallEventDto,
    client: { callAttempt: Prisma.TransactionClient['callAttempt'] },
  ): Promise<ResolvedProviderEventContext> {
    const identifiers = [
      ['attemptId', cleanString(event.attemptId)],
      ['providerCallId', cleanString(event.providerCallId)],
      ['providerJobId', cleanString(event.jobId)],
    ] as const;
    const supplied = identifiers.filter((entry): entry is readonly [typeof entry[0], string] => Boolean(entry[1]));
    if (supplied.length === 0) {
      throw new BadRequestException(
        'Provider call event requires attemptId, providerCallId, or jobId; taskId alone is not sufficient',
      );
    }

    const matches: ProviderAttemptContext[] = [];
    for (const [field, value] of supplied) {
      const where: Prisma.CallAttemptWhereUniqueInput = field === 'attemptId'
        ? { id: value }
        : field === 'providerCallId'
          ? { providerCallId: value }
          : { providerJobId: value };
      const attempt = await client.callAttempt.findUnique({
        where,
        select: {
          id: true,
          taskId: true,
          attemptNo: true,
          channel: true,
          providerCallId: true,
          providerJobId: true,
          status: true,
          startedAt: true,
          ringingAt: true,
          answeredAt: true,
          endedAt: true,
          duration: true,
          hangupCause: true,
          recordingUrl: true,
          lastProviderEventAt: true,
          lastProviderSnapshotId: true,
          lastProviderSnapshotAt: true,
          missingProviderSnapshotCount: true,
        },
      });
      if (!attempt) {
        throw new NotFoundException(`CallAttempt not found for ${field}`);
      }
      matches.push(attempt as ProviderAttemptContext);
    }

    const attempt = matches[0];
    if (matches.some((match) => match.id !== attempt.id || match.taskId !== attempt.taskId)) {
      throw new ConflictException('Provider call event identifiers refer to different attempts');
    }
    const taskId = cleanString(event.taskId);
    if (taskId && taskId !== attempt.taskId) {
      throw new ConflictException('Provider call event taskId does not match the resolved attempt');
    }
    return { taskId: attempt.taskId, attempt };
  }

  private async runSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= PROVIDER_EVENT_TRANSACTION_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (!isPrismaWriteConflict(error) || attempt === PROVIDER_EVENT_TRANSACTION_RETRIES) {
          throw error;
        }
      }
    }
    throw new Error('Serializable transaction retry limit exhausted');
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
          select: {
            id: true,
            providerCallId: true,
            providerJobId: true,
            channel: true,
          },
        });
        return {
          taskId: id,
          attemptId: attempt?.id,
          providerCallId: attempt?.providerCallId ?? undefined,
          providerJobId: attempt?.providerJobId ?? undefined,
          channel: attempt?.channel,
        };
      }
      return { taskId: id };
    }
    const attempt = await this.prisma.callAttempt.findFirst({
      where: { OR: [{ id }, { providerCallId: id }] },
      select: {
        id: true,
        taskId: true,
        providerCallId: true,
        providerJobId: true,
        channel: true,
      },
    });
    if (!attempt) throw new NotFoundException(`Task or CallAttempt ${id} not found`);
    return {
      taskId: attempt.taskId,
      attemptId: attempt.id,
      providerCallId: attempt.providerCallId ?? undefined,
      providerJobId: attempt.providerJobId ?? undefined,
      channel: attempt.channel,
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
      channel: attempt.channel ?? undefined,
      providerCallId: attempt.providerCallId ?? undefined,
      providerJobId: attempt.providerJobId ?? undefined,
      status: attempt.status as TaskStatus,
      startedAt: attempt.startedAt.toISOString(),
      ringingAt: attempt.ringingAt?.toISOString(),
      answeredAt: attempt.answeredAt?.toISOString(),
      endedAt: attempt.endedAt?.toISOString(),
      duration: attempt.duration ?? undefined,
      hangupCause: attempt.hangupCause ?? undefined,
      recordingUrl: attempt.recordingUrl ?? undefined,
      lastProviderEventAt: attempt.lastProviderEventAt?.toISOString(),
      lastProviderSnapshotId: attempt.lastProviderSnapshotId ?? undefined,
      lastProviderSnapshotAt: attempt.lastProviderSnapshotAt?.toISOString(),
      missingProviderSnapshotCount: attempt.missingProviderSnapshotCount ?? undefined,
    }));
    return {
      id: record.id,
      tenantId: record.tenantId ?? undefined,
      ownerId: record.ownerId ?? undefined,
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

function normalizeProvider(value: unknown): string {
  return (cleanString(value) ?? 'freeswitch').toLowerCase();
}

function normalizeHangupCause(value: unknown): string | undefined {
  return cleanString(value)?.replace(/[\s.-]+/g, '_').toUpperCase();
}

function isProgressProviderEvent(eventType: string): boolean {
  return eventType === 'CHANNEL_PROGRESS' || eventType === 'CHANNEL_PROGRESS_MEDIA';
}

function isAnswerProviderEvent(eventType: string): boolean {
  return eventType === 'CHANNEL_ANSWER';
}

function isTerminalHangupProviderEvent(eventType: string): boolean {
  return eventType === 'CHANNEL_HANGUP_COMPLETE';
}

function isRecordingProviderEvent(eventType: string): boolean {
  return eventType === 'RECORD_STOP' ||
    eventType === 'RECORD_AVAILABLE' ||
    eventType === 'RECORDING_AVAILABLE';
}

async function recordContactAttemptHistory(tx: unknown, data: ContactAttemptHistoryData): Promise<void> {
  const history = (tx as any).contactAttemptHistory;
  if (!history) return;

  if (data.attemptId && history.upsert) {
    await history.upsert({
      where: { attemptId: data.attemptId },
      update: {
        phoneNumber: data.phoneNumber,
        phoneHash: data.phoneHash,
        campaignId: data.campaignId,
        campaignLeadId: data.campaignLeadId,
        taskId: data.taskId,
        status: data.status,
        outcome: data.outcome,
        attemptedAt: data.attemptedAt,
      },
      create: data,
    });
    return;
  }

  if (history.create) {
    await history.create({ data });
  }
}

function deriveTerminalStatus(
  hangupCause: string | undefined,
  answered: boolean,
): TaskStatus {
  const normalizedCause = normalizeHangupCause(hangupCause);
  if (isFatalHangupCause(normalizedCause)) return TaskStatus.FAILED;
  if (answered) return TaskStatus.COMPLETED;
  if (normalizedCause && NO_ANSWER_HANGUP_CAUSES.has(normalizedCause)) return TaskStatus.NO_ANSWER;
  return TaskStatus.FAILED;
}

function isFatalHangupCause(value: unknown): boolean {
  const cause = normalizeHangupCause(value);
  if (!cause || NO_ANSWER_HANGUP_CAUSES.has(cause)) return false;
  if (FAILED_HANGUP_CAUSES.has(cause)) return true;
  return /(?:NETWORK|PROTOCOL|MEDIA|ROUTE|REGISTER|UNALLOCATED|INVALID_NUMBER|CHAN_UNAVAIL|CONGESTION|INCOMPATIBLE|BEARER|RECOVERY|DESTINATION_OUT_OF_ORDER|FAIL|ERROR)/.test(cause);
}

function backgroundJobFailureCause(value: unknown): string | undefined {
  const result = cleanString(value);
  if (!result || !/^-ERR(?:\s|$)/i.test(result)) return undefined;
  const candidate = normalizeHangupCause(result.replace(/^-ERR\b/i, ''));
  return candidate && candidate !== 'UNKNOWN' ? candidate : 'BACKGROUND_JOB_FAILED';
}

function assertProviderEventIdentity(
  event: { taskId: string; attemptId: string | null },
  context: ResolvedProviderEventContext,
): void {
  if (event.taskId !== context.taskId || event.attemptId !== context.attempt.id) {
    throw new ConflictException('providerEventId is already associated with another call attempt');
  }
}

function isPrismaWriteConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2034');
}

function isProviderEventUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== 'P2002') {
    return false;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target)
    ? target.map((value) => String(value).toLowerCase()).join(',')
    : String(target ?? '').toLowerCase();
  return (
    (fields.includes('provider') && (
      fields.includes('providereventid') || fields.includes('provider_event_id')
    )) ||
    fields.includes('call_events_provider_provider_event_id_key')
  );
}

function providerSnapshotGraceMs(): number {
  const configured = process.env.PROVIDER_SNAPSHOT_GRACE_MS
    ?? process.env.FREESWITCH_EVENT_RECONCILIATION_GRACE_MS;
  const parsed = Number(configured);
  return configured !== undefined && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PROVIDER_SNAPSHOT_GRACE_MS;
}

function safeErrorMessage(error: unknown): string {
  const code = cleanString((error as { code?: unknown } | null)?.code);
  return code && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)
    ? `FreeSWITCH hangup failed: ${code}`
    : 'FreeSWITCH hangup failed';
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

function hashPhone(phoneNumber: string): string {
  return createHash('sha256').update(phoneNumber.trim()).digest('hex');
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
