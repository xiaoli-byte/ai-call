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
      campaignId: 'campaign-1',
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
            campaignId: 'campaign-1',
            campaignLead: { displayName: '王先生' },
            variables: { amount: '5000' },
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
      campaignId: 'campaign-1',
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
});
