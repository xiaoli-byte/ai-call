'use client';

import { useRouter } from 'next/navigation';
import { PauseCircle } from 'lucide-react';
import { useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { appToast } from '@/lib/toast';
import type { CampaignStatus } from '@ai-call/shared';

import styles from '../../tasks/tasks.module.scss';

interface CampaignStatusActionsProps {
  campaignId: string;
  status: CampaignStatus;
}

export function CampaignStatusActions({ campaignId, status }: CampaignStatusActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const canPause = status === 'scheduled' || status === 'running';

  async function pauseCampaign() {
    setPending(true);
    try {
      await apiClient.campaigns.updateStatus(campaignId, { status: 'paused' });
      appToast.success('活动已暂停');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setPending(false);
    }
  }

  if (!canPause) return null;

  return (
    <button
      type="button"
      className={styles.toolButton}
      disabled={pending}
      onClick={pauseCampaign}
    >
      <PauseCircle size={14} />
      {pending ? '暂停中...' : '暂停活动'}
    </button>
  );
}
