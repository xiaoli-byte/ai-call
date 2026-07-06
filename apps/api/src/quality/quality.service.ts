import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CallOutcome,
  type CallAnalysis,
  type CorrectCallAnalysisDto,
  type QualityListPage,
  type QualityQueryDto,
  type QualityRiskLevel,
  type UserProfile,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrismaJson } from '../tasks/task-payloads.js';

@Injectable()
export class QualityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QualityQueryDto = {}): Promise<QualityListPage> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const records = await this.prisma.callAnalysis.findMany({
      where: {
        riskLevel: query.riskLevel,
        outcome: query.outcome,
        task: { campaignId: query.campaignId },
      },
      include: {
        task: { select: { to: true, scenario: true } },
        callAttempt: { select: { status: true, duration: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = records.length > limit;
    const pageRecords = hasMore ? records.slice(0, limit) : records;
    return {
      items: pageRecords.map((record: any) => ({
        ...this.toDomain(record),
        to: record.task?.to,
        scenario: record.task?.scenario,
        status: record.callAttempt?.status,
        duration: record.callAttempt?.duration ?? undefined,
      })),
      nextCursor: hasMore ? pageRecords.at(-1)?.id : undefined,
    };
  }

  async analyzeCall(callAttemptId: string): Promise<CallAnalysis> {
    const call = await this.prisma.callAttempt.findFirst({
      where: { OR: [{ id: callAttemptId }, { providerCallId: callAttemptId }] },
      include: {
        task: {
          select: {
            id: true,
            to: true,
            scenario: true,
            outcome: true,
            intentTags: true,
          },
        },
        transcripts: { orderBy: { createdAt: 'asc' as const } },
        events: { orderBy: { createdAt: 'asc' as const } },
      },
    });
    if (!call) throw new NotFoundException(`CallAttempt ${callAttemptId} not found`);

    const proposal = buildAnalysisProposal(call);
    const record = await this.prisma.callAnalysis.upsert({
      where: { callAttemptId: call.id },
      create: {
        callAttemptId: call.id,
        taskId: call.taskId,
        summary: proposal.summary,
        intent: proposal.intent,
        outcome: proposal.outcome,
        refusalReason: proposal.refusalReason,
        nextAction: proposal.nextAction,
        riskLevel: proposal.riskLevel,
        complianceFlags: toPrismaJson(proposal.complianceFlags),
        confidence: proposal.confidence,
      },
      update: {
        summary: proposal.summary,
        intent: proposal.intent,
        outcome: proposal.outcome,
        refusalReason: proposal.refusalReason,
        nextAction: proposal.nextAction,
        riskLevel: proposal.riskLevel,
        complianceFlags: toPrismaJson(proposal.complianceFlags),
        confidence: proposal.confidence,
      },
    });
    return this.toDomain(record);
  }

  async correctAnalysis(
    id: string,
    dto: CorrectCallAnalysisDto,
    user?: UserProfile,
  ): Promise<CallAnalysis> {
    const existing = await this.prisma.callAnalysis.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`CallAnalysis ${id} not found`);
    const record = await this.prisma.callAnalysis.update({
      where: { id },
      data: {
        ...defined({
          summary: dto.summary,
          intent: dto.intent,
          outcome: dto.outcome,
          refusalReason: dto.refusalReason,
          nextAction: dto.nextAction,
          riskLevel: dto.riskLevel,
          complianceFlags: dto.complianceFlags ? toPrismaJson(dto.complianceFlags) : undefined,
        }),
        correctedAt: new Date(),
        correctedBy: user?.name ?? user?.email ?? user?.id,
      },
    });
    return this.toDomain(record);
  }

  private toDomain(record: any): CallAnalysis {
    return {
      id: record.id,
      callAttemptId: record.callAttemptId,
      taskId: record.taskId,
      summary: record.summary,
      intent: record.intent,
      outcome: record.outcome ?? undefined,
      refusalReason: record.refusalReason ?? undefined,
      nextAction: record.nextAction,
      riskLevel: record.riskLevel,
      complianceFlags: Array.isArray(record.complianceFlags) ? record.complianceFlags.map(String) : [],
      confidence: Number(record.confidence ?? 0),
      correctedAt: record.correctedAt?.toISOString(),
      correctedBy: record.correctedBy ?? undefined,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

function buildAnalysisProposal(call: any) {
  const transcript = (call.transcripts ?? [])
    .map((turn: any) => `${turn.role}: ${turn.content}`)
    .join('\n');
  const lower = transcript.toLowerCase();
  const flags: string[] = [];
  const hasDoNotCall = /不要再联系|别再打|不要打|do not call|stop calling/.test(lower);
  const hasDisclosure = /ai|人工智能|机器人|外呼助手/.test(lower);
  if (hasDoNotCall) flags.push('do_not_call_request');
  if (!hasDisclosure) flags.push('missing_ai_disclosure');

  const outcome = call.task?.outcome as CallOutcome | undefined;
  const intent = hasDoNotCall
    ? '拒绝联系'
    : outcome === CallOutcome.HIGH_INTENT
      ? '高意向'
      : outcome === CallOutcome.MEDIUM_INTENT
        ? '中意向'
        : outcome === CallOutcome.ESCALATED
          ? '需人工跟进'
          : '待判断';
  const riskLevel: QualityRiskLevel = flags.includes('do_not_call_request')
    ? 'high'
    : flags.length > 0
      ? 'medium'
      : 'low';
  const callerTurns = (call.transcripts ?? []).filter((turn: any) => turn.role === 'caller');
  const summary = callerTurns.length
    ? `客户主要表达：${callerTurns.map((turn: any) => turn.content).join('；').slice(0, 180)}`
    : '本通电话暂无客户有效转写。';

  return {
    summary,
    intent,
    outcome,
    refusalReason: hasDoNotCall ? '客户明确要求停止联系' : undefined,
    nextAction: hasDoNotCall
      ? '加入退订/黑名单候选并停止后续触达'
      : outcome === CallOutcome.ESCALATED
        ? '安排人工坐席跟进'
        : '进入活动结果复盘',
    riskLevel,
    complianceFlags: flags,
    confidence: transcript ? 0.78 : 0.35,
  };
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
