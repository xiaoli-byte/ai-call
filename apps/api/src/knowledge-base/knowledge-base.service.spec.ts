import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { KnowledgeBaseService } from './knowledge-base.service.js';

const ENV_KEYS = [
  'KNOWLEDGE_SERVICE_BASE_URL',
  'KNOWLEDGE_SERVICE_API_TOKEN',
  'KNOWLEDGE_SERVICE_TIMEOUT_MS',
  'SERVICE_API_TOKEN',
  'KNOWLEDGE_SERVICE_FALLBACK_USER_ID',
] as const;
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);
const savedFetch = globalThis.fetch;

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = savedFetch;
});

describe('KnowledgeBaseService', () => {
  it('stores uploaded documents with index status and returns citations from a retrieval test', async () => {
    const documents: any[] = [];
    const prisma = {
      knowledgeDocument: {
        create: async ({ data }: any) => {
          const record = {
            id: 'kdoc-1',
            ...data,
            createdAt: new Date('2026-07-07T08:00:00.000Z'),
            updatedAt: new Date('2026-07-07T08:00:00.000Z'),
            indexedAt: new Date('2026-07-07T08:00:00.000Z'),
          };
          documents.push(record);
          return record;
        },
        findMany: async () => documents,
      },
    };
    const service = new KnowledgeBaseService(prisma as any);

    const uploaded = await service.upload(
      'kb-demo',
      '延期政策.md',
      Buffer.from('延期还款最长 90 天，需提供失业或生病证明。'),
    );
    const tested = await service.testRetrieve('kb-demo', {
      query: '延期还款需要什么材料',
      topK: 3,
    });

    assert.ok(uploaded.document);
    assert.equal(uploaded.document.indexStatus, 'indexed');
    assert.equal(uploaded.document.chunkCount > 0, true);
    assert.equal(tested.results[0].source, '延期政策.md');
    assert.equal(tested.lowConfidence, false);
    assert.match(tested.answer, /延期/);
  });

  it('uses built-in mock data when external knowledge service is not configured', async () => {
    delete process.env.KNOWLEDGE_SERVICE_BASE_URL;
    const service = new KnowledgeBaseService();

    const list = await service.list();
    const results = await service.retrieve('kb-collection', '延期', 3);

    assert.equal(list.some((kb) => kb.id === 'kb-collection'), true);
    assert.equal(results.length, 1);
    assert.equal(results[0].source, '延期政策.pdf');
  });

  it('combines and globally ranks results from multiple knowledge bases', async () => {
    delete process.env.KNOWLEDGE_SERVICE_BASE_URL;
    const service = new KnowledgeBaseService();

    const results = await service.retrieveMany(['kb-collection', 'kb-ecommerce'], '延期 商品', 2);

    assert.equal(results.length, 2);
    assert.equal((results[0]?.score ?? 0) >= (results[1]?.score ?? 0), true);
  });

  it('uses ai-knowledge folders as selectable knowledge bases in external mode', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    const calls: string[] = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return Response.json([
        { id: 'folder-1', name: '订单资料' },
        { id: 'folder-2', name: '商品资料' },
      ]);
    };
    const service = new KnowledgeBaseService(undefined, fakeCls({ tenantId: 'tenant-a' }) as any);

    const knowledgeBases = await service.list();

    assert.deepEqual(calls, ['http://127.0.0.1:3010/api/folders/selectable']);
    assert.deepEqual(knowledgeBases, [
      { id: 'folder-1', name: '订单资料', docCount: 0, parentId: null, children: [] },
      { id: 'folder-2', name: '商品资料', docCount: 0, parentId: null, children: [] },
    ]);
  });

  it('proxies retrieve requests to the external knowledge service', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api/';
    process.env.KNOWLEDGE_SERVICE_API_TOKEN = 'service-token';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        results: [
          {
            id: 'chunk-1',
            content: '外部知识库返回的内容',
            source: 'external.md',
            score: 0.91,
          },
        ],
      });
    };

    const cls = fakeCls({
      tenantId: 'tenant-a',
      userId: 'user-a',
      roles: ['operator', 'viewer'],
    });
    const service = new KnowledgeBaseService(undefined, cls as any);
    const results = await service.retrieve('kb-collection', '怎么延期', 5);

    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'external.md');
    assert.equal(calls[0].url, 'http://127.0.0.1:3010/api/search/retrieve');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(
      calls[0].init?.body,
      JSON.stringify({ q: '怎么延期', mode: 'hybrid', topK: 5, knowledgeBaseId: 'kb-collection' }),
    );
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('x-service-token'), 'service-token');
    assert.equal(headers.get('x-tenant-id'), 'tenant-a');
    assert.equal(headers.get('x-user-id'), 'user-a');
    assert.equal(headers.get('x-user-roles'), 'editor');
    assert.equal(headers.get('x-user-role'), 'editor');
  });

  it('accepts array responses from external retrieve endpoints', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    const cls = fakeCls({ tenantId: 'tenant-a' });
    globalThis.fetch = async () =>
      Response.json([
        {
          id: 'chunk-1',
          content: '数组格式响应',
          source: 'external.md',
          score: 0.8,
        },
      ]);

    const service = new KnowledgeBaseService(undefined, cls as any);
    const results = await service.retrieve('kb-collection', '问题', 3);

    assert.equal(results.length, 1);
    assert.equal(results[0].content, '数组格式响应');
  });

  it('fails closed when external retrieve is attempted without tenant context', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';

    const service = new KnowledgeBaseService();

    await assert.rejects(
      () => service.retrieve('kb-collection', '问题', 3),
      /tenant context/i,
    );
  });

  it('prefers explicit identity over CLS when proxying retrieve requests', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ hits: [] });
    };

    const cls = fakeCls({
      tenantId: 'tenant-from-cls',
      userId: 'user-from-cls',
      roles: ['viewer'],
    });
    const service = new KnowledgeBaseService(undefined, cls as any);
    await service.retrieve('kb-collection', '问题', 3, {
      tenantId: 'tenant-from-header',
      userId: 'user-from-header',
      roles: ['operator'],
    });

    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('x-tenant-id'), 'tenant-from-header');
    assert.equal(headers.get('x-user-id'), 'user-from-header');
    assert.equal(headers.get('x-user-roles'), 'editor');
  });

  it('falls back to a service-account userId when the task has no owner (CALL-10 #2)', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    delete process.env.KNOWLEDGE_SERVICE_FALLBACK_USER_ID;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ hits: [] });
    };

    // 只有租户上下文、无 userId（ownerId=null 的历史/系统任务）
    const service = new KnowledgeBaseService(undefined, undefined);
    await service.retrieve('kb-collection', '问题', 3, { tenantId: 'tenant-a' });

    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('x-tenant-id'), 'tenant-a');
    assert.equal(headers.get('x-user-id'), 'system');
  });

  it('falls back to service-account userId when X-User-Id is an empty string (CALL-10 #2)', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    delete process.env.KNOWLEDGE_SERVICE_FALLBACK_USER_ID;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ hits: [] });
    };

    const service = new KnowledgeBaseService(undefined, undefined);
    // 显式传入空串 userId（模拟 X-User-Id: 空 header）
    await service.retrieve('kb-collection', '问题', 3, { tenantId: 'tenant-a', userId: '' });

    assert.equal(new Headers(calls[0].init?.headers).get('x-user-id'), 'system');
  });

  it('honors KNOWLEDGE_SERVICE_FALLBACK_USER_ID override for ownerless tasks', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    process.env.KNOWLEDGE_SERVICE_FALLBACK_USER_ID = 'svc-rag';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ hits: [] });
    };

    const service = new KnowledgeBaseService(undefined, undefined);
    await service.retrieve('kb-collection', '问题', 3, { tenantId: 'tenant-a' });

    assert.equal(new Headers(calls[0].init?.headers).get('x-user-id'), 'svc-rag');
  });

  it('refuses to start in external mode without SERVICE_API_TOKEN (inbound guard would fail open)', () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    delete process.env.SERVICE_API_TOKEN;

    const service = new KnowledgeBaseService();

    assert.throws(() => service.onModuleInit(), /SERVICE_API_TOKEN/);
  });

  it('starts in external mode when SERVICE_API_TOKEN is configured', () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    process.env.SERVICE_API_TOKEN = 'inbound-token';

    const service = new KnowledgeBaseService();

    assert.doesNotThrow(() => service.onModuleInit());
  });

  it('starts without any token when external mode is disabled (mock mode)', () => {
    delete process.env.KNOWLEDGE_SERVICE_BASE_URL;
    delete process.env.SERVICE_API_TOKEN;

    const service = new KnowledgeBaseService();

    assert.doesNotThrow(() => service.onModuleInit());
  });
});

function fakeCls(values: Record<string, unknown>) {
  return {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}
