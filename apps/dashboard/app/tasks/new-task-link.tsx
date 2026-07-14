'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PERMISSIONS } from '@ai-call/shared';
import { usePermission } from '@/hooks/use-permission';

import styles from './tasks.module.scss';

/**
 * “发起外呼”入口链接。
 *
 * page.tsx 是 Server Component，权限判断依赖客户端 zustand store，
 * 因此拆成独立的小型 Client Component（同 ./task-list-poller.tsx 的做法）。
 * 无 task:create 权限时不渲染。
 */
export function NewTaskLink() {
  const canCreateTask = usePermission(PERMISSIONS.TASK_CREATE);
  if (!canCreateTask) return null;

  return (
    <Link href="/tasks/new" className={styles.primaryButton}>
      <Plus size={15} />
      发起外呼
    </Link>
  );
}
