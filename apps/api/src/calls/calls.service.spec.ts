import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { CallOutcome, Scenario, TaskStatus } from '@ai-call/shared';
import { CallsService } from './calls.service.js';

const firstStartedAt = new Date('2026-07-04T08:00:00.000Z');
const secondStartedAt = new Date('2026-07-04T07:00:00.000Z');

function makeAttempt(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'attempt-1',
    taskId: overrides.taskId ?? 'task-1',
    attemptNo: overrides.attemptNo ?? 1,
    providerCallId: overrides.providerCallId ?? 'provider-1',
    status: overrides.status ?? TaskStatus.COMPLETED,
    startedAt: overrides.startedAt ?? firstStartedAt,
    ringingAt: overrides.ringingAt ?? null,
    answeredAt: overrides.answeredAt ?? new Date('2026-07-04T08:00:10.000Z'),
    endedAt: overrides.endedAt ?? new Date('2026-07-04T08:02:10.000Z'),
    duration: overrides.duration ?? 120,
    hangupCause: overrides.hangupCause ?? null,
    recordingUrl: overrides.recordingUrl ?? 'https://example.test/recording.wav',
    createdAt: overrides.createdAt ?? firstStartedAt,
    updatedAt: overrides.updatedAt ?? firstStartedAt,
    task: overrides.task ?? {
      id: 'task-1',
      to: '+8613800138000',
      from: '+10000000000',
      scenario: Scenario.PRESALE,
      variables: { product: 'Model S' },
      scheduledAt: new Date('2026-07-04T07:59:00.000Z'),
      outcome: CallOutcome.HIGH_INTENT,
      intentTags: ['试驾'],
      flowId: 'flow-1',
      flowVersionId: 'flow-version-1',
      createdAt: new Date('2026-07-04T07:58:00.000Z'),
    },
    transcripts: overrides.transcripts ?? [],
    events: overrides.events ?? [],
    _count: overrides._count ?? { transcripts: 2, events: 3 },
  };
}

describe('CallsService', () => {
  it('lists call attempts by startedAt desc with filters and cursor paging', async () => {
    const calls = [
      makeAttempt({ id: 'attempt-1', startedAt: firstStartedAt }),
      makeAttempt({ id: 'attempt-2', startedAt: secondStartedAt }),
    ];
    let receivedArgs: any;
    const service = new CallsService({
      callAttempt: {
        findMany: async (args: any) => {
          receivedArgs = args;
          return calls;
        },
      },
    } as any);

    const page = await service.list({
      scenario: Scenario.PRESALE,
      status: TaskStatus.COMPLETED,
      outcome: CallOutcome.HIGH_INTENT,
      cursor: 'cursor-attempt',
      limit: 1,
    });

    assert.deepEqual(receivedArgs.where, {
      status: TaskStatus.COMPLETED,
      task: {
        scenario: Scenario.PRESALE,
        outcome: CallOutcome.HIGH_INTENT,
      },
    });
    assert.deepEqual(receivedArgs.orderBy, [{ startedAt: 'desc' }, { id: 'desc' }]);
    assert.equal(receivedArgs.take, 2);
    assert.deepEqual(receivedArgs.cursor, { id: 'cursor-attempt' });
    assert.equal(receivedArgs.skip, 1);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, 'attempt-1');
    assert.equal(page.items[0].to, '+8613800138000');
    assert.equal(page.items[0].transcriptCount, 2);
    assert.equal(page.nextCursor, 'attempt-1');
  });

  it('returns detail with transcripts and events', async () => {
    const service = new CallsService({
      callAttempt: {
        findFirst: async () => makeAttempt({
          transcripts: [
            { role: 'agent', content: '您好', timestamp: 0.1, emotion: null },
            { role: 'caller', content: '你好', timestamp: 1.2, emotion: 'neutral' },
          ],
          events: [
            {
              id: 'event-1',
              type: 'call.hung_up',
              payload: { duration: 120 },
              createdAt: new Date('2026-07-04T08:02:10.000Z'),
            },
          ],
        }),
      },
    } as any);

    const detail = await service.get('attempt-1');

    assert.equal(detail.id, 'attempt-1');
    assert.equal(detail.flowId, 'flow-1');
    assert.deepEqual(detail.variables, { product: 'Model S' });
    assert.deepEqual(detail.transcript.map((turn) => turn.content), ['您好', '你好']);
    assert.equal(detail.events[0].type, 'call.hung_up');
    assert.deepEqual(detail.events[0].payload, { duration: 120 });
  });

  it('throws not found for missing call attempt', async () => {
    const service = new CallsService({
      callAttempt: {
        findFirst: async () => null,
      },
    } as any);

    await assert.rejects(() => service.get('missing'), NotFoundException);
  });
});
