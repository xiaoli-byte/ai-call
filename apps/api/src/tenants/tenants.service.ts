import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingAccountStatus,
  DEFAULT_TENANT_ID,
  TenantStatus,
  UsagePeriod,
  type CheckTenantQuotaDto,
  type CreateTenantDto,
  type RecordUsageEventDto,
  type RecordUsageEventResult,
  type SetTenantQuotaPolicyDto,
  type Tenant,
  type TenantProviderConfig,
  type TenantQuotaDecision,
  type TenantQuotaPolicy,
  type UpdateTenantDto,
  type UpsertTenantProviderConfigDto,
  type UsageAggregate,
  type UsageEvent,
  type UsageMetric,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrismaJson } from '../common/prisma-json.js';

const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    const slug = normalizeSlug(dto.slug);
    const name = normalizeRequiredString(dto.name, 'name');
    const metadata = normalizeJsonObject(dto.metadata);

    const tenant = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.tenant.create({
        data: {
          slug,
          name,
          status: TenantStatus.ACTIVE,
          metadata: toPrismaJson(metadata),
        },
      });
      await tx.billingAccount.create({
        data: {
          tenantId: created.id,
          status: BillingAccountStatus.TRIAL,
          metadata: toPrismaJson({}),
        },
      });
      return created;
    });

    return this.toTenant(tenant);
  }

  async listTenants(): Promise<Tenant[]> {
    const records = await this.prisma.tenant.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return records.map((record: any) => this.toTenant(record));
  }

  async getTenant(id: string): Promise<Tenant> {
    const record = await this.prisma.tenant.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Tenant ${id} not found`);
    return this.toTenant(record);
  }

  async updateTenant(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    await this.ensureTenant(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = normalizeRequiredString(dto.name, 'name');
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.metadata !== undefined) data.metadata = toPrismaJson(normalizeJsonObject(dto.metadata));
    if (Object.keys(data).length === 0) return this.getTenant(id);

    const record = await this.prisma.tenant.update({ where: { id }, data });
    return this.toTenant(record);
  }

  async deleteTenant(id: string): Promise<void> {
    if (id === DEFAULT_TENANT_ID) {
      throw new BadRequestException('The default tenant anchors legacy data and cannot be deleted');
    }
    await this.ensureTenant(id);
    await this.prisma.tenant.delete({ where: { id } });
  }

  async upsertProviderConfig(
    tenantId: string,
    dto: UpsertTenantProviderConfigDto,
  ): Promise<TenantProviderConfig> {
    await this.ensureTenant(tenantId);
    const providerType = normalizeRequiredString(dto.providerType, 'providerType');
    const providerName = normalizeRequiredString(dto.providerName, 'providerName');
    const data = {
      enabled: dto.enabled ?? true,
      secretRef: normalizeOptionalString(dto.secretRef),
      configEncrypted: toPrismaJson(normalizeJsonObject(dto.configEncrypted)),
      metadata: toPrismaJson(normalizeJsonObject(dto.metadata)),
    };

    const record = await this.prisma.tenantProviderConfig.upsert({
      where: {
        tenantId_providerType_providerName: {
          tenantId,
          providerType,
          providerName,
        },
      },
      create: {
        tenantId,
        providerType,
        providerName,
        ...data,
      },
      update: data,
    });
    return this.toProviderConfig(record);
  }

  async setQuotaPolicy(
    tenantId: string,
    dto: SetTenantQuotaPolicyDto,
  ): Promise<TenantQuotaPolicy> {
    await this.ensureTenant(tenantId);
    const metric = normalizeRequiredString(dto.metric, 'metric') as UsageMetric;
    const period = normalizePeriod(dto.period);
    const quotaLimit = normalizePositiveInt(dto.limit, 'limit');

    const record = await this.prisma.tenantQuotaPolicy.upsert({
      where: {
        tenantId_metric_period: {
          tenantId,
          metric,
          period,
        },
      },
      create: {
        tenantId,
        metric,
        period,
        quotaLimit,
        enabled: dto.enabled ?? true,
      },
      update: {
        quotaLimit,
        enabled: dto.enabled ?? true,
      },
    });
    return this.toQuotaPolicy(record);
  }

  async checkQuota(dto: CheckTenantQuotaDto): Promise<TenantQuotaDecision> {
    const tenantId = dto.tenantId ?? DEFAULT_TENANT_ID;
    const metric = normalizeRequiredString(dto.metric, 'metric') as UsageMetric;
    const period = normalizePeriod(dto.period);
    const quantity = normalizePositiveInt(dto.quantity ?? 1, 'quantity');
    const at = normalizeDate(dto.at);
    const bucketStart = startOfPeriod(at, period);

    const [policy, aggregate] = await Promise.all([
      this.prisma.tenantQuotaPolicy.findUnique({
        where: {
          tenantId_metric_period: {
            tenantId,
            metric,
            period,
          },
        },
      }),
      this.prisma.usageAggregate.findUnique({
        where: {
          tenantId_metric_period_bucketStart: {
            tenantId,
            metric,
            period,
            bucketStart,
          },
        },
      }),
    ]);

    const used = numberFromRecord(aggregate?.quantity);
    if (!policy || policy.enabled === false) {
      return { allowed: true, tenantId, metric, period, used };
    }

    const limit = quotaLimitFromRecord(policy);
    const remaining = Math.max(0, limit - used);
    if (used + quantity > limit) {
      return {
        allowed: false,
        tenantId,
        metric,
        period,
        reason: 'quota_exceeded',
        limit,
        used,
        remaining,
      };
    }

    return { allowed: true, tenantId, metric, period, limit, used, remaining };
  }

  async recordUsageEvent(dto: RecordUsageEventDto): Promise<RecordUsageEventResult> {
    const tenantId = dto.tenantId ?? DEFAULT_TENANT_ID;
    await this.ensureTenant(tenantId);
    const idempotencyKey = normalizeRequiredString(dto.idempotencyKey, 'idempotencyKey');
    const metric = normalizeRequiredString(dto.metric, 'metric') as UsageMetric;
    const period = normalizePeriod(dto.period ?? UsagePeriod.DAY);
    const quantity = normalizePositiveInt(dto.quantity ?? 1, 'quantity');
    const eventAt = normalizeDate(dto.at);
    const bucketStart = startOfPeriod(eventAt, period);

    const existing = await this.findUsageEvent(tenantId, idempotencyKey);
    if (existing) {
      return this.duplicateUsageResult(existing, tenantId, metric, period, bucketStart);
    }

    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        const event = await tx.usageEvent.create({
          data: {
            tenantId,
            idempotencyKey,
            metric,
            period,
            quantity,
            eventAt,
            source: normalizeOptionalString(dto.source),
            metadata: toPrismaJson(normalizeJsonObject(dto.metadata)),
          },
        });
        const aggregate = await tx.usageAggregate.upsert({
          where: {
            tenantId_metric_period_bucketStart: {
              tenantId,
              metric,
              period,
              bucketStart,
            },
          },
          create: {
            tenantId,
            metric,
            period,
            bucketStart,
            quantity,
            eventCount: 1,
          },
          update: {
            quantity: { increment: quantity },
            eventCount: { increment: 1 },
          },
        });
        return { event, aggregate };
      });
      return {
        event: this.toUsageEvent(result.event),
        aggregate: this.toUsageAggregate(result.aggregate),
        duplicate: false,
      };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const duplicate = await this.findUsageEvent(tenantId, idempotencyKey);
      if (!duplicate) throw error;
      return this.duplicateUsageResult(duplicate, tenantId, metric, period, bucketStart);
    }
  }

  private async ensureTenant(id: string): Promise<void> {
    const record = await this.prisma.tenant.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Tenant ${id} not found`);
  }

  private async findUsageEvent(tenantId: string, idempotencyKey: string): Promise<any | null> {
    return this.prisma.usageEvent.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId,
          idempotencyKey,
        },
      },
    });
  }

  private async duplicateUsageResult(
    event: any,
    tenantId: string,
    metric: UsageMetric,
    period: UsagePeriod,
    bucketStart: Date,
  ): Promise<RecordUsageEventResult> {
    const aggregate = await this.prisma.usageAggregate.findUnique({
      where: {
        tenantId_metric_period_bucketStart: {
          tenantId,
          metric,
          period,
          bucketStart,
        },
      },
    });
    return {
      event: this.toUsageEvent(event),
      aggregate: this.toUsageAggregate(
        aggregate ?? {
          id: '',
          tenantId,
          metric,
          period,
          bucketStart,
          quantity: 0,
          eventCount: 0,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ),
      duplicate: true,
    };
  }

  private toTenant(record: any): Tenant {
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      status: record.status,
      metadata: normalizeJsonObject(record.metadata),
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    };
  }

  private toProviderConfig(record: any): TenantProviderConfig {
    return {
      id: record.id,
      tenantId: record.tenantId,
      providerType: record.providerType,
      providerName: record.providerName,
      enabled: record.enabled,
      secretRef: record.secretRef ?? undefined,
      configEncrypted: normalizeJsonObject(record.configEncrypted),
      metadata: normalizeJsonObject(record.metadata),
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    };
  }

  private toQuotaPolicy(record: any): TenantQuotaPolicy {
    return {
      id: record.id,
      tenantId: record.tenantId,
      metric: record.metric,
      period: record.period,
      limit: quotaLimitFromRecord(record),
      enabled: record.enabled,
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    };
  }

  private toUsageEvent(record: any): UsageEvent {
    return {
      id: record.id,
      tenantId: record.tenantId,
      idempotencyKey: record.idempotencyKey,
      metric: record.metric,
      period: record.period,
      quantity: numberFromRecord(record.quantity),
      eventAt: toIso(record.eventAt),
      source: record.source ?? undefined,
      metadata: normalizeJsonObject(record.metadata),
      createdAt: toIso(record.createdAt),
    };
  }

  private toUsageAggregate(record: any): UsageAggregate {
    return {
      id: record.id,
      tenantId: record.tenantId,
      metric: record.metric,
      period: record.period,
      bucketStart: toIso(record.bucketStart),
      quantity: numberFromRecord(record.quantity),
      eventCount: numberFromRecord(record.eventCount),
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    };
  }

}

function normalizeSlug(value: string): string {
  const slug = normalizeRequiredString(value, 'slug').toLowerCase().replace(/\s+/g, '-');
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw new BadRequestException('slug must start with a letter and contain 2-64 lowercase letters, numbers, or dashes');
  }
  return slug;
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePositiveInt(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return Math.trunc(number);
}

function normalizePeriod(value: unknown): UsagePeriod {
  if (value === UsagePeriod.DAY || value === UsagePeriod.MONTH) return value;
  throw new BadRequestException('period must be day or month');
}

function normalizeDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (value === undefined || value === null) return new Date();
  throw new BadRequestException('date must be an ISO date string');
}

function startOfPeriod(at: Date, period: UsagePeriod): Date {
  if (period === UsagePeriod.MONTH) {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function numberFromRecord(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value) || 0;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function quotaLimitFromRecord(record: { quotaLimit?: number } | Record<string, unknown>): number {
  return numberFromRecord(
    (record as { quotaLimit?: unknown }).quotaLimit ?? (record as { limit?: unknown }).limit,
  );
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}
