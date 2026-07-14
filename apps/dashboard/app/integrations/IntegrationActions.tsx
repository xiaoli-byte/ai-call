'use client';

import { useState } from 'react';
import { PlugZap, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { appToast } from '@/lib/toast';
import { PERMISSIONS } from '@ai-call/shared';
import { usePermission } from '@/hooks/use-permission';

import styles from '../tasks/tasks.module.scss';

export function IntegrationActions({ defaultConnectorId }: { defaultConnectorId?: string }) {
  const router = useRouter();
  const canManage = usePermission(PERMISSIONS.TASK_UPDATE);
  const [name, setName] = useState('CRM Webhook');
  const [endpoint, setEndpoint] = useState('mock://crm/leads');
  const [connectorId, setConnectorId] = useState(defaultConnectorId ?? '');
  const [pending, setPending] = useState<'create' | 'test' | null>(null);

  async function createConnector() {
    setPending('create');
    try {
      const connector = await apiClient.integrations.create({
        name,
        type: 'crm',
        endpoint,
        authType: 'none',
        requestTemplate: {
          phone: '{{phone}}',
          customerName: '{{customerName}}',
          intent: '{{intent}}',
        },
        responseMapping: { externalId: '$.id' },
        enabled: true,
      });
      setConnectorId(connector.id);
      appToast.success('连接器已创建');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setPending(null);
    }
  }

  async function testConnector() {
    if (!connectorId) {
      appToast.error('请先选择或创建连接器');
      return;
    }
    setPending('test');
    try {
      const result = await apiClient.integrations.test(connectorId, {
        sampleVariables: {
          phone: '+8613800138000',
          customerName: '王先生',
          intent: '试驾邀约',
        },
      });
      appToast.success(`测试${result.status === 'success' ? '成功' : '失败'}，耗时 ${result.durationMs}ms`);
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.tableShell} style={{ padding: 16 }}>
      <div className={styles.toolbar} style={{ minHeight: 0, alignItems: 'flex-start' }}>
        <div className={styles.tools} style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
          <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} />
          <input className="form-input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
          <input
            className="form-input"
            value={connectorId}
            onChange={(event) => setConnectorId(event.target.value)}
            placeholder="连接器 ID"
          />
        </div>
        <div className={styles.tools}>
          {canManage && (
            <button type="button" className={styles.toolButton} onClick={createConnector} disabled={pending !== null}>
              <PlugZap size={14} />
              {pending === 'create' ? '创建中...' : '创建连接器'}
            </button>
          )}
          {canManage && (
            <button type="button" className={styles.primaryButton} onClick={testConnector} disabled={pending !== null}>
              <Send size={14} />
              {pending === 'test' ? '测试中...' : '测试调用'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
