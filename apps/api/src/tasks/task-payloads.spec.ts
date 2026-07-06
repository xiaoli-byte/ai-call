import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOutboxPayload, toPrismaJson } from './task-payloads.js';

describe('task payload helpers', () => {
  it('validates dispatch payloads at the worker boundary', () => {
    const payload = parseOutboxPayload('call.dispatch_requested', {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      to: '+1001',
      from: '+1000',
    });

    assert.equal(payload.taskId, 'task-1');
    assert.equal(payload.attemptId, 'attempt-1');
    assert.equal(payload.to, '+1001');
  });

  it('rejects invalid dispatch payloads before delivery', () => {
    assert.throws(
      () => parseOutboxPayload('call.dispatch_requested', { taskId: 'task-1' }),
      /Invalid call\.dispatch_requested payload/,
    );
  });

  it('accepts CRM action payloads at the worker boundary', () => {
    const payload = parseOutboxPayload('action.crm', {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      to: '+1001',
      config: { action: 'create_after_sale_ticket', priority: 'high' },
    });

    assert.equal(payload.taskId, 'task-1');
    assert.equal(payload.attemptId, 'attempt-1');
    assert.equal(payload.to, '+1001');
    assert.deepEqual(payload.config, {
      action: 'create_after_sale_ticket',
      priority: 'high',
    });
  });

  it('sanitizes undefined fields for Prisma JSON columns', () => {
    assert.deepEqual(toPrismaJson({
      keep: 'value',
      drop: undefined,
      nested: { alsoDrop: undefined, ok: true },
      list: [undefined, 'x'],
    }), {
      keep: 'value',
      nested: { ok: true },
      list: [null, 'x'],
    });
  });
});
