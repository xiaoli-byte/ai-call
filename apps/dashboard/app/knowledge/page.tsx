import { apiServer } from '@/lib/api/server';

const KB_BADGE: Record<string, string> = {
  collection: 'badge-warning',
  ecommerce: 'badge-info',
  presale: 'badge-primary',
};

export default async function KnowledgePage() {
  let kbs: Awaited<ReturnType<typeof apiServer.listKnowledgeBases>> = [];
  let error: string | null = null;
  try {
    kbs = await apiServer.listKnowledgeBases();
  } catch (e) {
    error = e instanceof Error ? e.message : '加载失败';
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">知识库</h1>
          <p className="subtitle">RAG 检索增强生成 — 各场景的政策/规则文档</p>
        </div>
        <div className="page-actions">
          <button className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建知识库
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title" style={{ color: 'var(--danger)' }}>{error}</div>
            <div className="empty-desc">请先启动后端：<code>cd apps/api && pnpm dev</code></div>
          </div>
        </div>
      ) : (
        <div className="grid grid-3">
          {kbs.map((kb) => (
            <div key={kb.id} className="card card-interactive">
              <div className="card-header">
                <div>
                  <div className="card-title">{kb.name}</div>
                  <div className="card-subtitle text-mono" style={{ marginTop: 4 }}>{kb.id}</div>
                </div>
                <span className="badge badge-neutral">
                  通用
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                    {kb.docCount}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>文档数量</div>
                </div>
                <div className="stat-icon" style={{ width: 40, height: 40 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
              </div>

              <button className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                上传文档
              </button>

              <div className="divider" style={{ margin: '14px 0' }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <div style={{ marginBottom: 4, color: 'var(--text-secondary)', fontWeight: 500 }}>技术栈：</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span className="badge badge-neutral">Chroma</span>
                  <span className="badge badge-neutral">LangChain.js</span>
                  <span className="badge badge-neutral">BGE-M3</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">RAG 防幻觉机制</div>
            <div className="card-subtitle">通过检索增强生成，确保 AI 回复基于真实业务知识</div>
          </div>
          <span className="badge badge-primary">核心能力</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: '13.5px' }}>
          Voice Agent 在每轮对话中调用知识库检索，将相关文档片段注入 LLM 上下文，
          并通过 System Prompt 强制 LLM 基于检索结果回答，避免编造信息：
        </p>
        <ul style={{ paddingLeft: 0, listStyle: 'none', color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.9, fontSize: '13px' }}>
          <li>• 涉及金额/日期/政策等具体信息时，必须基于【知识库参考资料】回答</li>
          <li>• 若参考资料未覆盖客户问题，统一回复"这部分我需要帮您确认后回复"</li>
          <li>• 不得编造未在参考资料中出现的信息</li>
          <li>• 查不到的信息触发转人工兜底</li>
        </ul>
      </div>
    </div>
  );
}