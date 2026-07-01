'use client';

import { useEffect, useState } from 'react';
import type { EndMode, EndNodeData, FlowNode } from '@ai-call/shared';
import { Field, Select, TextArea, TextInput } from './ui';

interface EndFormProps {
  node: FlowNode;
  onUpdate: (data: Partial<EndNodeData>) => void;
}

const MODE_OPTIONS: { value: EndMode; label: string }[] = [
  { value: 'complete', label: '正常结束' },
  { value: 'hangup', label: '挂机' },
];

export function EndForm({ node, onUpdate }: EndFormProps) {
  const data = node.data as EndNodeData;
  const [mode, setMode] = useState<EndMode>(data.mode);
  const [reason, setReason] = useState(data.reason ?? '');
  const [farewell, setFarewell] = useState(data.farewell ?? '');

  useEffect(() => {
    setMode(data.mode);
    setReason(data.reason ?? '');
    setFarewell(data.farewell ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  return (
    <div className="space-y-4">
      <Field label="结束方式">
        <Select
          value={mode}
          onChange={(e) => {
            const next = e.target.value as EndMode;
            setMode(next);
            onUpdate({ mode: next });
          }}
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="结束原因">
        <TextInput
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            onUpdate({ reason: e.target.value });
          }}
          placeholder="对话结束"
        />
      </Field>

      <Field label="告别话术（TTS 播报后挂机）">
        <TextArea
          value={farewell}
          onChange={(e) => {
            setFarewell(e.target.value);
            onUpdate({ farewell: e.target.value });
          }}
          placeholder="感谢您的来电，再见。"
          rows={3}
        />
      </Field>
    </div>
  );
}
