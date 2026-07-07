import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service.js';

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

describe('IntegrationsService', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = originalFetch;
  });

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
    const requestBody = result.request.body as Record<string, unknown>;
    const responseBody = result.response?.body as Record<string, unknown> | undefined;
    assert.equal(requestBody.phone, '+8613800138000');
    assert.equal(responseBody?.ok, true);
    assert.equal(createdLog.connectorId, 'connector-1');
    assert.equal(createdLog.status, 'success');
    assert.equal(createdLog.retryCount, 0);
  });

  it('does not expose stored auth config in connector responses', async () => {
    let stored: any;
    const prisma = {
      integrationConnector: {
        create: async ({ data }: any) => {
          stored = {
            id: 'connector-secret',
            ...data,
            createdAt: new Date('2026-07-07T08:00:00.000Z'),
            updatedAt: new Date('2026-07-07T08:00:00.000Z'),
          };
          return stored;
        },
        findMany: async () => [stored],
      },
    };
    const service = new IntegrationsService(prisma as any);

    const created = await service.create({
      name: 'CRM Secret',
      type: 'crm',
      endpoint: 'mock://crm/leads',
      authType: 'bearer',
      authConfig: { token: 'secret-token' },
    });
    const [listed] = await service.list();

    assert.equal('authConfig' in created, false);
    assert.equal('authConfig' in listed, false);
  });

  it('rejects private connector endpoints before persisting', async () => {
    const prisma = {
      integrationConnector: {
        create: async () => {
          throw new Error('should not persist unsafe endpoints');
        },
      },
    };
    const service = new IntegrationsService(prisma as any);

    await assert.rejects(
      () => service.create({
        name: 'Internal Host',
        type: 'internal_api',
        endpoint: 'http://127.0.0.1:8080/admin',
      }),
      BadRequestException,
    );
  });

  it('sends basic auth headers for allowlisted connector endpoints', async () => {
    process.env.INTEGRATION_CONNECTOR_ALLOWLIST = 'api.example.com';
    let requestHeaders: unknown;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const prisma = {
      integrationConnector: {
        create: async ({ data }: any) => ({
          id: 'connector-basic',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
          updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
      toolCallLog: {
        create: async ({ data }: any) => ({
          id: 'log-basic',
          ...data,
          createdAt: new Date('2026-07-07T08:00:01.000Z'),
        }),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const connector = await service.create({
      name: 'Basic CRM',
      type: 'crm',
      endpoint: 'https://api.example.com/hook',
      authType: 'basic',
      authConfig: { username: 'alice', password: 'secret' },
    });
    const result = await service.test(connector.id, { sampleVariables: {} });

    assert.equal(result.status, 'success');
    assert.equal((requestHeaders as Record<string, string>).authorization, 'Basic YWxpY2U6c2VjcmV0');
  });

  it('allows wildcard allowlisted connector endpoints', async () => {
    process.env.INTEGRATION_CONNECTOR_ALLOWLIST = '*.example.com';
    let requestUrl: string | undefined;
    globalThis.fetch = async (url: string | URL | Request) => {
      requestUrl = url instanceof Request ? url.url : url.toString();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const prisma = {
      integrationConnector: {
        create: async ({ data }: any) => ({
          id: 'connector-wildcard',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
          updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
      toolCallLog: {
        create: async ({ data }: any) => ({
          id: 'log-wildcard',
          ...data,
          createdAt: new Date('2026-07-07T08:00:01.000Z'),
        }),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const connector = await service.create({
      name: 'Wildcard CRM',
      type: 'crm',
      endpoint: 'https://crm.example.com/hook',
      authType: 'none',
    });
    const result = await service.test(connector.id, { sampleVariables: {} });

    assert.equal(result.status, 'success');
    assert.equal(requestUrl, 'https://crm.example.com/hook');
  });

  it('does not fetch stored connector endpoints outside the allowlist', async () => {
    process.env.INTEGRATION_CONNECTOR_ALLOWLIST = 'api.example.com';
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const prisma = {
      integrationConnector: {
        findUnique: async () => ({
          id: 'connector-blocked',
          name: 'Blocked CRM',
          type: 'crm',
          endpoint: 'https://blocked.example.net/hook',
          method: 'POST',
          authType: 'none',
          authConfig: {},
          requestTemplate: {},
          responseMapping: {},
          enabled: true,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
          updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
      toolCallLog: {
        create: async ({ data }: any) => ({
          id: 'log-blocked',
          ...data,
          createdAt: new Date('2026-07-07T08:00:01.000Z'),
        }),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const result = await service.test('connector-blocked', { sampleVariables: {} });

    assert.equal(result.status, 'failed');
    assert.equal(fetchCalls, 0);
    assert.match(result.errorMessage ?? '', /allowlist|allowlisted/);
  });
});
