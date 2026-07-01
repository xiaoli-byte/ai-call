'use client';

import Link from 'next/link';
import { FlowBuilder } from '@/components/flow-builder/flow-builder';
import type { TaskFlow } from '@ai-call/shared';

export function FlowBuilderClient({ flow }: { flow: TaskFlow }) {
  return (
    <div className="flow-editor-shell">
      <div className="flow-editor-header">
        <div className="flow-editor-header-left">
          <Link href="/task-flows" className="flow-editor-back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            返回列表
          </Link>
          <div className="flow-editor-divider" />
          <div className="flow-editor-title">{flow.name}</div>
        </div>
        <div className="flow-editor-header-right">
          <span className="badge badge-neutral text-mono" style={{ fontSize: '11px' }}>
            v{flow.version ?? 1}
          </span>
          <span className={`badge ${flow.status === 'published' ? 'badge-success' : 'badge-neutral'}`}>
            {flow.status === 'published' ? '已发布' : '草稿'}
          </span>
        </div>
      </div>
      <div className="flow-editor-main">
        <FlowBuilder
          flowId={flow.id}
          flowName={flow.name}
          initialNodes={flow.nodes}
          initialEdges={flow.edges}
        />
      </div>
    </div>
  );
}