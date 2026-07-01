'use client';

import { useFlowStore } from './store/flow-store';
import { DialogForm } from './forms/dialog-form';
import { DecisionForm } from './forms/decision-form';
import { ActionForm } from './forms/action-form';
import { EndForm } from './forms/end-form';
import { NODE_META } from './types/flow';

export function PropertyPanel() {
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const updateNode = useFlowStore((s) => s.updateNode);
  const deleteNode = useFlowStore((s) => s.deleteNode);

  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <aside className="flow-property-panel">
        <div className="flow-property-panel-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            选择节点查看属性
          </div>
          <div>点击画布中的任意节点以编辑其配置</div>
        </div>
      </aside>
    );
  }

  const meta = NODE_META[node.type];
  const Icon = meta.icon;

  return (
    <aside className="flow-property-panel">
      <div className="flow-property-panel-header">
        <div className="flow-property-panel-header-left">
          <div className={`flow-property-panel-icon flow-node-icon-${meta.accent}`}>
            <Icon />
          </div>
          <div>
            <div className="flow-property-panel-title">{meta.title}节点</div>
            <div className="flow-property-panel-subtitle">
              {meta.description} · #{node.id.slice(0, 6)}
            </div>
          </div>
        </div>
        {node.type !== 'start' && (
          <button
            type="button"
            onClick={() => deleteNode(node.id)}
            className="flow-property-panel-delete"
            title="删除节点"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            删除
          </button>
        )}
      </div>

      <div className="flow-property-panel-body">
        {node.type === 'dialog' && (
          <DialogForm node={node} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'decision' && (
          <DecisionForm node={node} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'action' && (
          <ActionForm node={node} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'end' && (
          <EndForm node={node} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'start' && (
          <div className="flow-property-panel-empty" style={{ padding: '24px 0' }}>
            <div style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
              开始节点
            </div>
            <div>每个流程有且只有一个 Start 节点，无需额外配置</div>
          </div>
        )}
      </div>
    </aside>
  );
}