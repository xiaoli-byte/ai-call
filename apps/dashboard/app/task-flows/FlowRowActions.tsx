'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useTaskFlowMutations } from '@/hooks/use-task-flows';
import { appToast } from '@/lib/toast';
import type { FlowStatus } from '@ai-call/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface FlowRowActionsProps {
  id: string;
  status: FlowStatus;
  name: string;
}

type Action = 'publish' | 'archive' | 'duplicate' | 'delete' | null;

export function FlowRowActions({ id, status, name }: FlowRowActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Action>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { publish, archive, duplicate, remove } = useTaskFlowMutations();

  async function run(action: Action, fn: () => Promise<unknown>, successMsg: string) {
    setPending(action);
    try {
      await fn();
      appToast.success(successMsg);
      // 本页表格来自 Server Component 的服务端渲染（page.tsx 直接调
      // apiServer.taskFlows.list()），不订阅下面这些 mutation 用的 SWR
      // 缓存——只 invalidate SWR 不会让这张表重渲染。必须显式 refresh
      // 才能让已删除/新状态的行从表格里消失/更新，否则要等用户手动刷新页面。
      router.refresh();
    } catch (e) {
      appToast.error(e);
    } finally {
      setPending(null);
      setConfirmDelete(false);
    }
  }

  const canPublish = status === 'draft';
  const canArchive = status !== 'archived';

  return (
    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
      <Link href={`/task-flows/${id}`} className="btn btn-secondary btn-sm">
        编辑
      </Link>
      {canPublish && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending !== null}
          onClick={() => run('publish', () => publish(id), '流程已发布')}
        >
          {pending === 'publish' ? '发布中…' : '发布'}
        </button>
      )}
      {canArchive && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending !== null}
          onClick={() => run('archive', () => archive(id), '流程已归档')}
        >
          {pending === 'archive' ? '归档中…' : '归档'}
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending !== null}
        onClick={() => run('duplicate', () => duplicate(id), '流程已复制')}
      >
        {pending === 'duplicate' ? '复制中…' : '复制'}
      </button>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={pending !== null}
        onClick={() => setConfirmDelete(true)}
      >
        删除
      </button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
                <AlertTriangle size={20} />
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                <DialogTitle>确认删除流程？</DialogTitle>
                <DialogDescription>
                  将永久删除流程「{name}」，此操作不可撤销。若该流程已发布过版本或仍被任务引用，删除会被拒绝，请改用「归档」。
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setConfirmDelete(false)}
              disabled={pending !== null}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={pending !== null}
              onClick={() => run('delete', () => remove(id), '流程已删除')}
            >
              {pending === 'delete' ? '删除中…' : '确认删除'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
