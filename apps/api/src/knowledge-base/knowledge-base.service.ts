import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  KnowledgeDocument,
  KnowledgeRetrieveHit,
  KnowledgeTestRetrieveDto,
  KnowledgeTestRetrieveResult,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrismaJson } from '../common/prisma-json.js';

/**
 * 知识库 Service - RAG 检索增强生成。
 *
 * ai-call 保留原有 API 契约，真实知识库能力由独立 ai-knowledge 服务提供。
 * 配置 KNOWLEDGE_SERVICE_BASE_URL 后，本服务会代理到外部服务；未配置时保留
 * 内置 mock 数据，方便本地开发和测试不依赖知识库项目。
 */
@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly prisma?: PrismaService) {}

  private readonly externalBaseUrl = process.env.KNOWLEDGE_SERVICE_BASE_URL?.replace(/\/+$/, '');
  private readonly externalToken = process.env.KNOWLEDGE_SERVICE_API_TOKEN;
  private readonly timeoutMs = Number(process.env.KNOWLEDGE_SERVICE_TIMEOUT_MS ?? 5000);

  private knowledgeBases: Record<string, KnowledgeBaseDetail> = {
    'kb-collection': {
      id: 'kb-collection',
      name: '贷后催收知识库',
      docs: [
        {
          id: 'doc-1',
          content: '还款日提醒：客户应于还款日当天 23:59 前完成还款，逾期从次日开始计罚息，日罚息率为 0.05%。',
          source: '还款政策.pdf',
        },
        {
          id: 'doc-2',
          content: '延期还款申请：客户因失业/生病/意外等不可抗力原因可申请延期，需提供相关证明，最长延期 90 天，期间不计罚息。',
          source: '延期政策.pdf',
        },
        {
          id: 'doc-3',
          content: '减免罚息：连续还款 6 期以上的优质客户可申请减免累计罚息的 50%，由专员审核。',
          source: '减免政策.pdf',
        },
      ],
    },
    'kb-ecommerce': {
      id: 'kb-ecommerce',
      name: '电商售后知识库',
      docs: [
        {
          id: 'doc-1',
          content: '7 天无理由退货：自签收之日起 7 天内可申请无理由退货，商品需保持原包装未使用。生鲜、定制商品除外。',
          source: '退换货政策.pdf',
        },
        {
          id: 'doc-2',
          content: '退款时效：原路退回 1-3 个工作日到账，银行卡退款可能延长至 5-7 个工作日。',
          source: '退款规则.pdf',
        },
        {
          id: 'doc-3',
          content: '上门取件：免费提供上门取件服务，需提前 1 天预约，工作时间 9:00-18:00。',
          source: '取件服务.pdf',
        },
      ],
    },
    'kb-presale': {
      id: 'kb-presale',
      name: '售前邀约知识库',
      docs: [
        {
          id: 'doc-1',
          content: '试驾预约：需提前 1 天预约，需携带本人驾驶证，年龄需满 18 周岁。试驾时长约 30 分钟。',
          source: '试驾流程.pdf',
        },
        {
          id: 'doc-2',
          content: '夏日试驾季活动：2026-06-15 至 2026-07-31，到店试驾赠送礼品，当日订车送 5,000 元改装基金。',
          source: '活动详情.pdf',
        },
      ],
    },
  };

  /** 列出所有知识库 */
  async list() {
    if (this.externalBaseUrl) {
      const data = await this.requestExternal<KnowledgeBaseSummary[] | { items?: KnowledgeBaseSummary[]; knowledgeBases?: KnowledgeBaseSummary[] }>(
        '/knowledge-base',
      );
      if (Array.isArray(data)) return data;
      return data.items ?? data.knowledgeBases ?? [];
    }

    const builtin = Object.values(this.knowledgeBases).map(({ docs, ...rest }) => ({
      ...rest,
      docCount: docs.length,
      indexedCount: docs.length,
      failedCount: 0,
      staleCount: 0,
    }));
    if (!this.prisma) return builtin;

    const documents = await (this.prisma as any).knowledgeDocument.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    const byId = new Map<string, any>();
    for (const kb of builtin) byId.set(kb.id, { ...kb });
    for (const doc of documents) {
      const current = byId.get(doc.knowledgeBaseId) ?? {
        id: doc.knowledgeBaseId,
        name: doc.knowledgeBaseId,
        docCount: 0,
        indexedCount: 0,
        failedCount: 0,
        staleCount: 0,
      };
      current.docCount += 1;
      if (doc.indexStatus === 'indexed') current.indexedCount += 1;
      if (doc.indexStatus === 'failed') current.failedCount += 1;
      byId.set(doc.knowledgeBaseId, current);
    }
    return [...byId.values()];
  }

  /** 获取知识库详情 */
  async get(id: string) {
    if (this.externalBaseUrl) {
      return this.requestExternal<KnowledgeBaseDetail>(`/knowledge-base/${encodeURIComponent(id)}`);
    }

    const kb = this.knowledgeBases[id];
    const documents = await this.listStoredDocuments(id);
    if (!kb && documents.length === 0) throw new NotFoundException(`Knowledge base ${id} not found`);
    const docs = [
      ...(kb?.docs ?? []),
      ...documents.map((doc) => ({
        id: doc.id,
        content: doc.content,
        source: doc.filename,
      })),
    ];
    return {
      id,
      name: kb?.name ?? id,
      docs,
      documents: documents.map((doc) => this.toDocumentDomain(doc)),
    };
  }

  /**
   * 检索知识库 - Mock 实现
   *
   * 真实接入改为：
   *   const vectorStore = ... // 见文件顶部注释
   *   const results = await vectorStore.similaritySearchWithScore(query, 3);
   *   return results.map(([doc, score]) => ({ content: doc.pageContent, score, source: doc.metadata.source }));
   *
   * 注意：无匹配时返回空数组（而非 fallback 返回所有文档）。
   * RAG 反幻觉原则：宁可让 LLM 看到"无相关文档"也不要塞入无关上下文，
   * 由 LLM 通过 tool_call 升级到人工。
   */
  async retrieve(knowledgeBaseId: string, query: string, topK = 3) {
    if (this.externalBaseUrl) {
      const data = await this.requestExternal<KnowledgeDoc[] | { results?: KnowledgeDoc[] }>(
        `/knowledge-base/${encodeURIComponent(knowledgeBaseId)}/retrieve`,
        {
          method: 'POST',
          body: JSON.stringify({ query, topK }),
        },
      );
      return Array.isArray(data) ? data : data.results ?? [];
    }

    const kb = this.knowledgeBases[knowledgeBaseId];
    const storedDocuments = await this.listStoredDocuments(knowledgeBaseId);
    if (!kb && storedDocuments.length === 0) {
      throw new NotFoundException(`Knowledge base ${knowledgeBaseId} not found`);
    }
    const docs = [
      ...(kb?.docs ?? []),
      ...storedDocuments.map((doc) => ({
        id: doc.id,
        content: doc.content,
        source: doc.filename,
      })),
    ];

    // Mock 检索：按关键词简单匹配（真实实现用向量相似度 + BM25 + Rerank）
    const keywords = splitKeywords(query);
    const results = docs
      .map((doc) => {
        const score = scoreContent(doc.content, keywords);
        return { ...doc, score };
      })
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 无匹配返回空数组 - 不返回无关文档（反幻觉）
    return results;
  }

  /**
   * 上传文档到知识库 - 骨架
   *
   * 真实实现：
   *   1. 解析文档（PDF/Word/Markdown）
   *   2. 文本分块（RecursiveCharacterTextSplitter）
   *   3. 调用 Embedding API 生成向量
   *   4. 写入向量库
   */
  async upload(
    knowledgeBaseId: string,
    filename: string,
    content: Buffer,
  ): Promise<{ message?: string; document?: KnowledgeDocument; docCount?: number; error?: string }> {
    if (this.externalBaseUrl) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(content)]), filename);
      return this.requestExternal(
        `/knowledge-base/${encodeURIComponent(knowledgeBaseId)}/upload`,
        {
          method: 'POST',
          body: form,
        },
      ) as Promise<{ message?: string; document?: KnowledgeDocument; docCount?: number; error?: string }>;
    }

    const kb = this.knowledgeBases[knowledgeBaseId];
    const text = content.toString('utf8');
    const chunks = chunkText(text);
    if (this.prisma) {
      const latest = await (this.prisma as any).knowledgeDocument.findMany({
        where: { knowledgeBaseId },
        orderBy: { version: 'desc' },
        take: 1,
      });
      const document = await (this.prisma as any).knowledgeDocument.create({
        data: {
          knowledgeBaseId,
          filename,
          mimeType: guessMimeType(filename),
          content: text,
          chunkCount: chunks.length,
          indexStatus: 'indexed',
          version: Number(latest?.[0]?.version ?? 0) + 1,
          metadata: toPrismaJson({ chunkPreview: chunks.slice(0, 3) }),
          indexedAt: new Date(),
        },
      });
      const docCount = await this.countStoredDocuments(knowledgeBaseId);
      return {
        message: `文档 ${filename} 已索引`,
        document: this.toDocumentDomain(document),
        docCount,
      };
    }

    if (!kb) throw new NotFoundException(`Knowledge base ${knowledgeBaseId} not found`);
    return { message: `文档 ${filename} 已接收，向量化入库待实现`, docCount: kb.docs.length };
  }

  async testRetrieve(
    knowledgeBaseId: string,
    dto: KnowledgeTestRetrieveDto,
  ): Promise<KnowledgeTestRetrieveResult> {
    const results = (await this.retrieve(
      knowledgeBaseId,
      dto.query,
      dto.topK ?? 3,
    )).map((item) => ({
      id: item.id,
      documentId: item.id.startsWith('doc-') ? undefined : item.id,
      content: item.content,
      source: item.source,
      score: Number(item.score ?? 0),
    }));
    const topScore = results[0]?.score ?? 0;
    const lowConfidence = topScore < 0.35;
    const response: KnowledgeTestRetrieveResult = {
      query: dto.query,
      answer: buildAnswer(dto.query, results),
      results,
      lowConfidence,
      fallbackAction: lowConfidence ? 'handoff' : 'answer',
      generatedAt: new Date().toISOString(),
    };
    if ((this.prisma as any)?.knowledgeRetrievalLog?.create) {
      await (this.prisma as any).knowledgeRetrievalLog.create({
        data: {
          knowledgeBaseId,
          query: dto.query,
          results: toPrismaJson(results),
          topScore,
          lowConfidence,
          source: 'dashboard',
        },
      });
    }
    return response;
  }

  private async listStoredDocuments(knowledgeBaseId: string): Promise<any[]> {
    if (!this.prisma) return [];
    return (this.prisma as any).knowledgeDocument.findMany({
      where: { knowledgeBaseId },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async countStoredDocuments(knowledgeBaseId: string): Promise<number> {
    if (!this.prisma) return 0;
    const count = await (this.prisma as any).knowledgeDocument.count?.({
      where: { knowledgeBaseId },
    });
    if (typeof count === 'number') return count;
    return (await this.listStoredDocuments(knowledgeBaseId)).length;
  }

  private toDocumentDomain(record: any): KnowledgeDocument {
    return {
      id: record.id,
      knowledgeBaseId: record.knowledgeBaseId,
      filename: record.filename,
      mimeType: record.mimeType ?? undefined,
      chunkCount: record.chunkCount,
      indexStatus: record.indexStatus,
      indexError: record.indexError ?? undefined,
      version: record.version,
      indexedAt: record.indexedAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async requestExternal<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!this.externalBaseUrl) {
      throw new BadGatewayException('Knowledge service is not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (this.externalToken && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${this.externalToken}`);
    }

    try {
      const response = await fetch(`${this.externalBaseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw new NotFoundException(`Knowledge service resource not found: ${path}`);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new BadGatewayException(
          `Knowledge service request failed: HTTP ${response.status}${body ? ` ${body}` : ''}`,
        );
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Knowledge service request error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

interface KnowledgeDoc {
  id: string;
  content: string;
  source: string;
  score?: number;
}

interface KnowledgeBaseSummary {
  id: string;
  name: string;
  docCount?: number;
}

interface KnowledgeBaseDetail {
  id: string;
  name: string;
  docs: KnowledgeDoc[];
}

function splitKeywords(query: string): string[] {
  const segments = query
    .toLowerCase()
    .split(/[\s,，。！？!?;；:：]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length > 0) return segments;
  return [...new Set([...query].filter((char) => /[\p{L}\p{N}]/u.test(char)))];
}

function scoreContent(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = content.toLowerCase();
  const exactHits = keywords.filter((keyword) => lower.includes(keyword)).length;
  if (exactHits > 0) return exactHits / keywords.length;
  const chars = [...new Set(keywords.join(''))].filter((char) => /[\p{L}\p{N}]/u.test(char));
  if (chars.length === 0) return 0;
  const charHits = chars.filter((char) => lower.includes(char)).length;
  const score = Math.round((charHits / chars.length) * 100) / 100;
  const threshold = chars.length <= 2 ? 0.6 : 0.45;
  return score >= threshold ? score : 0;
}

function chunkText(content: string): string[] {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += 500) {
    chunks.push(normalized.slice(index, index + 500));
  }
  return chunks;
}

function buildAnswer(query: string, results: KnowledgeRetrieveHit[]): string {
  if (results.length === 0) {
    return `未在知识库中找到与“${query}”高度相关的资料，建议转人工确认。`;
  }
  const top = results[0];
  return `根据 ${top.source}：${top.content.slice(0, 180)}`;
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}
