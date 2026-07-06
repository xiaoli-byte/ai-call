'use client';

import { useState } from 'react';
import { CheckCircle2, PhoneForwarded, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { appToast } from '@/lib/toast';
import type { HandoffTicketStatus } from '@ai-call/shared';

import styles from '../tasks/tasks.module.scss';

export function HandoffActions({ id, status }: { id: string; status: HandoffTicketStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function update(nextStatus: HandoffTicketStatus, disposition?: string) {
    setPending(nextStatus);
    try {
      await apiClient.handoffs.update(id, {
        status: nextStatus,
        disposition: disposition as any,
      });
      appToast.success('工单已更新');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setPending(null);
    }
  }

  async function callback() {
    setPending('callback');
    try {
      await apiClient.handoffs.createCallbackTask(id, {
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      appToast.success('回拨任务已创建');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setPending(null);
    }
  }

  if (status === 'completed' || status === 'closed') return null;

  return (
    <div className={styles.tools}>
      {status === 'pending' ? (
        <button type="button" className={styles.toolButton} onClick={() => update('processing')} disabled={pending !== null}>
          认领
        </button>
      ) : null}
      <button type="button" className={styles.toolButton} onClick={callback} disabled={pending !== null}>
        <PhoneForwarded size={14} />
        回拨
      </button>
      <button type="button" className={styles.toolButton} onClick={() => update('completed', 'contacted')} disabled={pending !== null}>
        <CheckCircle2 size={14} />
        完成
      </button>
      <button type="button" className={styles.toolButton} onClick={() => update('closed', 'closed')} disabled={pending !== null}>
        <XCircle size={14} />
        关闭
      </button>
    </div>
  );
}
