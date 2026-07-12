import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CallOutcome,
  TaskPriority,
  TaskStatus,
  type CreateCallbackTaskDto,
  type HandoffListPage,
  type HandoffTicket,
  type HandoffTicketStatus,
  type UpdateHandoffTicketDto,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { toPrismaJson } from '../common/prisma-json.js';

@Injectable()
export class HandoffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
  ) {}

  async list(query: {
    status?: HandoffTicketStatus;
    limit?: number;
    cursor?: string;
  } = {}): Promise<HandoffListPage> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const [records, counts] = await Promise.all([
      (this.prisma as any).handoffTicket.findMany({
        where: { status: query.status },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.counts(),
    ]);
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    return {
      items: items.map((record: any) => this.toDomain(record)),
      counts,
      nextCursor: hasMore ? items.at(-1)?.id : undefined,
    };
  }

  async get(id: string): Promise<HandoffTicket> {
    const record = await (this.prisma as any).handoffTicket.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`HandoffTicket ${id} not found`);
    return this.toDomain(record);
  }

  async createFromAnalysis(callAnalysisId: string): Promise<HandoffTicket> {
    const analysis = await (this.prisma as any).callAnalysis.findUnique({
      where: { id: callAnalysisId },
      include: {
        task: true,
      },
    });
    if (!analysis) throw new NotFoundException(`CallAnalysis ${callAnalysisId} not found`);
    const task = analysis.task;
    const riskTags = [
      analysis.riskLevel === 'high' ? 'high_risk' : undefined,
      ...(Array.isArray(analysis.complianceFlags) ? analysis.complianceFlags : []),
    ].filter((item): item is string => Boolean(item));
    const record = await (this.prisma as any).handoffTicket.upsert({
      where: { callAnalysisId },
      create: {
        status: 'pending',
        taskId: analysis.taskId,
        callAttemptId: analysis.callAttemptId,
        callAnalysisId,
        phoneNumber: task?.to ?? '',
        customerName: task?.variables?.customerName,
        summary: analysis.summary,
        intent: analysis.intent,
        riskTags: toPrismaJson(riskTags),
        recommendedAction: analysis.nextAction,
      },
      update: {
        summary: analysis.summary,
        intent: analysis.intent,
        riskTags: toPrismaJson(riskTags),
        recommendedAction: analysis.nextAction,
      },
    });
    return this.toDomain(record);
  }

  async update(id: string, dto: UpdateHandoffTicketDto): Promise<HandoffTicket> {
    await this.get(id);
    const completed = dto.status === 'completed' || dto.status === 'closed';
    const record = await (this.prisma as any).handoffTicket.update({
      where: { id },
      data: {
        status: dto.status,
        disposition: dto.disposition,
        notes: dto.notes,
        assignedTo: dto.assignedTo,
        completedAt: dto.status === undefined ? undefined : completed ? new Date() : null,
      },
    });
    await this.applyDispositionSideEffects(record);
    return this.toDomain(record);
  }

  async createCallbackTask(id: string, dto: CreateCallbackTaskDto): Promise<HandoffTicket> {
    const ticket = await (this.prisma as any).handoffTicket.findUnique({
      where: { id },
      include: { task: true },
    });
    if (!ticket) throw new NotFoundException(`HandoffTicket ${id} not found`);
    const task = await this.tasks.create({
      to: ticket.phoneNumber,
      from: ticket.task?.from,
      scenario: ticket.task?.scenario ?? 'collection',
      scenarioId: ticket.task?.scenarioId ?? undefined,
      flowId: ticket.task?.flowId ?? undefined,
      scheduledAt: dto.scheduledAt,
      status: TaskStatus.PENDING,
      priority: TaskPriority.HIGH,
      variables: {
        ...(ticket.task?.variables ?? {}),
        handoffTicketId: ticket.id,
        handoffAssignedTo: dto.assignedTo ?? ticket.assignedTo ?? '',
        callbackReason: ticket.recommendedAction,
      },
    } as any);
    const record = await (this.prisma as any).handoffTicket.update({
      where: { id },
      data: {
        status: 'processing',
        disposition: 'callback_required',
        assignedTo: dto.assignedTo ?? ticket.assignedTo,
        callbackTaskId: task.id,
      },
    });
    return this.toDomain(record);
  }

  private async counts(): Promise<Record<HandoffTicketStatus, number>> {
    const statuses: HandoffTicketStatus[] = ['pending', 'processing', 'completed', 'closed'];
    const entries = await Promise.all(statuses.map(async (status) => [
      status,
      await (this.prisma as any).handoffTicket.count?.({
        where: { status },
      }) ?? 0,
    ] as const));
    return Object.fromEntries(entries) as Record<HandoffTicketStatus, number>;
  }

  private async applyDispositionSideEffects(record: any): Promise<void> {
    if (!record.disposition) return;
    const outcome = dispositionToOutcome(record.disposition);
    if (!outcome) return;
    await (this.prisma as any).outboundTask.update?.({
      where: { id: record.taskId },
      data: { outcome },
    });
  }

  private toDomain(record: any): HandoffTicket {
    return {
      id: record.id,
      status: record.status,
      taskId: record.taskId,
      callAttemptId: record.callAttemptId ?? undefined,
      callAnalysisId: record.callAnalysisId ?? undefined,
      phoneNumber: record.phoneNumber,
      customerName: record.customerName ?? undefined,
      summary: record.summary,
      intent: record.intent,
      riskTags: Array.isArray(record.riskTags) ? record.riskTags.map(String) : [],
      recommendedAction: record.recommendedAction,
      disposition: record.disposition ?? undefined,
      notes: record.notes ?? undefined,
      assignedTo: record.assignedTo ?? undefined,
      callbackTaskId: record.callbackTaskId ?? undefined,
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
      completedAt: record.completedAt ? toIso(record.completedAt) : undefined,
    };
  }
}

function dispositionToOutcome(disposition: string): CallOutcome | undefined {
  if (disposition === 'converted') return CallOutcome.HIGH_INTENT;
  if (disposition === 'not_interested') return CallOutcome.REJECTED;
  if (disposition === 'complaint_risk') return CallOutcome.ESCALATED;
  return undefined;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}
