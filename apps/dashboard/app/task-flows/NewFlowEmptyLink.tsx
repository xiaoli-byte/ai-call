'use client';

import Link from 'next/link';
import { PERMISSIONS } from '@ai-call/shared';
import { usePermission } from '@/hooks/use-permission';

/**
 * 空态“创建第一个流程”入口链接。
 *
 * page.tsx 是 Server Component，权限判断依赖客户端 zustand store，
 * 因此拆成独立的小型 Client Component（同 ./NewFlowLink.tsx 的做法）。
 * 无 flow:create 权限时不渲染。
 */
export function NewFlowEmptyLink() {
  const canCreateFlow = usePermission(PERMISSIONS.FLOW_CREATE);
  if (!canCreateFlow) return null;

  return (
    <Link href="/task-flows/new" className="btn">创建第一个流程</Link>
  );
}
