import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallOutcome, Scenario, TaskStatus } from '@ai-call/shared';
import { HandoffsService } from './handoffs.service.js';

describe('HandoffsService', () => {
  it('creates a handoff ticket from a risky call analysis and creates a callback task', async () => {
    const createdTasks: any[] = [];
    let ticket: any = {
      id: 'handoff-1',
      status: 'pending',
      taskId: 'task-1',
      callAttemptId: 'attempt-1',
      callAnalysisId: 'analysis-1',
      phoneNumber: '+8613800138000',
      customerName: '王先生',
      summary: '客户希望人工协商延期',
      intent: '需人工跟进',
      riskTags: ['high_risk'],
      recommendedAction: '安排坐席回拨',
      disposition: null,
      notes: null,
      callbackTaskId: null,
      createdAt: new Date('2026-07-07T08:00:00.000Z'),
      updatedAt: new Date('2026-07-07T08:00:00.000Z'),
      completedAt: null,
    };
    const prisma = {
      callAnalysis: {
        findUnique: async () => ({
          id: 'analysis-1',
          callAttemptId: 'attempt-1',
          taskId: 'task-1',
          summary: ticket.summary,
          intent: ticket.intent,
          nextAction: ticket.recommendedAction,
          riskLevel: 'high',
          complianceFlags: ['manual_escalation'],
          task: {
            id: 'task-1',
            to: ticket.phoneNumber,
            scenario: Scenario.COLLECTION,
            variables: { amount: '5000', customerName: '王先生' },
          },
        }),
      },
      handoffTicket: {
        upsert: async ({ create }: any) => {
          ticket = { ...ticket, ...create };
          return ticket;
        },
        findUnique: async () => ticket,
        update: async ({ data }: any) => {
          ticket = { ...ticket, ...data, updatedAt: new Date('2026-07-07T08:05:00.000Z') };
          return ticket;
        },
      },
    };
    const tasks = {
      create: async (dto: any) => {
        createdTasks.push(dto);
        return { id: 'callback-task-1', ...dto };
      },
    };
    const service = new HandoffsService(prisma as any, tasks as any);

    const created = await service.createFromAnalysis('analysis-1');
    const callback = await service.createCallbackTask(created.id, {
      scheduledAt: '2026-07-07T10:00:00.000Z',
      assignedTo: '坐席A',
    });

    assert.equal(created.phoneNumber, '+8613800138000');
    assert.equal(created.riskTags[0], 'high_risk');
    assert.equal(callback.callbackTaskId, 'callback-task-1');
    assert.equal(createdTasks[0].scenario, Scenario.COLLECTION);
    assert.equal(createdTasks[0].status, TaskStatus.PENDING);
  });

  it('clears completedAt when reopening a completed ticket', async () => {
    let ticket: any = {
      id: 'handoff-1',
      status: 'completed',
      taskId: 'task-1',
      callAttemptId: 'attempt-1',
      callAnalysisId: 'analysis-1',
      phoneNumber: '+8613800138000',
      customerName: '客户A',
      summary: '需要继续跟进',
      intent: '人工处理',
      riskTags: ['high_risk'],
      recommendedAction: '重新分配',
      disposition: null,
      notes: null,
      callbackTaskId: null,
      createdAt: new Date('2026-07-07T08:00:00.000Z'),
      updatedAt: new Date('2026-07-07T08:00:00.000Z'),
      completedAt: new Date('2026-07-07T09:00:00.000Z'),
    };
    const prisma = {
      handoffTicket: {
        findUnique: async () => ticket,
        update: async ({ data }: any) => {
          for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) ticket[key] = value;
          }
          return ticket;
        },
      },
    };
    const service = new HandoffsService(prisma as any, {} as any);

    const updated = await service.update('handoff-1', { status: 'pending' });

    assert.equal(ticket.completedAt, null);
    assert.equal(updated.completedAt, undefined);
  });

  it('lists handoffs with cursor paging and status counts', async () => {
    const records = [
      {
        id: 'handoff-1',
        status: 'pending',
        taskId: 'task-1',
        callAttemptId: 'attempt-1',
        callAnalysisId: 'analysis-1',
        phoneNumber: '+8613800138000',
        customerName: 'Customer A',
        summary: 'Needs manual follow-up',
        intent: 'manual_review',
        riskTags: ['high_risk'],
        recommendedAction: 'Assign agent',
        disposition: null,
        notes: null,
        callbackTaskId: null,
        createdAt: new Date('2026-07-07T08:00:00.000Z'),
        updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'handoff-2',
        status: 'pending',
        taskId: 'task-2',
        callAttemptId: 'attempt-2',
        callAnalysisId: 'analysis-2',
        phoneNumber: '+8613800138001',
        customerName: 'Customer B',
        summary: 'Also needs manual follow-up',
        intent: 'manual_review',
        riskTags: ['high_risk'],
        recommendedAction: 'Assign agent',
        disposition: null,
        notes: null,
        callbackTaskId: null,
        createdAt: new Date('2026-07-07T07:00:00.000Z'),
        updatedAt: new Date('2026-07-07T07:00:00.000Z'),
        completedAt: null,
      },
    ];
    const counts: Record<string, number> = {
      pending: 2,
      processing: 1,
      completed: 3,
      closed: 4,
    };
    let receivedFindArgs: any;
    const countArgs: any[] = [];
    const prisma = {
      handoffTicket: {
        findMany: async (args: any) => {
          receivedFindArgs = args;
          return records;
        },
        count: async (args: any) => {
          countArgs.push(args);
          return counts[args.where.status];
        },
      },
    };
    const service = new HandoffsService(prisma as any, {} as any);

    const page = await service.list({
      status: 'pending',
      limit: 1,
      cursor: 'handoff-cursor',
    });

    assert.deepEqual(receivedFindArgs.where, { status: 'pending' });
    assert.deepEqual(receivedFindArgs.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.deepEqual(receivedFindArgs.cursor, { id: 'handoff-cursor' });
    assert.equal(receivedFindArgs.skip, 1);
    assert.equal(receivedFindArgs.take, 2);
    assert.deepEqual(countArgs.map((args) => args.where), [
      { status: 'pending' },
      { status: 'processing' },
      { status: 'completed' },
      { status: 'closed' },
    ]);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, 'handoff-1');
    assert.equal(page.nextCursor, 'handoff-1');
    assert.deepEqual(page.counts, {
      pending: 2,
      processing: 1,
      completed: 3,
      closed: 4,
    });
  });

  it('sets outbound task outcome when completing a converted handoff', async () => {
    const ticket: any = {
      id: 'handoff-1',
      status: 'pending',
      taskId: 'task-1',
      callAttemptId: 'attempt-1',
      callAnalysisId: 'analysis-1',
      phoneNumber: '+8613800138000',
      customerName: 'Customer A',
      summary: 'Needs manual follow-up',
      intent: 'manual_review',
      riskTags: ['high_risk'],
      recommendedAction: 'Assign agent',
      disposition: null,
      notes: null,
      callbackTaskId: null,
      createdAt: new Date('2026-07-07T08:00:00.000Z'),
      updatedAt: new Date('2026-07-07T08:00:00.000Z'),
      completedAt: null,
    };
    let handoffUpdatePayload: any;
    let outboundTaskUpdateArgs: any;
    const prisma = {
      handoffTicket: {
        findUnique: async () => ticket,
        update: async ({ data }: any) => {
          handoffUpdatePayload = data;
          return {
            ...ticket,
            ...data,
            updatedAt: new Date('2026-07-07T08:05:00.000Z'),
          };
        },
      },
      outboundTask: {
        update: async (args: any) => {
          outboundTaskUpdateArgs = args;
          return { id: args.where.id, ...args.data };
        },
      },
    };
    const service = new HandoffsService(prisma as any, {} as any);

    await service.update('handoff-1', { status: 'completed', disposition: 'converted' });

    assert.equal(handoffUpdatePayload.status, 'completed');
    assert.equal(handoffUpdatePayload.disposition, 'converted');
    assert.ok(handoffUpdatePayload.completedAt instanceof Date);
    assert.deepEqual(outboundTaskUpdateArgs, {
      where: { id: 'task-1' },
      data: { outcome: CallOutcome.HIGH_INTENT },
    });
  });
});
