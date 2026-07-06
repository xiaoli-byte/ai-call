import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TENANT_ID,
  TenantProviderType,
  UsageMetric,
  UsagePeriod,
} from '@ai-call/shared';
import { TenantsService } from './tenants.service.js';

describe('TenantsService', () => {
  it('creates an active tenant with a billing account skeleton', async () => {
    const prisma = new InMemoryTenantPrisma();
    const service = new TenantsService(prisma as any);

    const tenant = await service.createTenant({
      slug: 'acme',
      name: 'Acme Health',
      metadata: { source: 'phase-three-test' },
    });

    assert.equal(DEFAULT_TENANT_ID, 'default');
    assert.equal(tenant.slug, 'acme');
    assert.equal(tenant.name, 'Acme Health');
    assert.equal(tenant.status, 'active');
    assert.deepEqual(tenant.metadata, { source: 'phase-three-test' });
    assert.equal(prisma.billingAccounts.length, 1);
    assert.equal(prisma.billingAccounts[0].tenantId, tenant.id);
    assert.equal(prisma.billingAccounts[0].status, 'trial');
  });

  it('upserts tenant provider config using secret references or encrypted config only', async () => {
    const prisma = new InMemoryTenantPrisma();
    const service = new TenantsService(prisma as any);
    await service.createTenant({ slug: 'acme', name: 'Acme Health' });

    const config = await service.upsertProviderConfig('tenant-1', {
      providerType: TenantProviderType.LLM,
      providerName: 'openai',
      enabled: true,
      secretRef: 'vault://tenants/acme/openai',
      configEncrypted: {
        keyId: 'kms-key-1',
        ciphertext: 'encrypted-payload',
      },
      apiKey: 'sk-plain-should-not-persist',
    } as any);

    assert.equal(config.providerType, TenantProviderType.LLM);
    assert.equal(config.secretRef, 'vault://tenants/acme/openai');
    assert.deepEqual(config.configEncrypted, {
      keyId: 'kms-key-1',
      ciphertext: 'encrypted-payload',
    });
    const persisted = JSON.stringify(prisma.providerConfigs);
    assert.equal(persisted.includes('sk-plain-should-not-persist'), false);
    assert.equal(persisted.includes('apiKey'), false);
  });

  it('denies quota checks when requested quantity would exceed the tenant policy', async () => {
    const prisma = new InMemoryTenantPrisma();
    const service = new TenantsService(prisma as any);
    await service.createTenant({ slug: 'acme', name: 'Acme Health' });
    await service.setQuotaPolicy('tenant-1', {
      metric: UsageMetric.LLM_TOKENS,
      period: UsagePeriod.MONTH,
      limit: 100,
    });
    prisma.usageAggregates.set(
      aggregateKey('tenant-1', UsageMetric.LLM_TOKENS, UsagePeriod.MONTH, new Date('2026-07-01T00:00:00.000Z')),
      {
        id: 'aggregate-1',
        tenantId: 'tenant-1',
        metric: UsageMetric.LLM_TOKENS,
        period: UsagePeriod.MONTH,
        bucketStart: new Date('2026-07-01T00:00:00.000Z'),
        quantity: 95,
        eventCount: 3,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    );

    const decision = await service.checkQuota({
      tenantId: 'tenant-1',
      metric: UsageMetric.LLM_TOKENS,
      period: UsagePeriod.MONTH,
      quantity: 6,
      at: new Date('2026-07-06T08:00:00.000Z'),
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.limit, 100);
    assert.equal(decision.used, 95);
    assert.equal(decision.remaining, 5);
    assert.equal(decision.reason, 'quota_exceeded');
  });

  it('records usage events idempotently and increments the aggregate once', async () => {
    const prisma = new InMemoryTenantPrisma();
    const service = new TenantsService(prisma as any);
    await service.createTenant({ slug: 'acme', name: 'Acme Health' });

    const first = await service.recordUsageEvent({
      tenantId: 'tenant-1',
      idempotencyKey: 'call-attempt-1:tokens',
      metric: UsageMetric.LLM_TOKENS,
      period: UsagePeriod.DAY,
      quantity: 42,
      at: new Date('2026-07-06T08:34:00.000Z'),
      metadata: { callAttemptId: 'call-attempt-1' },
    });
    const second = await service.recordUsageEvent({
      tenantId: 'tenant-1',
      idempotencyKey: 'call-attempt-1:tokens',
      metric: UsageMetric.LLM_TOKENS,
      period: UsagePeriod.DAY,
      quantity: 42,
      at: new Date('2026-07-06T08:35:00.000Z'),
      metadata: { callAttemptId: 'call-attempt-1' },
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(prisma.usageEvents.size, 1);
    assert.equal(prisma.usageAggregates.size, 1);
    assert.equal([...prisma.usageAggregates.values()][0].quantity, 42);
    assert.equal([...prisma.usageAggregates.values()][0].eventCount, 1);
  });
});

function aggregateKey(
  tenantId: string,
  metric: string,
  period: string,
  bucketStart: Date,
): string {
  return `${tenantId}:${metric}:${period}:${bucketStart.toISOString()}`;
}

class InMemoryTenantPrisma {
  tenants: any[] = [];
  billingAccounts: any[] = [];
  providerConfigs: any[] = [];
  quotaPolicies: any[] = [];
  usageEvents = new Map<string, any>();
  usageAggregates = new Map<string, any>();

  tenant = {
    create: async ({ data }: any) => {
      const now = new Date('2026-07-06T08:00:00.000Z');
      const record = {
        id: `tenant-${this.tenants.length + 1}`,
        status: 'active',
        metadata: {},
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.tenants.push(record);
      return record;
    },
    findUnique: async ({ where }: any) =>
      this.tenants.find((tenant) => tenant.id === where.id || tenant.slug === where.slug) ?? null,
    findMany: async () => this.tenants,
    update: async ({ where, data }: any) => {
      const tenant = this.tenants.find((item) => item.id === where.id);
      Object.assign(tenant, data, { updatedAt: new Date('2026-07-06T09:00:00.000Z') });
      return tenant;
    },
  };

  billingAccount = {
    create: async ({ data }: any) => {
      const record = {
        id: `billing-${this.billingAccounts.length + 1}`,
        status: 'trial',
        providerCustomerRef: null,
        billingEmail: null,
        metadata: {},
        createdAt: new Date('2026-07-06T08:00:00.000Z'),
        updatedAt: new Date('2026-07-06T08:00:00.000Z'),
        ...data,
      };
      this.billingAccounts.push(record);
      return record;
    },
  };

  tenantProviderConfig = {
    upsert: async ({ where, create, update }: any) => {
      const match = this.providerConfigs.find((config) =>
        config.tenantId === where.tenantId_providerType_providerName.tenantId &&
        config.providerType === where.tenantId_providerType_providerName.providerType &&
        config.providerName === where.tenantId_providerType_providerName.providerName,
      );
      if (match) {
        Object.assign(match, update, { updatedAt: new Date('2026-07-06T09:00:00.000Z') });
        return match;
      }
      const record = {
        id: `provider-${this.providerConfigs.length + 1}`,
        status: 'active',
        configEncrypted: {},
        secretRef: null,
        createdAt: new Date('2026-07-06T08:00:00.000Z'),
        updatedAt: new Date('2026-07-06T08:00:00.000Z'),
        ...create,
      };
      this.providerConfigs.push(record);
      return record;
    },
  };

  tenantQuotaPolicy = {
    findUnique: async ({ where }: any) =>
      this.quotaPolicies.find((policy) =>
        policy.tenantId === where.tenantId_metric_period.tenantId &&
        policy.metric === where.tenantId_metric_period.metric &&
        policy.period === where.tenantId_metric_period.period,
      ) ?? null,
    upsert: async ({ where, create, update }: any) => {
      const match = await this.tenantQuotaPolicy.findUnique({ where });
      if (match) {
        Object.assign(match, update, { updatedAt: new Date('2026-07-06T09:00:00.000Z') });
        return match;
      }
      const record = {
        id: `quota-${this.quotaPolicies.length + 1}`,
        createdAt: new Date('2026-07-06T08:00:00.000Z'),
        updatedAt: new Date('2026-07-06T08:00:00.000Z'),
        ...create,
      };
      this.quotaPolicies.push(record);
      return record;
    },
  };

  usageEvent = {
    findUnique: async ({ where }: any) =>
      this.usageEvents.get(`${where.tenantId_idempotencyKey.tenantId}:${where.tenantId_idempotencyKey.idempotencyKey}`) ?? null,
    create: async ({ data }: any) => {
      const record = {
        id: `usage-event-${this.usageEvents.size + 1}`,
        metadata: {},
        createdAt: new Date('2026-07-06T08:00:00.000Z'),
        ...data,
      };
      this.usageEvents.set(`${data.tenantId}:${data.idempotencyKey}`, record);
      return record;
    },
  };

  usageAggregate = {
    findUnique: async ({ where }: any) => {
      const key = where.tenantId_metric_period_bucketStart;
      return this.usageAggregates.get(aggregateKey(key.tenantId, key.metric, key.period, key.bucketStart)) ?? null;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.tenantId_metric_period_bucketStart;
      const mapKey = aggregateKey(key.tenantId, key.metric, key.period, key.bucketStart);
      const existing = this.usageAggregates.get(mapKey);
      if (existing) {
        existing.quantity += update.quantity.increment;
        existing.eventCount += update.eventCount.increment;
        existing.updatedAt = new Date('2026-07-06T09:00:00.000Z');
        return existing;
      }
      const record = {
        id: `usage-aggregate-${this.usageAggregates.size + 1}`,
        eventCount: 0,
        createdAt: new Date('2026-07-06T08:00:00.000Z'),
        updatedAt: new Date('2026-07-06T08:00:00.000Z'),
        ...create,
      };
      this.usageAggregates.set(mapKey, record);
      return record;
    },
  };

  async $transaction<T>(handler: (tx: this) => Promise<T>): Promise<T> {
    return handler(this);
  }
}
