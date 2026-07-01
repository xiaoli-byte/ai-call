'use client';

import { useFlowStore } from './store/flow-store';
import { DialogForm } from './forms/dialog-form';
import { DecisionForm } from './forms/decision-form';
import { ActionForm } from './forms/action-form';
import { EndForm } from './forms/end-form';
import { EdgeForm } from './forms/edge-form';
import { NODE_META } from './types/flow';
import type { FlowNode } from '@ai-call/shared';
import styles from './flow-builder.module.scss';

export function PropertyPanel() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const updateNode = useFlowStore((s) => s.updateNode);
  const deleteNode = useFlowStore((s) => s.deleteNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  const edge = edges.find((e) => e.id === selectedEdgeId);

  // 优先：边选中 → 显示 Edge 表单（分支条件）
  if (edge) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    return (
      <aside className={styles.flowPropertyPanel}>
        <div className={styles.flowPropertyPanelHeader}>
          <div className={styles.flowPropertyPanelHeaderLeft}>
            <div className={`${styles.flowPropertyPanelIcon} flow-node-icon-primary`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <div className={styles.flowPropertyPanelTitle}>连线配置</div>
              <div className={styles.flowPropertyPanelSubtitle}>
                {sourceNode ? NODE_META[sourceNode.type].title : '?'} →{' '}
                {targetNode ? NODE_META[targetNode.type].title : '?'}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.flowPropertyPanelBody}>
          <EdgeForm edge={edge} sourceNode={sourceNode} targetNode={targetNode} />
        </div>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className={styles.flowPropertyPanel}>
        <div className={styles.flowPropertyPanelBody}>
          <div className={styles.flowPropertyPanelEmpty}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 9h6v6H9z" />
            </svg>
            <div>选择节点查看属性</div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              点击节点编辑配置，点击连线编辑分支条件
            </div>
          </div>
        </div>
      </aside>
    );
  }

  const meta = NODE_META[node.type];
  const Icon = meta.icon;

  return (
    <aside className={styles.flowPropertyPanel}>
      <div className={styles.flowPropertyPanelHeader}>
        <div className={styles.flowPropertyPanelHeaderLeft}>
          <div className={`${styles.flowPropertyPanelIcon} flow-node-icon-${meta.accent}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className={styles.flowPropertyPanelTitle}>{meta.title}节点</div>
            <div className={styles.flowPropertyPanelSubtitle}>#{node.id.slice(0, 8)}</div>
          </div>
        </div>
        {node.type !== 'start' && (
          <button
            type="button"
            onClick={() => deleteNode(node.id)}
            className={styles.flowPropertyPanelDelete}
            title="删除节点"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
            删除
          </button>
        )}
      </div>

      <div className={styles.flowPropertyPanelBody}>
        {node.type === 'dialog' && (
          <DialogForm node={node as unknown as FlowNode} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'decision' && (
          <DecisionForm node={node as unknown as FlowNode} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'action' && (
          <ActionForm node={node as unknown as FlowNode} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'end' && (
          <EndForm node={node as unknown as FlowNode} onUpdate={(d) => updateNode(node.id, d)} />
        )}
        {node.type === 'start' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
              开始节点
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              每个流程有且只有一个 Start 节点，无需额外配置
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
