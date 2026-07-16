'use client';

import { useEffect, useState } from 'react';
import type { DialogMode, DialogNodeData, FlowNode } from '@ai-call/shared';
import { useGlobalConfig } from '@/hooks/use-global-config';
import { Checkbox, Field, SectionTitle, Select, TextInput } from './ui';
import { VariableTextArea } from './variable-textarea';
import styles from '../flow-builder.module.scss';

interface DialogFormProps {
  node: FlowNode;
  onUpdate: (data: Partial<DialogNodeData>) => void;
}

type EditableDialogMode = Extract<DialogMode, 'script' | 'ai'>;

const MODE_OPTIONS: { value: EditableDialogMode; label: string }[] = [
  { value: 'script', label: '固定话术' },
  { value: 'ai', label: 'AI 生成回复' },
];

function editableMode(data: DialogNodeData): EditableDialogMode {
  return data.mode === 'ai' ? 'ai' : 'script';
}

export function DialogForm({ node, onUpdate }: DialogFormProps) {
  const { data: globalConfig } = useGlobalConfig();
  const data = node.data as DialogNodeData;
  const variables = globalConfig?.globalVariables ?? [];
  const [mode, setMode] = useState<EditableDialogMode>(editableMode(data));
  const [text, setText] = useState(
    data.text ?? (data.mode === 'question' ? data.prompt ?? '' : ''),
  );
  const [prompt, setPrompt] = useState(data.prompt ?? '');
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    data.timeoutSeconds ?? 10,
  );
  const [retryCount, setRetryCount] = useState(data.retryCount ?? 2);
  const [interruptible, setInterruptible] = useState(data.interruptible);
  const [waitForResponse, setWaitForResponse] = useState(
    data.waitForResponse,
  );

  // 节点切换时重置
  useEffect(() => {
    setMode(editableMode(data));
    setText(data.text ?? (data.mode === 'question' ? data.prompt ?? '' : ''));
    setPrompt(data.prompt ?? '');
    setTimeoutSeconds(data.timeoutSeconds ?? 10);
    setRetryCount(data.retryCount ?? 2);
    setInterruptible(data.interruptible);
    setWaitForResponse(data.waitForResponse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function emit(patch: Partial<DialogNodeData>) {
    onUpdate(patch);
  }

  return (
    <div className="space-y-4">
      <Field label="模式">
        <Select
          value={mode}
          onChange={(e) => {
            const newMode = e.target.value as EditableDialogMode;
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

      {mode === 'script' && (
        <Field label="话术文本">
          <VariableTextArea
            value={text}
            variables={variables}
            onValueChange={(value) => {
              setText(value);
              emit({ text: value });
            }}
            placeholder="您好，这里是智能客服..."
          />
        </Field>
      )}

      {mode === 'ai' && (
        // 节点配置精简：AI 对话节点只保留「回复目标」一个配置项；
        // 「系统提示词」（systemPrompt）字段本身在数据结构中保留透传，
        // 存量流程已配置的 systemPrompt 值不会丢失，voice-agent 运行时仍会读取它，
        // 只是不再提供 UI 输入入口。
        <Field label="回复目标" hint="描述这一节点要如何结合上下文生成回复">
          <VariableTextArea
            value={prompt}
            variables={variables}
            onValueChange={(value) => {
              setPrompt(value);
              emit({ prompt: value });
            }}
            placeholder="例如：确认客户是否收到商品，并自然询问使用体验"
          />
        </Field>
      )}

      <div className={styles.flowSectionDivider} />

      <SectionTitle>行为设置</SectionTitle>

      <Checkbox
        label="可被打断"
        checked={interruptible}
        onChange={(v) => {
          setInterruptible(v);
          emit({ interruptible: v });
        }}
      />
      <div style={{ height: 6 }} />
      <Checkbox
        label="等待响应"
        checked={waitForResponse}
        onChange={(v) => {
          setWaitForResponse(v);
          emit({ waitForResponse: v });
        }}
      />

      {waitForResponse && (
        <div className={styles.flowResponseSettings}>
          <Field label="等待超时（秒）">
            <TextInput
              type="number"
              min={1}
              max={120}
              value={timeoutSeconds}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTimeoutSeconds(v);
                emit({ timeoutSeconds: v });
              }}
            />
          </Field>
          <Field label="无响应重试次数">
            <TextInput
              type="number"
              min={0}
              max={5}
              value={retryCount}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRetryCount(v);
                emit({ retryCount: v });
              }}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
