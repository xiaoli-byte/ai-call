'use client';

import { useEffect, useState } from 'react';
import type {
  DecisionMode,
  DecisionNodeData,
  FlowNode,
} from '@ai-call/shared';
import { Field, Select, TextArea, TextInput } from './ui';
import { migrateMapKeyOnRename, parseExampleLines, removeMapKey } from './intent-examples';
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
  const [intentExamples, setIntentExamples] = useState<Record<string, string[]>>(
    data.intentExamples ?? {},
  );
  // 例句文本框的原始输入（未过滤空行），键=意图名，避免用户换行时被立即吞掉
  const [exampleDrafts, setExampleDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setMode(data.mode);
    setExpression(data.expression ?? '');
    setIntents(data.intents ?? []);
    setIntentExamples(data.intentExamples ?? {});
    setExampleDrafts({});
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
            {intents.map((intent, i) => {
              const draft = exampleDrafts[intent] ?? (intentExamples[intent] ?? []).join('\n');
              const exampleCount = intentExamples[intent]?.length ?? 0;
              return (
                <div key={i} className={styles.flowIntentGroup}>
                  <div className={styles.flowListItem}>
                    <TextInput
                      value={intent}
                      onChange={(e) => {
                        const newName = e.target.value;
                        const oldName = intents[i];
                        const next = [...intents];
                        next[i] = newName;
                        setIntents(next);
                        const nextExamples = migrateMapKeyOnRename(intentExamples, oldName, newName);
                        setIntentExamples(nextExamples);
                        setExampleDrafts((prev) => migrateMapKeyOnRename(prev, oldName, newName));
                        emit({ intents: next, intentExamples: nextExamples });
                      }}
                      placeholder={`意图 ${i + 1}，例如：同意 / 拒绝 / 咨询`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const removedName = intents[i];
                        const next = intents.filter((_, idx) => idx !== i);
                        setIntents(next);
                        const nextExamples = removeMapKey(intentExamples, removedName);
                        setIntentExamples(nextExamples);
                        setExampleDrafts((prev) => removeMapKey(prev, removedName));
                        emit({ intents: next, intentExamples: nextExamples });
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
                  <details className={styles.flowExampleDetails}>
                    <summary className={styles.flowExampleSummary}>
                      例句{exampleCount > 0 ? `（${exampleCount}）` : ''}
                    </summary>
                    <TextArea
                      value={draft}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setExampleDrafts((prev) => ({ ...prev, [intent]: raw }));
                        const lines = parseExampleLines(raw);
                        const nextExamples = { ...intentExamples };
                        if (lines.length > 0) {
                          nextExamples[intent] = lines;
                        } else {
                          delete nextExamples[intent];
                        }
                        setIntentExamples(nextExamples);
                        emit({ intentExamples: nextExamples });
                      }}
                      placeholder="每行一句用户可能的表达，供 embedding 相似度层匹配，例如：好的就这样定了"
                      rows={3}
                      className={styles.flowExampleTextarea}
                    />
                  </details>
                </div>
              );
            })}
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
