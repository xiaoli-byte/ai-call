import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ActionDeliveryService } from './action-delivery.service.js';

const ORIGINAL_ENV = { ...process.env };

describe('ActionDeliveryService', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('sends SMS with idempotency and falls back to task phone', async () => {
    process.env.SMS_GATEWAY_URL = 'https://sms.example.com/send';
    process.env.SMS_GATEWAY_TOKEN = 'token-1';
    const requests: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200 });
    };

    await new ActionDeliveryService().deliverSms(
      { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', config: { template: 'welcome' } },
      'idem-1',
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://sms.example.com/send');
    assert.equal((requests[0].init.headers as Record<string, string>)['Authorization'], 'Bearer token-1');
    assert.equal((requests[0].init.headers as Record<string, string>)['Idempotency-Key'], 'idem-1');
    assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
      to: '+1001',
      template: 'welcome',
      params: {},
      taskId: 'task-1',
      attemptId: 'attempt-1',
    });
  });

  it('rejects webhook hosts outside allowlist', async () => {
    process.env.ACTION_WEBHOOK_ALLOWLIST = 'allowed.example.com';
    await assert.rejects(
      () => new ActionDeliveryService().deliverWebhook({
        taskId: 'task-1',
        config: { url: 'https://blocked.example.com/hook' },
      }, 'idem-2'),
      BadRequestException,
    );
  });

  it('dispatches CRM actions through the tool service', async () => {
    const calls: Array<[string, unknown]> = [];
    const tools = {
      createAfterSaleTicket: (args: unknown) => {
        calls.push(['createAfterSaleTicket', args]);
        return { ticketId: 'AST-1' };
      },
    };

    const result = await new ActionDeliveryService(undefined, tools as never).deliverCrm({
      taskId: 'task-1',
      attemptId: 'attempt-1',
      config: {
        action: 'create_after_sale_ticket',
        arguments: { orderNo: 'O-1', issueType: 'missing', description: '未收到' },
      },
    }, 'crm-1');

    assert.deepEqual(calls, [
      ['createAfterSaleTicket', {
        orderNo: 'O-1',
        issueType: 'missing',
        description: '未收到',
      }],
    ]);
    assert.deepEqual(result, { ticketId: 'AST-1' });
  });
});
