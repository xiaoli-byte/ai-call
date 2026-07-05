import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/**
 * 知识库 Service - RAG 检索增强生成。
 *
 * ai-call 保留原有 API 契约，真实知识库能力由独立 ai-knowledge 服务提供。
 * 配置 KNOWLEDGE_SERVICE_BASE_URL 后，本服务会代理到外部服务；未配置时保留
 * 内置 mock 数据，方便本地开发和测试不依赖知识库项目。
 */
@Injectable()
export class KnowledgeBaseService {
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

    return Object.values(this.knowledgeBases).map(({ docs, ...rest }) => ({
      ...rest,
      docCount: docs.length,
    }));
  }

  /** 获取知识库详情 */
  async get(id: string) {
    if (this.externalBaseUrl) {
      return this.requestExternal<KnowledgeBaseDetail>(`/knowledge-base/${encodeURIComponent(id)}`);
    }

    const kb = this.knowledgeBases[id];
    if (!kb) throw new NotFoundException(`Knowledge base ${id} not found`);
    return kb;
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
    if (!kb) throw new NotFoundException(`Knowledge base ${knowledgeBaseId} not found`);

    // Mock 检索：按关键词简单匹配（真实实现用向量相似度 + BM25 + Rerank）
    const keywords = query.split(/\s+/).filter(Boolean);
    const results = kb.docs
      .map((doc) => {
        const score = keywords.reduce(
          (s, kw) => s + (doc.content.includes(kw) ? 1 : 0),
          0,
        );
        return { ...doc, score: keywords.length > 0 ? score / keywords.length : 0 };
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
  async upload(knowledgeBaseId: string, filename: string, content: Buffer) {
    if (this.externalBaseUrl) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(content)]), filename);
      return this.requestExternal(
        `/knowledge-base/${encodeURIComponent(knowledgeBaseId)}/upload`,
        {
          method: 'POST',
          body: form,
        },
      );
    }

    const kb = this.knowledgeBases[knowledgeBaseId];
    if (!kb) throw new NotFoundException(`Knowledge base ${knowledgeBaseId} not found`);
    // TODO: 实现文档解析+分块+向量化+入库
    return { message: `文档 ${filename} 已接收，向量化入库待实现`, docCount: kb.docs.length };
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
