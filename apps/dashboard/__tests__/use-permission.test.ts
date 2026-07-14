/**
 * usePermission / usePermissions Hook 单元测试
 *
 * 覆盖：具备权限码返回 true / 不具备权限码返回 false / 未登录（user 为 null）一律 fail-closed 返回 false。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePermission, usePermissions } from '@/hooks/use-permission';
import { useAuthStore } from '@/lib/auth-store';
import { UserStatus, type UserProfile } from '@ai-call/shared';

const operatorUser: UserProfile = {
  id: 'user-1',
  email: 'operator@example.com',
  name: '测试操作员',
  status: UserStatus.ACTIVE,
  roles: ['operator'],
  permissions: ['task:read', 'task:create'],
};

afterEach(() => {
  // 每个用例结束后重置为未登录状态，避免用例间状态污染
  act(() => {
    useAuthStore.getState().logout();
  });
});

describe('usePermission', () => {
  it('用户具备该权限码时返回 true', () => {
    act(() => {
      useAuthStore.getState().setUser(operatorUser);
    });
    const { result } = renderHook(() => usePermission('task:create'));
    expect(result.current).toBe(true);
  });

  it('用户不具备该权限码时返回 false', () => {
    act(() => {
      useAuthStore.getState().setUser(operatorUser);
    });
    const { result } = renderHook(() => usePermission('task:delete'));
    expect(result.current).toBe(false);
  });

  it('未登录（user 为 null）时一律返回 false', () => {
    act(() => {
      useAuthStore.getState().logout();
    });
    const { result } = renderHook(() => usePermission('task:read'));
    expect(result.current).toBe(false);
  });
});

describe('usePermissions', () => {
  it('已登录时 has/hasAny/hasAll 按权限码正确判断', () => {
    act(() => {
      useAuthStore.getState().setUser(operatorUser);
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has('task:create')).toBe(true);
    expect(result.current.hasAny('task:delete', 'task:create')).toBe(true);
    expect(result.current.hasAll('task:read', 'task:create')).toBe(true);
    expect(result.current.hasAll('task:read', 'task:delete')).toBe(false);
  });

  it('未登录时 has/hasAny 一律返回 false', () => {
    act(() => {
      useAuthStore.getState().logout();
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has('task:read')).toBe(false);
    expect(result.current.hasAny('task:read', 'task:create')).toBe(false);
  });
});
