import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TENANT_ID,
  type OrganizationsOverview,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { numberValue, toIso } from './platform-utils.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<OrganizationsOverview> {
    const tenants = await (this.prisma as any).tenant.findMany({
      include: {
        providerConfigs: { select: { id: true } },
        quotaPolicies: { select: { id: true } },
        billingAccount: { select: { status: true } },
        usageAggregates: {
          orderBy: { bucketStart: 'desc' },
          take: 6,
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      generatedAt: new Date().toISOString(),
      organizations: tenants.map((tenant: any) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        billingStatus: tenant.billingAccount?.status ?? 'trial',
        providerCount: tenant.providerConfigs?.length ?? 0,
        quotaCount: tenant.quotaPolicies?.length ?? 0,
        usage: (tenant.usageAggregates ?? []).map((usage: any) => ({
          metric: usage.metric,
          period: usage.period,
          quantity: numberValue(usage.quantity),
          eventCount: numberValue(usage.eventCount),
          bucketStart: toIso(usage.bucketStart),
        })),
        createdAt: toIso(tenant.createdAt),
        updatedAt: toIso(tenant.updatedAt),
      })),
      isolation: {
        defaultTenantId: DEFAULT_TENANT_ID,
        coveredResources: [
          'Tenant',
          'TenantProviderConfig',
          'TenantQuotaPolicy',
          'UsageEvent',
          'UsageAggregate',
          'BillingAccount',
        ],
        pendingResources: [
          'OutboundTask',
          'TaskFlow',
          'KnowledgeDocument',
          'VoiceClone',
          'IntegrationConnector',
        ],
        note: 'Legacy operational data remains attached to the default tenant until each product table is migrated behind an explicit tenant boundary.',
      },
    };
  }
}
