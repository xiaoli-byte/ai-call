import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CallOutcome,
  TaskPriority,
  TaskStatus,
  type CampaignDetail,
  type CampaignImportBatch,
  type CampaignLead,
  type CampaignLeadImportError,
  type CampaignListItem,
  type CampaignListPage,
  type CampaignRetryPolicy,
  type CampaignStrategySimulation,
  type CampaignStats,
  type CampaignStatus,
  type CreateCampaignDto,
  type UpdateCampaignStatusDto,
} from '@ai-call/shared';
import { ClsService } from 'nestjs-cls';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { toPrismaJson } from '../tasks/task-payloads.js';
import { GlobalConfigService } from '../global-config/global-config.service.js';
import { hasViewPerm, isAclBypass, type AclSubject } from '../common/resource-acl.js';
import { campaignGrantWhere, campaignVisibilityWhere } from './campaign-acl.js';

const DEFAULT_RETRY_POLICY: CampaignRetryPolicy = {
  maxAttempts: 2,
  retryIntervalMinutes: 60,
  retryOn: ['no_answer', 'failed'],
};

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly globalConfig?: GlobalConfigService,
    private readonly cls?: ClsService,
  ) {}

  async create(dto: CreateCampaignDto): Promise<CampaignDetail> {
    const parsed = parseLeads(dto.leads);
    if (parsed.valid.length === 0) {
      throw new BadRequestException({
        code: 'campaign_no_valid_leads',
        message: '活动名单中没有可创建外呼任务的有效号码',
        errors: parsed.errors,
      });
    }

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
    const retryPolicy = normalizeRetryPolicy(dto.retryPolicy);
    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() ?? '',
        scenario: dto.scenario,
        scenarioId: dto.scenarioId,
        flowId: dto.flowId,
        status: 'scheduled',
        scheduledAt,
        concurrencyLimit: normalizeConcurrency(dto.concurrencyLimit),
        retryPolicy: toPrismaJson(retryPolicy),
        endCondition: toPrismaJson(dto.endCondition ?? {}),
        // CALL-09：记录创建者。为空时（无用户上下文的系统创建）该活动按 campaign-acl 的
        // 策略对租户内 campaign:read 持有者公开。
        ownerId: this.cls?.get<string | undefined>('userId'),
      },
    });

    const batch = await this.prisma.leadImportBatch.create({
      data: {
        campaignId: campaign.id,
        totalRows: dto.leads.length,
        validRows: parsed.valid.length,
        invalidRows: parsed.errors.length,
        errors: toPrismaJson(parsed.errors),
      },
    });

    for (const leadInput of parsed.invalid) {
      await this.prisma.campaignLead.create({
        data: {
          campaignId: campaign.id,
          batchId: batch.id,
          rowNumber: leadInput.rowNumber,
          phoneNumber: leadInput.phoneNumber,
          displayName: leadInput.name,
          variables: toPrismaJson(leadInput.variables ?? {}),
          status: 'invalid',
          validationError: leadInput.reason,
        },
      });
    }

    for (const leadInput of parsed.valid) {
      const lead = await this.prisma.campaignLead.create({
        data: {
          campaignId: campaign.id,
          batchId: batch.id,
          rowNumber: leadInput.rowNumber,
          phoneNumber: leadInput.phoneNumber,
          displayName: leadInput.name,
          variables: toPrismaJson(leadInput.variables ?? {}),
          status: 'imported',
        },
      });
      const task = await this.tasksService.create({
        to: leadInput.phoneNumber,
        scenario: dto.scenario,
        scenarioId: dto.scenarioId,
        flowId: dto.flowId,
        scheduledAt: leadInput.scheduledAt ?? dto.scheduledAt,
        priority: leadInput.priority ?? TaskPriority.NORMAL,
        campaignId: campaign.id,
        campaignLeadId: lead.id,
        variables: {
          ...(dto.variables ?? {}),
          ...(leadInput.variables ?? {}),
          campaignId: campaign.id,
          campaignName: campaign.name,
          customerName: leadInput.name ?? '',
        },
      });
      await this.prisma.campaignLead.update({
        where: { id: lead.id },
        data: { status: 'scheduled' },
      });
      if (!task) {
        await this.prisma.campaignLead.update({
          where: { id: lead.id },
          data: { status: 'invalid', validationError: '任务创建失败' },
        });
      }
    }

    return this.get(campaign.id);
  }

  async list(query: {
    status?: CampaignStatus;
    scenario?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CampaignListPage> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const visibility = await this.buildCampaignVisibilityWhere();
    const records = await this.prisma.campaign.findMany({
      where: {
        AND: [
          {
            status: query.status,
            scenario: query.scenario,
          },
          visibility,
        ],
      },
      include: this.listInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = records.length > limit;
    const pageRecords = hasMore ? records.slice(0, limit) : records;
    return {
      items: pageRecords.map((record) => this.toListItem(record)),
      nextCursor: hasMore ? pageRecords.at(-1)?.id : undefined,
    };
  }

  async get(id: string): Promise<CampaignDetail> {
    const record = await this.prisma.campaign.findUnique({
      where: { id },
      include: this.detailInclude,
    });
    if (!record) throw new NotFoundException(`Campaign ${id} not found`);
    return {
      ...this.toListItem(record),
      leads: (record.leads ?? []).map((lead: any) => this.toLead(lead)),
      importBatches: (record.importBatches ?? []).map((batch: any) => this.toBatch(batch)),
    };
  }

  /**
   * CALL-09：详情端点的资源级 ACL 校验（供 controller 在 get() 之后调用）。
   * 未命中可见性规则时抛 404 而非 403——避免向非授权用户泄露活动是否存在。
   * 与 tasks 的 assertTaskVisible 同构。内部读取（create/updateStatus 经 get()）不经过本方法。
   */
  async assertCampaignVisible(id: string): Promise<void> {
    const subject = this.aclSubject();
    if (!subject.userId || isAclBypass(subject.roles)) return;
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!campaign) return; // 交由调用方的 get() 统一抛 404
    if (campaign.ownerId == null || campaign.ownerId === subject.userId) return;
    const grant = await this.prisma.resourceGrant.findFirst({
      where: { ...campaignGrantWhere(subject), resourceId: id },
      select: { perms: true },
    });
    if (grant && hasViewPerm(grant.perms)) return;
    throw new NotFoundException(`Campaign ${id} not found`);
  }

  private aclSubject(): AclSubject {
    return {
      userId: this.cls?.get<string | undefined>('userId'),
      roles: this.cls?.get<string[] | undefined>('roles') ?? [],
    };
  }

  private async buildCampaignVisibilityWhere(): Promise<Prisma.CampaignWhereInput> {
    const subject = this.aclSubject();
    if (!subject.userId || isAclBypass(subject.roles)) return {};
    const grants = await this.prisma.resourceGrant.findMany({
      where: campaignGrantWhere(subject),
      select: { resourceId: true, perms: true },
    });
    const grantedIds = grants.filter((g) => hasViewPerm(g.perms)).map((g) => g.resourceId);
    return campaignVisibilityWhere(subject, grantedIds);
  }

  async updateStatus(id: string, dto: UpdateCampaignStatusDto): Promise<CampaignDetail> {
    await this.get(id);
    await this.prisma.campaign.update({
      where: { id },
      data: { status: dto.status },
    });
    if (dto.status === 'paused') {
      await this.prisma.outboundTask.updateMany({
        where: { campaignId: id, status: TaskStatus.PENDING },
        data: { status: TaskStatus.CANCELLED },
      });
    }
    return this.get(id);
  }

  async simulateStrategy(id: string): Promise<CampaignStrategySimulation> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { leads: true },
    });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);
    const config = this.globalConfig ? await this.globalConfig.get() : undefined;
    const outboundRules = config?.outboundRules ?? {
      blockedNumbers: [],
      globalWhitelist: [],
      dailyCallLimitPerCallee: 3,
      maxAttemptsPerNumber: 3,
    };
    const leads = (campaign.leads ?? []).filter((lead: any) => lead.status !== 'invalid');
    const phoneNumbers = [...new Set(leads.map((lead: any) => lead.phoneNumber))];
    const history = await (this.prisma as any).contactAttemptHistory.findMany?.({
      where: { phoneNumber: { in: phoneNumbers } },
      orderBy: { attemptedAt: 'desc' },
    }) ?? [];
    const blockedSet = new Set((outboundRules.blockedNumbers ?? []).map((item: any) => item.phoneNumber));
    const whitelistSet = new Set((outboundRules.globalWhitelist ?? []).map((item: any) => item.phoneNumber));
    const retryPolicy = normalizeRetryPolicy((campaign as any).retryPolicy);
    const buckets = new Map<string, Set<string>>();
    const seenInCampaign = new Set<string>();
    let callableLeads = 0;

    for (const lead of leads as any[]) {
      const phone = lead.phoneNumber;
      if (seenInCampaign.has(phone)) {
        addBucket(buckets, 'duplicate_in_campaign', phone);
        continue;
      }
      seenInCampaign.add(phone);
      if (blockedSet.has(phone) && !whitelistSet.has(phone)) {
        addBucket(buckets, 'blocked_number', phone);
        continue;
      }
      const phoneHistory = history.filter((item: any) => item.phoneNumber === phone);
      const todayCount = phoneHistory.filter((item: any) => isSameUtcDay(item.attemptedAt, new Date())).length;
      if (todayCount >= Number(outboundRules.dailyCallLimitPerCallee ?? 3)) {
        addBucket(buckets, 'daily_limit', phone);
        continue;
      }
      if (phoneHistory.length >= Number(outboundRules.maxAttemptsPerNumber ?? retryPolicy.maxAttempts)) {
        addBucket(buckets, 'max_attempts_per_number', phone);
        continue;
      }
      if (hitsFailureReasonLimit(phoneHistory, retryPolicy)) {
        addBucket(buckets, 'failure_reason_retry_limit', phone);
        continue;
      }
      callableLeads += 1;
    }

    const blockReasons = [...buckets.entries()].map(([reason, phones]) => ({
      reason: reason as CampaignStrategySimulation['blockReasons'][number]['reason'],
      count: phones.size,
      phoneNumbers: [...phones],
    }));
    const blockedLeads = blockReasons.reduce((sum, item) => sum + item.count, 0);
    return {
      campaignId: id,
      totalLeads: leads.length,
      callableLeads,
      blockedLeads,
      estimatedTasks: callableLeads,
      blockReasons,
      generatedAt: new Date().toISOString(),
    };
  }

  private readonly listInclude = {
    leads: { select: { id: true, status: true } },
    tasks: {
      select: {
        status: true,
        outcome: true,
        duration: true,
        attemptCount: true,
      },
    },
    importBatches: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  };

  private readonly detailInclude = {
    leads: {
      orderBy: { rowNumber: 'asc' as const },
      include: {
        tasks: { select: { id: true }, take: 1 },
      },
    },
    tasks: {
      select: {
        status: true,
        outcome: true,
        duration: true,
        attemptCount: true,
      },
    },
    importBatches: { orderBy: { createdAt: 'desc' as const } },
  };

  private toListItem(record: any): CampaignListItem {
    return {
      id: record.id,
      name: record.name,
      description: record.description || undefined,
      scenario: record.scenario,
      scenarioId: record.scenarioId ?? undefined,
      flowId: record.flowId ?? undefined,
      status: record.status as CampaignStatus,
      scheduledAt: record.scheduledAt?.toISOString(),
      concurrencyLimit: record.concurrencyLimit,
      retryPolicy: normalizeRetryPolicy(record.retryPolicy),
      endCondition: record.endCondition ?? {},
      stats: buildStats(record.leads ?? [], record.tasks ?? []),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toLead(record: any): CampaignLead {
    return {
      id: record.id,
      campaignId: record.campaignId,
      batchId: record.batchId ?? undefined,
      rowNumber: record.rowNumber,
      phoneNumber: record.phoneNumber,
      displayName: record.displayName ?? undefined,
      variables: (record.variables ?? {}) as Record<string, string>,
      status: record.status,
      validationError: record.validationError ?? undefined,
      taskId: record.tasks?.[0]?.id,
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    };
  }

  private toBatch(record: any): CampaignImportBatch {
    return {
      id: record.id,
      campaignId: record.campaignId,
      filename: record.filename ?? undefined,
      totalRows: record.totalRows,
      validRows: record.validRows,
      invalidRows: record.invalidRows,
      errors: Array.isArray(record.errors) ? record.errors : [],
      createdAt: toIso(record.createdAt),
    };
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function parseLeads(leads: CreateCampaignDto['leads']) {
  const seen = new Set<string>();
  const valid: Array<CreateCampaignDto['leads'][number] & { rowNumber: number }> = [];
  const invalid: Array<CreateCampaignDto['leads'][number] & { rowNumber: number; reason: string }> = [];
  const errors: CampaignLeadImportError[] = [];

  leads.forEach((lead, index) => {
    const rowNumber = index + 1;
    const phoneNumber = lead.phoneNumber.trim();
    const error = validatePhone(phoneNumber) ?? (seen.has(phoneNumber) ? '重复号码' : undefined);
    if (error) {
      invalid.push({ ...lead, phoneNumber, rowNumber, reason: error });
      errors.push({ rowNumber, phoneNumber, reason: error });
      return;
    }
    seen.add(phoneNumber);
    valid.push({ ...lead, phoneNumber, rowNumber });
  });

  return { valid, invalid, errors };
}

function validatePhone(phoneNumber: string): string | undefined {
  if (!phoneNumber) return '号码为空';
  if (!/^\+?\d{3,20}$/.test(phoneNumber)) return '号码格式不正确';
  return undefined;
}

function normalizeConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function normalizeRetryPolicy(value: unknown): CampaignRetryPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_RETRY_POLICY;
  const input = value as Partial<CampaignRetryPolicy>;
  return {
    maxAttempts: Math.max(1, Math.min(10, Math.trunc(input.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts))),
    retryIntervalMinutes: Math.max(1, Math.trunc(input.retryIntervalMinutes ?? DEFAULT_RETRY_POLICY.retryIntervalMinutes ?? 60)),
    retryOn: Array.isArray(input.retryOn) && input.retryOn.length > 0
      ? input.retryOn.map(String)
      : DEFAULT_RETRY_POLICY.retryOn,
    failureReasonRules: input.failureReasonRules && typeof input.failureReasonRules === 'object'
      ? Object.fromEntries(
          Object.entries(input.failureReasonRules).map(([key, rule]) => [
            key,
            {
              maxAttempts: Math.max(1, Math.trunc(Number((rule as any)?.maxAttempts ?? 1))),
              intervalMinutes: (rule as any)?.intervalMinutes === undefined
                ? undefined
                : Math.max(1, Math.trunc(Number((rule as any).intervalMinutes))),
            },
          ]),
        )
      : undefined,
  };
}

function addBucket(buckets: Map<string, Set<string>>, reason: string, phone: string): void {
  const set = buckets.get(reason) ?? new Set<string>();
  set.add(phone);
  buckets.set(reason, set);
}

function isSameUtcDay(left: unknown, right: Date): boolean {
  const date = left instanceof Date ? left : new Date(String(left));
  return date.getUTCFullYear() === right.getUTCFullYear() &&
    date.getUTCMonth() === right.getUTCMonth() &&
    date.getUTCDate() === right.getUTCDate();
}

function hitsFailureReasonLimit(history: any[], policy: CampaignRetryPolicy): boolean {
  const rules = policy.failureReasonRules ?? {};
  return Object.entries(rules).some(([reason, rule]) => {
    const count = history.filter((item) => String(item.outcome ?? item.status ?? '').toUpperCase() === reason.toUpperCase()).length;
    return count >= rule.maxAttempts;
  });
}

function buildStats(leads: any[], tasks: any[]): CampaignStats {
  const totalLeads = leads.length;
  const invalidLeads = leads.filter((lead) => lead.status === 'invalid').length;
  const validLeads = totalLeads - invalidLeads;
  const dialed = tasks.filter((task) => (
    task.attemptCount > 0 ||
    task.status === TaskStatus.CALLING ||
    task.status === TaskStatus.IN_CALL ||
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.NO_ANSWER
  )).length;
  const connected = tasks.filter((task) => (
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.IN_CALL ||
    Boolean(task.duration)
  )).length;
  const failed = tasks.filter((task) => (
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.NO_ANSWER ||
    task.status === TaskStatus.CANCELLED
  )).length;
  const converted = tasks.filter((task) => (
    task.outcome === CallOutcome.HIGH_INTENT ||
    task.outcome === CallOutcome.MEDIUM_INTENT
  )).length;
  const escalated = tasks.filter((task) => task.outcome === CallOutcome.ESCALATED).length;
  const durations = tasks
    .map((task) => Number(task.duration ?? 0))
    .filter((duration) => duration > 0);
  return {
    totalLeads,
    validLeads,
    invalidLeads,
    scheduledTasks: tasks.length,
    dialed,
    connected,
    failed,
    converted,
    escalated,
    connectRate: rate(connected, dialed),
    conversionRate: rate(converted, dialed),
    averageDurationSeconds: durations.length
      ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length)
      : 0,
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}
