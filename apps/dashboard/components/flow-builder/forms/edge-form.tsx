'use client';

import { useEffect, useState } from 'react';
import type { FlowEdge, FlowNode } from '@ai-call/shared';
import { useFlowStore } from '../store/flow-store';
import { NODE_META } from '../types/flow';
import { Field, TextInput } from './ui';
import styles from '../flow-builder.module.scss';

interface EdgeFormProps {
  edge: FlowEdge;
  sourceNode?: FlowNode;
  targetNode?: FlowNode;
}

const MAX_EXAMPLES = 50;

/** 每条连线都可独立配置意图；名称留空时，该连线作为默认分支。 */
export function EdgeForm({ edge, sourceNode, targetNode }: EdgeFormProps) {
  const updateEdgeIntent = useFlowStore((s) => s.updateEdgeIntent);
  const deleteEdge = useFlowStore((s) => s.deleteEdge);
  const [label, setLabel] = useState(edge.label ?? '');
  const [examples, setExamples] = useState<string[]>(edge.intentExamples ?? []);

  useEffect(() => {
    setLabel(edge.label ?? '');
    setExamples(edge.intentExamples ?? []);
  }, [edge.id, edge.label, edge.intentExamples]);

  function persistExamples(next: string[]) {
    setExamples(next);
    updateEdgeIntent(edge.id, {
      intentExamples: next.map((item) => item.trim()).filter(Boolean),
    });
  }

  const isDefault = label.trim().length === 0;

  return (
    <div>
      <div className={styles.flowIntentNotice}>
        <div className={styles.flowIntentNoticeIcon}>↗</div>
        <div>
          <strong>{isDefault ? '默认分支' : '意图分支'}</strong>
          <span>
            {isDefault
              ? '当前连线承接未命中其他意图的情况。'
              : '系统会根据用户最近一次回复判断是否进入这条连线。'}
          </span>
        </div>
      </div>

      <Field
        label="分支名称"
        hint="用动宾短语描述用户意图，例如“用户要求转人工”；留空则设为默认分支。"
      >
        <TextInput
          value={label}
          maxLength={100}
          onChange={(event) => {
            const next = event.target.value;
            setLabel(next);
            updateEdgeIntent(edge.id, { label: next });
          }}
          placeholder="默认分支"
        />
        <div className={styles.flowFieldCounter}>{label.length} / 100</div>
      </Field>

      {!isDefault && (
        <Field
          label="用户问法"
          hint={`添加 3–5 条匹配该分支的典型表达（选填，最多 ${MAX_EXAMPLES} 条）。`}
        >
          <div className={styles.flowExampleList}>
            {examples.map((example, index) => (
              <div key={`${edge.id}-example-${index}`} className={styles.flowListItem}>
                <TextInput
                  value={example}
                  onChange={(event) => {
                    const next = [...examples];
                    next[index] = event.target.value;
                    persistExamples(next);
                  }}
                  placeholder={`问法 ${index + 1}，例如：帮我转接人工客服`}
                />
                <button
                  type="button"
                  onClick={() => persistExamples(examples.filter((_, i) => i !== index))}
                  className={styles.flowListRemove}
                  title="删除问法"
                  aria-label={`删除问法 ${index + 1}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
            ))}
            {examples.length < MAX_EXAMPLES && (
              <button
                type="button"
                onClick={() => setExamples([...examples, ''])}
                className={styles.flowListAdd}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                增加问法
              </button>
            )}
          </div>
        </Field>
      )}

      <div className={styles.flowEdgeRoute}>
        <span>{sourceNode ? NODE_META[sourceNode.type].title : '未知节点'}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M5 12h14m-5-5 5 5-5 5" />
        </svg>
        <span>{targetNode ? NODE_META[targetNode.type].title : '未知节点'}</span>
      </div>

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
