import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallOutcome, Scenario, TaskStatus } from '@ai-call/shared';
import { QualityService } from './quality.service.js';

describe('QualityService', () => {
  it('creates post-call analysis with summary, intent, and compliance flags', async () => {
    let upsertArgs: any;
    const prisma = {
      callAttempt: {
        findFirst: async () => ({
          id: 'attempt-1',
          taskId: 'task-1',
          status: TaskStatus.COMPLETED,
          duration: 80,
          task: {
            id: 'task-1',
            to: '+8613800138000',
            scenario: Scenario.COLLECTION,
            outcome: CallOutcome.REJECTED,
            intentTags: ['拒绝'],
          },
          transcripts: [
            { role: 'agent', content: '您好，我是 AI 外呼助手。', timestamp: 0 },
            { role: 'caller', content: '不要再联系我了。', timestamp: 3 },
          ],
          events: [],
        }),
      },
      callAnalysis: {
        upsert: async (args: any) => {
          upsertArgs = args;
          return {
            id: 'analysis-1',
            callAttemptId: 'attempt-1',
            taskId: 'task-1',
            ...args.create,
            createdAt: new Date('2026-07-06T08:00:00.000Z'),
            updatedAt: new Date('2026-07-06T08:00:00.000Z'),
          };
        },
      },
    };
    const service = new QualityService(prisma as any);

    const analysis = await service.analyzeCall('attempt-1');

    assert.equal(analysis.id, 'analysis-1');
    assert.equal(analysis.intent, '拒绝联系');
    assert.equal(analysis.riskLevel, 'high');
    assert.deepEqual(analysis.complianceFlags, ['do_not_call_request']);
    assert.equal(upsertArgs.where.callAttemptId, 'attempt-1');
  });
});
