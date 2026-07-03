import type { HttpAdapter } from '../types';
import type { Permission, PermissionCode } from '@ai-call/shared';

export interface SystemUser {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: Array<{ id: string; name: string }>;
  createdAt: string;
}

export interface CreateSystemUserDto {
  email: string;
  password: string;
  name: string;
  roleIds?: string[];
}

export interface UpdateSystemUserDto {
  name?: string;
  status?: string;
  roleIds?: string[];
}

export interface SystemRole {
  id: string;
  name: string;
  description: string;
  permissions: Array<{
    id: string;
    code: PermissionCode;
    description: string;
  }>;
  userCount: number;
}

export interface CreateSystemRoleDto {
  name: string;
  description?: string;
  permissionCodes?: PermissionCode[];
}

export interface UpdateSystemRoleDto {
  name?: string;
  description?: string;
  permissionCodes?: PermissionCode[];
}

export function systemEndpoints(http: HttpAdapter) {
  return {
    users: {
      list: () => http.request<SystemUser[]>('/system/users'),
      get: (id: string) => http.request<SystemUser>(`/system/users/${id}`),
      create: (dto: CreateSystemUserDto) =>
        http.request<{ id: string }>('/system/users', {
          method: 'POST',
          body: dto,
        }),
      update: (id: string, dto: UpdateSystemUserDto) =>
        http.request<void>(`/system/users/${id}`, {
          method: 'PATCH',
          body: dto,
        }),
      resetPassword: (id: string, password: string) =>
        http.request<void>(`/system/users/${id}/password`, {
          method: 'POST',
          body: { password },
        }),
      remove: (id: string) =>
        http.request<void>(`/system/users/${id}`, { method: 'DELETE' }),
    },
    roles: {
      list: () => http.request<SystemRole[]>('/system/roles'),
      create: (dto: CreateSystemRoleDto) =>
        http.request<{ id: string }>('/system/roles', {
          method: 'POST',
          body: dto,
        }),
      update: (id: string, dto: UpdateSystemRoleDto) =>
        http.request<void>(`/system/roles/${id}`, {
          method: 'PATCH',
          body: dto,
        }),
      remove: (id: string) =>
        http.request<void>(`/system/roles/${id}`, { method: 'DELETE' }),
    },
    permissions: {
      list: () => http.request<Permission[]>('/system/permissions'),
    },
  };
}
