import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { KnowledgeIdentitySyncService } from './knowledge-identity-sync.service.js';

const ENV_KEYS = [
  'KNOWLEDGE_SERVICE_BASE_URL',
  'KNOWLEDGE_SERVICE_API_TOKEN',
  'KNOWLEDGE_SERVICE_TIMEOUT_MS',
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const savedFetch = globalThis.fetch;

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = savedFetch;
});

describe('KnowledgeIdentitySyncService', () => {
  it('projects lifecycle changes with the service identity headers', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://knowledge.test/api/';
    process.env.KNOWLEDGE_SERVICE_API_TOKEN = 'sync-token';
    let request: Request | undefined;
    globalThis.fetch = async (input, init) => {
      request = new Request(input, init);
      return Response.json({ id: 'u-1', status: 'inactive' });
    };

    const service = new KnowledgeIdentitySyncService();
    await service.sync({
      id: 'u-1',
      email: 'User@Example.test',
      name: 'User',
      status: 'inactive',
      roles: ['operator'],
    });

    assert.equal(request?.url, 'http://knowledge.test/api/federation/users/sync');
    assert.equal(request?.method, 'PUT');
    assert.equal(request?.headers.get('x-service-token'), 'sync-token');
    assert.deepEqual(await request?.json(), {
      id: 'u-1',
      email: 'User@Example.test',
      name: 'User',
      role: 'editor',
      status: 'inactive',
    });
  });

  it('turns an email collision into an actionable conflict', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://knowledge.test/api';
    process.env.KNOWLEDGE_SERVICE_API_TOKEN = 'sync-token';
    globalThis.fetch = async () => new Response('email collision', { status: 409 });

    const service = new KnowledgeIdentitySyncService();
    await assert.rejects(
      service.sync({ id: 'u-1', email: 'user@example.test', name: 'User', status: 'active', roles: ['viewer'] }),
      ConflictException,
    );
  });
});
