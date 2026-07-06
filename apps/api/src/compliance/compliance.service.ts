import { Injectable } from '@nestjs/common';
import type {
  ComplianceAuditLog,
  CompliancePolicySummary,
  CompliancePolicyUpdateDto,
  UserProfile,
} from '@ai-call/shared';
import { DEFAULT_OUTBOUND_RULES } from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { GlobalConfigService } from '../global-config/global-config.service.js';
import { toPrismaJson } from '../tasks/task-payloads.js';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly globalConfig: GlobalConfigService,
  ) {}

  async getPolicy(): Promise<CompliancePolicySummary> {
    const config = await this.globalConfig.get();
    return toPolicySummary(config.outboundRules);
  }

  async updatePolicy(dto: CompliancePolicyUpdateDto, user?: UserProfile): Promise<CompliancePolicySummary> {
    const config = await this.globalConfig.update({ outboundRules: dto.outboundRules }, user);
    await this.prisma.complianceAuditLog.create({
      data: {
        action: 'compliance.policy_updated',
        subjectType: 'GlobalConfig',
        subjectId: 'default',
        actorId: user?.id,
        actorName: user?.name ?? user?.email,
        details: toPrismaJson({ reason: dto.reason, outboundRules: dto.outboundRules }),
      },
    });
    return toPolicySummary(config.outboundRules);
  }

  async listAuditLogs(limit = 50): Promise<ComplianceAuditLog[]> {
    const records = await this.prisma.complianceAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return records.map((record: any) => ({
      id: record.id,
      action: record.action,
      subjectType: record.subjectType ?? undefined,
      subjectId: record.subjectId ?? undefined,
      actorId: record.actorId ?? undefined,
      actorName: record.actorName ?? undefined,
      details: (record.details ?? {}) as Record<string, unknown>,
      createdAt: record.createdAt.toISOString(),
    }));
  }
}

function toPolicySummary(outboundRules: CompliancePolicyUpdateDto['outboundRules']): CompliancePolicySummary {
  const rules = {
    ...DEFAULT_OUTBOUND_RULES,
    ...outboundRules,
    callWindow: {
      ...DEFAULT_OUTBOUND_RULES.callWindow,
      ...outboundRules.callWindow,
    },
  };
  return {
    ...rules,
    blockedNumberCount: rules.blockedNumbers.length,
    whitelistCount: rules.globalWhitelist.length,
    aiDisclosureTemplate: rules.aiDisclosureTemplate ?? DEFAULT_OUTBOUND_RULES.aiDisclosureTemplate ?? '',
  };
}
