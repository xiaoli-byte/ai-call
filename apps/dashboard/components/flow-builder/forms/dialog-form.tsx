'use client';

import { useEffect, useState } from 'react';
import type { DialogMode, DialogNodeData, FlowNode } from '@ai-call/shared';
import { Checkbox, Field, SectionTitle, Select, TextArea, TextInput } from './ui';
import styles from '../flow-builder.module.scss';

interface DialogFormProps {
  node: FlowNode;
  onUpdate: (data: Partial<DialogNodeData>) => void;
}

const MODE_OPTIONS: { value: DialogMode; label: string }[] = [
  { value: 'script', label: '固定话术' },
  { value: 'question', label: '提问' },
  { value: 'ai', label: 'AI 回复' },
];

export function DialogForm({ node, onUpdate }: DialogFormProps) {
  const data = node.data as DialogNodeData;
  const [mode, setMode] = useState<DialogMode>(data.mode);
  const [text, setText] = useState(data.text ?? '');
  const [prompt, setPrompt] = useState(data.prompt ?? '');
  const [systemPrompt, setSystemPrompt] = useState(data.systemPrompt ?? '');
  const [temperature, setTemperature] = useState(data.temperature ?? 0.7);
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
    setMode(data.mode);
    setText(data.text ?? '');
    setPrompt(data.prompt ?? '');
    setSystemPrompt(data.systemPrompt ?? '');
    setTemperature(data.temperature ?? 0.7);
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
            const newMode = e.target.value as DialogMode;
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
          <TextArea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              emit({ text: e.target.value });
            }}
            placeholder="您好，这里是智能客服..."
          />
        </Field>
      )}

      {mode === 'question' && (
        <>
          <Field label="提问">
            <TextArea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                emit({ prompt: e.target.value });
              }}
              placeholder="请问您收到货了吗？"
            />
          </Field>
          <Field label="超时（秒）">
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
          <Field label="重试次数">
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
        </>
      )}

      {mode === 'ai' && (
        <>
          <Field label="系统提示词">
            <TextArea
              value={systemPrompt}
              onChange={(e) => {
                setSystemPrompt(e.target.value);
                emit({ systemPrompt: e.target.value });
              }}
              rows={4}
              placeholder="你是客服专员，专业且礼貌..."
            />
          </Field>
          <Field label="提示语">
            <TextArea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                emit({ prompt: e.target.value });
              }}
              placeholder="您好，这里是..."
            />
          </Field>
          <Field label="温度" hint="控制回复随机性，0 = 精准，2 = 发散">
            <TextInput
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={temperature}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTemperature(v);
                emit({ temperature: v });
              }}
            />
          </Field>
        </>
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
    </div>
  );
}