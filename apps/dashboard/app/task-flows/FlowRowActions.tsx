'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
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
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action, fn: () => Promise<unknown>) {
    setPending(action);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setPending(null);
      setConfirmDelete(false);
    }
  }

  const canPublish = status === 'draft';
  const canArchive = status !== 'archived';

  return (
    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
      {error && (
        <span className="badge badge-danger" style={{ marginRight: 8 }}>
          {error}
        </span>
      )}
      <Link href={`/task-flows/${id}`} className="btn btn-secondary btn-sm">
        编辑
      </Link>
      {canPublish && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending !== null}
          onClick={() => run('publish', () => apiClient.taskFlows.publish(id))}
        >
          {pending === 'publish' ? '发布中…' : '发布'}
        </button>
      )}
      {canArchive && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending !== null}
          onClick={() => run('archive', () => apiClient.taskFlows.archive(id))}
        >
          {pending === 'archive' ? '归档中…' : '归档'}
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending !== null}
        onClick={() => run('duplicate', () => apiClient.taskFlows.duplicate(id))}
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
            <DialogTitle>确认删除流程？</DialogTitle>
            <DialogDescription>
              将永久删除流程「{name}」，此操作不可撤销。关联的已发布版本快照也会一并删除。
            </DialogDescription>
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
              onClick={() =>
                run('delete', () => apiClient.taskFlows.remove(id))
              }
            >
              {pending === 'delete' ? '删除中…' : '确认删除'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
