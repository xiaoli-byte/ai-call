"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { appToast } from '@/lib/toast';
import { PERMISSIONS } from '@ai-call/shared';
import { usePermission } from '@/hooks/use-permission';

import styles from '../platform.module.scss';

export function CloneTemplateButton({ templateId }: { templateId: string }) {
  const router = useRouter();
  const canClone = usePermission(PERMISSIONS.PLATFORM_CREATE);
  const [loading, setLoading] = useState(false);

  const clone = async () => {
    setLoading(true);
    try {
      const result = await apiClient.platform.cloneTemplate(templateId, { publish: true });
      appToast.success('模板已克隆');
      router.push(`/task-flows/${result.flowId}`);
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (!canClone) return null;

  return (
    <button type="button" className={styles.primaryButton} onClick={clone} disabled={loading}>
      <CopyPlus size={15} />
      {loading ? '克隆中' : '克隆'}
    </button>
  );
}
