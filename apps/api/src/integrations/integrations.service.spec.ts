import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IntegrationsService } from './integrations.service.js';

describe('IntegrationsService', () => {
  it('tests a webhook connector and records a tool call log with request and response evidence', async () => {
    let createdLog: any;
    const prisma = {
      integrationConnector: {
        create: async ({ data }: any) => ({
          id: 'connector-1',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
          updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
      toolCallLog: {
        create: async ({ data }: any) => {
          createdLog = data;
          return {
            id: 'log-1',
            ...data,
            createdAt: new Date('2026-07-07T08:00:01.000Z'),
          };
        },
      },
    };
    const service = new IntegrationsService(prisma as any);

    const connector = await service.create({
      name: 'CRM Webhook',
      type: 'crm',
      endpoint: 'mock://crm/leads',
      authType: 'none',
      requestTemplate: { phone: '{{phone}}', intent: '{{intent}}' },
      responseMapping: { externalId: '$.id' },
      enabled: true,
    });
    const result = await service.test(connector.id, {
      sampleVariables: { phone: '+8613800138000', intent: '试驾' },
    });

    assert.equal(result.connectorId, 'connector-1');
    assert.equal(result.status, 'success');
    assert.equal(result.request.body.phone, '+8613800138000');
    assert.equal(result.response?.body.ok, true);
    assert.equal(createdLog.connectorId, 'connector-1');
    assert.equal(createdLog.status, 'success');
    assert.equal(createdLog.retryCount, 0);
  });
});
