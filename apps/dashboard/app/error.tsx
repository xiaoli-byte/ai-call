'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/types';

/**
 * 根级 error boundary：捕获 Server Component 抛出的未处理错误。
 * 401 已在 api 层 redirect，这里主要兜底网络错误 / 5xx / 意外异常。
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 401 不 toast（已被 api 层处理）
    if (!(error instanceof ApiError && error.isUnauthorized)) {
      toast.error(error.message || '页面加载失败');
    }
  }, [error]);

  const isNetworkError =
    error instanceof ApiError && error.isNetworkError;

  return (
    <div className="card">
      <div className="empty">
        <div className="empty-title" style={{ color: 'var(--danger)' }}>
          {isNetworkError ? '无法连接服务' : '页面出错了'}
        </div>
        <div className="empty-desc">{error.message}</div>
        <button className="btn" onClick={reset}>
          重试
        </button>
      </div>
    </div>
  );
}
