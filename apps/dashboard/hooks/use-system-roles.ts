'use client';

import useSWR, { useSWRConfig, unstable_serialize } from 'swr';
import { apiClient } from '@/lib/api/client';
import type {
  CreateSystemRoleDto,
  SystemRole,
  UpdateSystemRoleDto,
} from '@/lib/api/endpoints/system';
import type { Permission } from '@ai-call/shared';

export const ROLES_KEY = ['system', 'roles'] as const;
export const PERMISSIONS_KEY = ['system', 'permissions'] as const;

export const rolesKeyString = () => unstable_serialize(ROLES_KEY);
export const permissionsKeyString = () =>
  unstable_serialize(PERMISSIONS_KEY);

export function useRoles() {
  return useSWR<SystemRole[]>(ROLES_KEY, () => apiClient.roles.list());
}

export function usePermissions() {
  return useSWR<Permission[]>(PERMISSIONS_KEY, () =>
    apiClient.permissions.list(),
  );
}

export function useRoleMutations() {
  const { mutate } = useSWRConfig();
  return {
    create: async (dto: CreateSystemRoleDto) => {
      const result = await apiClient.roles.create(dto);
      await mutate(ROLES_KEY);
      return result;
    },
    update: async (id: string, dto: UpdateSystemRoleDto) => {
      await apiClient.roles.update(id, dto);
      await mutate(ROLES_KEY);
    },
    remove: async (id: string) => {
      await apiClient.roles.remove(id);
      await mutate(ROLES_KEY);
    },
  };
}
