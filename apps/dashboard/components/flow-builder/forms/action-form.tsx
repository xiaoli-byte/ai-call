'use client';

import { useEffect, useState } from 'react';
import type {
  ActionConfig,
  ActionType,
  ActionNodeData,
  FlowNode,
} from '@ai-call/shared';
import { useGlobalConfig } from '@/hooks/use-global-config';
import { Field, Select, TextArea, TextInput } from './ui';
import styles from '../flow-builder.module.scss';

interface ActionFormProps {
  node: FlowNode;
  onUpdate: (data: Partial<ActionNodeData>) => void;
}

const ACTION_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'transfer', label: '转人工' },
  { value: 'sms', label: '发短信' },
  { value: 'crm', label: 'CRM 操作' },
  { value: 'api', label: 'API 调用' },
];

export function ActionForm({ node, onUpdate }: ActionFormProps) {
  const { data: globalConfig } = useGlobalConfig();
  const data = node.data as ActionNodeData;
  const [actionType, setActionType] = useState<ActionType>(data.actionType);
  const [config, setConfig] = useState<Record<string, unknown>>(
    (data.config ?? {}) as Record<string, unknown>,
  );
  const apiPlugins = (globalConfig?.apiPlugins ?? []).filter((plugin) => plugin.enabled);

  useEffect(() => {
    setActionType(data.actionType);
    setConfig((data.config ?? {}) as Record<string, unknown>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function setField(key: string, value: unknown) {
    const next = { ...config, [key]: value };
    setConfig(next);
    onUpdate({ config: next as unknown as ActionConfig });
  }

  function applyApiPlugin(pluginId: string) {
    const plugin = apiPlugins.find((item) => (item.id ?? item.name) === pluginId);
    if (!plugin) {
      const next = { ...config, pluginId: '', pluginName: '' };
      setConfig(next);
      onUpdate({ config: next as unknown as ActionConfig });
      return;
    }
    const next = {
      ...config,
      pluginId: plugin.id ?? plugin.name,
      pluginName: plugin.name,
      url: plugin.url ?? '',
      method: plugin.method ?? 'POST',
      headers: plugin.headers,
      body: plugin.bodyTemplate ?? config.body ?? {},
      timeout: plugin.timeoutSeconds ?? 10,
    };
    setConfig(next);
    onUpdate({ config: next as unknown as ActionConfig });
  }

  return (
    <div className="space-y-4">
      <Field label="动作类型">
        <Select
          value={actionType}
          onChange={(e) => {
            const next = e.target.value as ActionType;
            setActionType(next);
            setConfig({});
            onUpdate({ actionType: next, config: {} as ActionConfig });
          }}
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {actionType === 'transfer' && (
        <>
          <Field label="目标分机号">
            <TextInput
              value={String(config.extension ?? '')}
              onChange={(e) => setField('extension', e.target.value)}
              placeholder="9000"
            />
          </Field>
          <Field label="转接原因">
            <TextInput
              value={String(config.reason ?? '')}
              onChange={(e) => setField('reason', e.target.value)}
              placeholder="客户要求人工服务"
            />
          </Field>
        </>
      )}

      {actionType === 'sms' && (
        <>
          <Field label="短信模板 ID">
            <TextInput
              value={String(config.template ?? '')}
              onChange={(e) => setField('template', e.target.value)}
              placeholder="presale_followup"
            />
          </Field>
          <Field label="模板参数（JSON）">
            <TextArea
              value={JSON.stringify(config.params ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  setField('params', JSON.parse(e.target.value));
                } catch {
                  // 编辑中 JSON 不合法时忽略
                }
              }}
              rows={4}
              placeholder='{"product": "Model Y"}'
              className={styles.flowMono}
            />
          </Field>
        </>
      )}

      {actionType === 'crm' && (
        <>
          <Field label="CRM 动作">
            <TextInput
              value={String(config.action ?? '')}
              onChange={(e) => setField('action', e.target.value)}
              placeholder="create_after_sale_ticket"
            />
          </Field>
          <Field label="优先级">
            <Select
              value={String(config.priority ?? 'normal')}
              onChange={(e) => setField('priority', e.target.value)}
            >
              <option value="low">低</option>
              <option value="normal">普通</option>
              <option value="high">高</option>
            </Select>
          </Field>
          <Field label="备注">
            <TextArea
              value={String(config.note ?? '')}
              onChange={(e) => setField('note', e.target.value)}
              rows={2}
            />
          </Field>
        </>
      )}

      {actionType === 'api' && (
        <>
          {apiPlugins.length > 0 && (
            <Field label="API 插件">
              <Select
                value={String(config.pluginId ?? '')}
                onChange={(e) => applyApiPlugin(e.target.value)}
              >
                <option value="">手动填写</option>
                {apiPlugins.map((plugin) => (
                  <option key={plugin.id ?? plugin.name} value={plugin.id ?? plugin.name}>
                    {plugin.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="请求 URL">
            <TextInput
              value={String(config.url ?? '')}
              onChange={(e) => setField('url', e.target.value)}
              placeholder="https://api.example.com/webhook"
            />
          </Field>
          <Field label="请求方法">
            <Select
              value={String(config.method ?? 'POST')}
              onChange={(e) => setField('method', e.target.value)}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </Select>
          </Field>
          <Field label="请求体（JSON）">
            <TextArea
              value={JSON.stringify(config.body ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  setField('body', JSON.parse(e.target.value));
                } catch {
                  // 忽略非法 JSON
                }
              }}
              rows={4}
              placeholder='{"key": "value"}'
              className={styles.flowMono}
            />
          </Field>
        </>
      )}
    </div>
  );
}
