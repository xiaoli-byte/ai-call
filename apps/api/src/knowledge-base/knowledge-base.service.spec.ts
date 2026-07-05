import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { KnowledgeBaseService } from './knowledge-base.service.js';

const ENV_KEYS = [
  'KNOWLEDGE_SERVICE_BASE_URL',
  'KNOWLEDGE_SERVICE_API_TOKEN',
  'KNOWLEDGE_SERVICE_TIMEOUT_MS',
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
  it('uses built-in mock data when external knowledge service is not configured', async () => {
    delete process.env.KNOWLEDGE_SERVICE_BASE_URL;
    const service = new KnowledgeBaseService();

    const list = await service.list();
    const results = await service.retrieve('kb-collection', '延期', 3);

    assert.equal(list.some((kb) => kb.id === 'kb-collection'), true);
    assert.equal(results.length, 1);
    assert.equal(results[0].source, '延期政策.pdf');
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

    const service = new KnowledgeBaseService();
    const results = await service.retrieve('kb-collection', '怎么延期', 5);

    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'external.md');
    assert.equal(calls[0].url, 'http://127.0.0.1:3010/api/knowledge-base/kb-collection/retrieve');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(calls[0].init?.body, JSON.stringify({ query: '怎么延期', topK: 5 }));
    assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer service-token');
  });

  it('accepts array responses from external retrieve endpoints', async () => {
    process.env.KNOWLEDGE_SERVICE_BASE_URL = 'http://127.0.0.1:3010/api';
    globalThis.fetch = async () =>
      Response.json([
        {
          id: 'chunk-1',
          content: '数组格式响应',
          source: 'external.md',
          score: 0.8,
        },
      ]);

    const service = new KnowledgeBaseService();
    const results = await service.retrieve('kb-collection', '问题', 3);

    assert.equal(results.length, 1);
    assert.equal(results[0].content, '数组格式响应');
  });
});
