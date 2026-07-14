'use client';

import { useAuthStore } from '@/lib/auth-store';
import type { PermissionCode } from '@ai-call/shared';

/**
 * 单权限查询 Hook（按钮级权限门控 - 隐藏模式）
 *
 * 读取 useAuthStore 中的 user.permissions 判断当前用户是否具备指定权限码。
 * 用户未登录 / 资料未加载完成时一律返回 false（fail-closed），避免权限校验
 * 完成前按钮被误显示。
 */
export function usePermission(code: PermissionCode): boolean {
  const { user } = useAuthStore();
  return user?.permissions?.includes(code) ?? false;
}

/**
 * 批量权限查询 Hook
 *
 * - has：是否具备指定权限码
 * - hasAll：是否同时具备全部给定权限码
 * - hasAny：是否具备其中任意一个权限码
 *
 * 同样 fail-closed：用户未登录 / 资料未加载完成时三者均返回 false。
 */
export function usePermissions() {
  const { user } = useAuthStore();
  const permissions = user?.permissions ?? [];
  return {
    has: (code: PermissionCode) => permissions.includes(code),
    hasAll: (...codes: PermissionCode[]) => codes.every((code) => permissions.includes(code)),
    hasAny: (...codes: PermissionCode[]) => codes.some((code) => permissions.includes(code)),
  };
}
