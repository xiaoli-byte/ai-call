'use client';

import { useEffect, useState } from 'react';
import { useFlowStore } from '../store/flow-store';
import { Field, TextInput } from './ui';
import styles from '../flow-builder.module.scss';
import type { FlowEdge, FlowNode } from '@ai-call/shared';

interface EdgeFormProps {
  edge: FlowEdge;
  sourceNode?: FlowNode;
  targetNode?: FlowNode;
}

/**
 * 连线表单：编辑分支条件（label）
 *
 * Decision 节点（mode: intent）的出口边 label 应为意图名称（如"转人工"/"结束"）。
 * 普通连线（非 Decision 出口）label 可留空。
 */
export function EdgeForm({ edge, sourceNode, targetNode }: EdgeFormProps) {
  const updateEdgeLabel = useFlowStore((s) => s.updateEdgeLabel);
  const deleteEdge = useFlowStore((s) => s.deleteEdge);

  const [label, setLabel] = useState(edge.label ?? '');

  useEffect(() => {
    setLabel(edge.label ?? '');
  }, [edge.id, edge.label]);

  const isFromDecision = sourceNode?.type === 'decision';
  const intents = isFromDecision && sourceNode
    ? ((sourceNode.data as { intents?: string[] }).intents ?? [])
    : [];

  return (
    <div>
      <Field
        label="分支条件（label）"
        hint="Decision 节点出口边需填写意图名称作为分支匹配条件"
      >
        <TextInput
          value={label}
          onChange={(e) => {
            const v = e.target.value;
            setLabel(v);
            updateEdgeLabel(edge.id, v);
          }}
          placeholder={isFromDecision ? '例如：转人工' : '可选，用于标注连线'}
        />
      </Field>

      {/* Decision intent 模式：提供快捷选择 */}
      {intents.length > 0 && (
        <div className={styles.flowField}>
          <label className={styles.flowFieldLabel}>从意图列表中选择</label>
          <div className={styles.flowIntentChips}>
            {intents.map((it) => (
              <button
                key={it}
                type="button"
                onClick={() => {
                  setLabel(it);
                  updateEdgeLabel(edge.id, it);
                }}
                className={`${styles.flowIntentChip} ${label === it ? styles.active : ''}`}
              >
                {it}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 源节点信息 */}
      {sourceNode && (
        <Field label="源节点">
          <div className={styles.flowEdgeInfo}>
            {sourceNode.type}
            {sourceNode.type === 'decision' && (
              <span> ({(sourceNode.data as { mode?: string }).mode})</span>
            )}
          </div>
        </Field>
      )}

      {/* 目标节点信息 */}
      {targetNode && (
        <Field label="目标节点">
          <div className={styles.flowEdgeInfo}>{targetNode.type}</div>
        </Field>
      )}

      <div className={styles.flowSectionDivider} />

      <button
        type="button"
        onClick={() => deleteEdge(edge.id)}
        className={styles.flowPropertyPanelDelete}
        style={{ marginTop: 12 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
        删除此连线
      </button>
    </div>
  );
}
