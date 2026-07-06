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
  type CampaignStats,
  type CampaignStatus,
  type CreateCampaignDto,
  type UpdateCampaignStatusDto,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { toPrismaJson } from '../tasks/task-payloads.js';

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
    const records = await this.prisma.campaign.findMany({
      where: {
        status: query.status,
        scenario: query.scenario,
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
  };
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
