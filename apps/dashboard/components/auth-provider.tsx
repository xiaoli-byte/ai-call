'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/lib/auth-store';

/**
 * 认证 Provider：基于 SWR useAuth 获取当前用户，同步到 zustand。
 *
 * 路由切换不再重复请求 /auth/me：SWR 用 root layout 注入的 fallback 缓存，
 * revalidateOnFocus: false 避免窗口聚焦时重复请求。
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useAuth();
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    setUser(user ?? null);
    setLoading(isLoading);
  }, [user, isLoading, setUser, setLoading]);

  return <>{children}</>;
}
