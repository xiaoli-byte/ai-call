'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePolling } from '@/hooks/use-polling';

const TASK_LIST_POLL_INTERVAL_MS = 3_000;

export function TaskListPoller() {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  usePolling(refresh, TASK_LIST_POLL_INTERVAL_MS);
  return null;
}
