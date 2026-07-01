import { Injectable, NotFoundException } from '@nestjs/common';

/**
 * 知识库 Service - RAG 检索增强生成
 *
 * 当前为 Mock 实现，返回内置的 FAQ 文档片段。
 * 真实接入建议：
 *   - 向量库：Chroma（本地）或 Qdrant（生产）
 *   - Embedding 模型：OpenAI text-embedding-3-small 或 BGE-M3（中文）
 *   - 文档分块：递归字符分块，chunk_size=500，overlap=50
 *   - 检索策略：向量检索 + BM25 关键词混合 + Rerank
 *
 * 接入 LangChain.js 可参考：
 *   import { Chroma } from '@langchain/community/vectorstores/chroma';
 *   import { OpenAIEmbeddings } from '@langchain/openai';
 *   const vectorStore = await Chroma.fromDocuments(docs, new OpenAIEmbeddings());
 *   const results = await vectorStore.similaritySearchWithScore(query, 3);
 */
@Injectable()
export class KnowledgeBaseService {
  private knowledgeBases: Record<string, { id: string; name: string; docs: KnowledgeDoc[] }> = {
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
  list() {
    return Object.values(this.knowledgeBases).map(({ docs, ...rest }) => ({
      ...rest,
      docCount: docs.length,
    }));
  }

  /** 获取知识库详情 */
  get(id: string) {
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
  retrieve(knowledgeBaseId: string, query: string, topK = 3) {
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
  async upload(knowledgeBaseId: string, _filename: string, _content: Buffer) {
    const kb = this.knowledgeBases[knowledgeBaseId];
    if (!kb) throw new NotFoundException(`Knowledge base ${knowledgeBaseId} not found`);
    // TODO: 实现文档解析+分块+向量化+入库
    return { message: `文档 ${_filename} 已接收，向量化入库待实现`, docCount: kb.docs.length };
  }
}

interface KnowledgeDoc {
  id: string;
  content: string;
  source: string;
}
