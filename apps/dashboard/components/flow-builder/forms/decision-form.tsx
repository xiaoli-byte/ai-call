'use client';

import { useEffect, useState } from 'react';
import type {
  DecisionMode,
  DecisionNodeData,
  FlowNode,
} from '@ai-call/shared';
import { Field, Select, TextArea, TextInput } from './ui';
import styles from '../flow-builder.module.scss';

interface DecisionFormProps {
  node: FlowNode;
  onUpdate: (data: Partial<DecisionNodeData>) => void;
}

const MODE_OPTIONS: { value: DecisionMode; label: string }[] = [
  { value: 'intent', label: '意图识别' },
  { value: 'condition', label: '条件判断' },
];

export function DecisionForm({ node, onUpdate }: DecisionFormProps) {
  const data = node.data as DecisionNodeData;
  const [mode, setMode] = useState<DecisionMode>(data.mode);
  const [expression, setExpression] = useState(data.expression ?? '');
  const [intents, setIntents] = useState<string[]>(data.intents ?? []);

  useEffect(() => {
    setMode(data.mode);
    setExpression(data.expression ?? '');
    setIntents(data.intents ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function emit(patch: Partial<DecisionNodeData>) {
    onUpdate(patch);
  }

  return (
    <div className="space-y-4">
      <Field label="模式">
        <Select
          value={mode}
          onChange={(e) => {
            const newMode = e.target.value as DecisionMode;
            setMode(newMode);
            emit({ mode: newMode });
          }}
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {mode === 'condition' && (
        <Field
          label="条件表达式"
          hint="支持 response.includes() / response == / response.match() 等"
        >
          <TextArea
            value={expression}
            onChange={(e) => {
              setExpression(e.target.value);
              emit({ expression: e.target.value });
            }}
            placeholder="response.includes('满意')"
            rows={3}
            className={styles.flowMono}
          />
        </Field>
      )}

      {mode === 'intent' && (
        <Field label="意图列表" hint="每行一个意图，命中后将路由到该分支">
          <div>
            {intents.map((intent, i) => (
              <div key={i} className={styles.flowListItem}>
                <TextInput
                  value={intent}
                  onChange={(e) => {
                    const next = [...intents];
                    next[i] = e.target.value;
                    setIntents(next);
                    emit({ intents: next });
                  }}
                  placeholder={`意图 ${i + 1}，例如：同意 / 拒绝 / 咨询`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = intents.filter((_, idx) => idx !== i);
                    setIntents(next);
                    emit({ intents: next });
                  }}
                  className={styles.flowListRemove}
                  title="删除意图"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const next = [...intents, ''];
                setIntents(next);
                emit({ intents: next });
              }}
              className={styles.flowListAdd}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加意图
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}
