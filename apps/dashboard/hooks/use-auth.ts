'use client';

import useSWR from 'swr';
import { apiClient } from '@/lib/api/client';
import type { UserProfile } from '@ai-call/shared';
import { AUTH_KEY } from './auth-key';

export { AUTH_KEY, authKeyString } from './auth-key';

/**
 * 认证 hook：基于 SWR 获取当前用户。
 *
 * Server Component（root layout）用 apiServer.auth.me() 预取，
 * 通过 unstable_serialize 生成 key 注入 SWRProvider fallback，
 * 客户端首次渲染零请求，路由切换不重复调 /auth/me。
 *
 * 未登录时 fallback 不含 auth key，useAuth 会触发请求，
 * api 层 401 处理后 setUser(null)，不影响 /login 页面。
 */
export function useAuth() {
  return useSWR<UserProfile>(AUTH_KEY, () => apiClient.auth.me(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
}
