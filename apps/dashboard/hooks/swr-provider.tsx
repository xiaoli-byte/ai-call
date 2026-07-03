'use client';

import { SWRConfig } from 'swr';
import { appToast } from '@/lib/toast';
import { ApiError } from '@/lib/api/types';

/**
 * 全局 SWR 配置。
 * - revalidateOnFocus: false 避免窗口聚焦时重复请求
 * - onError: 查询错误自动 toast，排除 401（已由 api 层 redirect 处理）
 * - shouldRetryOnError: 401 不重试（避免循环）
 */
export function SWRProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: Record<string, unknown>;
}) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        shouldRetryOnError: (err) =>
          !(err instanceof ApiError && err.isUnauthorized),
        onError: (err) => {
          if (
            err instanceof ApiError &&
            !err.isUnauthorized &&
            !err.isNetworkError
          ) {
            appToast.error(err);
          } else if (!(err instanceof ApiError)) {
            appToast.error(err);
          }
        },
        dedupingInterval: 2000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
