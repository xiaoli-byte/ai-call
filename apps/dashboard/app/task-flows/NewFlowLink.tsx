'use client';

import Link from 'next/link';
import { PERMISSIONS } from '@ai-call/shared';
import { usePermission } from '@/hooks/use-permission';

/**
 * “新建流程”入口链接。
 *
 * page.tsx 是 Server Component，权限判断依赖客户端 zustand store，
 * 因此拆成独立的小型 Client Component（同 ./FlowRowActions.tsx 的做法）。
 * 无 flow:create 权限时不渲染。
 */
export function NewFlowLink() {
  const canCreateFlow = usePermission(PERMISSIONS.FLOW_CREATE);
  if (!canCreateFlow) return null;

  return (
    <Link href="/task-flows/new" className="btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      新建流程
    </Link>
  );
}
