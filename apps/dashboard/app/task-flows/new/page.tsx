'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTaskFlowMutations } from '@/hooks/use-task-flows';
import { appToast } from '@/lib/toast';
import { TASK_FLOW_TEMPLATES } from '@ai-call/shared';
import type { FlowNodeType, TaskFlowTemplate } from '@ai-call/shared';

const NODE_COLORS: Record<string, string> = {
  start: '#2563eb',
  dialog: '#10b981',
  decision: '#f59e0b',
  action: '#8b5cf6',
  end: '#ef4444',
};

function TemplatePreview({ template }: { template: TaskFlowTemplate }) {
  const nodes = template.nodes;
  if (nodes.length === 0) {
    return (
      <div className="template-preview-empty">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
        <span>空白画布</span>
      </div>
    );
  }

  return (
    <div className="template-preview">
      {nodes.map((n, i) => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'center' }}>
          <div
            className="template-preview-node"
            style={{ background: NODE_COLORS[n.type as FlowNodeType] }}
            title={n.type}
          />
          {i < nodes.length - 1 && <div className="template-preview-line" />}
        </div>
      ))}
    </div>
  );
}

export default function NewTaskFlowPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const { create } = useTaskFlowMutations();

  async function createFromTemplate(tpl: TaskFlowTemplate) {
    setSubmitting(tpl.id);
    try {
      const created = await create({
        name: tpl.name,
        description: tpl.description,
        nodes: tpl.nodes,
        edges: tpl.edges,
      });
      appToast.success('流程创建成功');
      router.push(`/task-flows/${created.id}`);
    } catch (err) {
      appToast.error(err);
      setSubmitting(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">新建外呼流程</h1>
          <p className="subtitle">选择模板快速创建，所有流程均含 Start 节点</p>
        </div>
        <div className="page-actions">
          <Link href="/task-flows" className="btn btn-secondary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            返回列表
          </Link>
        </div>
      </div>

      <div className="grid grid-2" style={{ maxWidth: 920 }}>
        {TASK_FLOW_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => createFromTemplate(tpl)}
            disabled={submitting !== null}
            className="template-card"
            style={{
              opacity: submitting && submitting !== tpl.id ? 0.5 : 1,
            }}
          >
            <div className="template-card-header">
              <div className="template-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="6" height="6" rx="1" />
                  <rect x="15" y="15" width="6" height="6" rx="1" />
                  <rect x="9" y="9" width="6" height="6" rx="1" />
                  <path d="M6 9v3a3 3 0 0 0 3 3" />
                  <path d="M15 12h-3a3 3 0 0 0-3 3" />
                </svg>
              </div>
              <div>
                <div className="template-card-title">{tpl.name}</div>
                <div className="template-card-subtitle">
                  {tpl.id === 'blank' ? '空白画布' : '预设模板'}
                </div>
              </div>
            </div>

            <TemplatePreview template={tpl} />

            <p className="template-card-desc">{tpl.description}</p>

            <div className="template-card-footer">
              <div className="tag-list">
                <span className="badge badge-info">{tpl.nodes.length} 节点</span>
                <span className="badge badge-neutral">{tpl.edges.length} 连线</span>
              </div>
              <span className={`template-card-cta ${submitting === tpl.id ? 'loading' : ''}`}>
                {submitting === tpl.id ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    创建中
                  </>
                ) : (
                  <>
                    使用此模板
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </>
                )}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
