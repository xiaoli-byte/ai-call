'use client';

import useSWR, { useSWRConfig, unstable_serialize } from 'swr';
import { apiClient } from '@/lib/api/client';
import type {
  CreateSystemUserDto,
  SystemUser,
  UpdateSystemUserDto,
} from '@/lib/api/endpoints/system';

export const USERS_KEY = ['system', 'users'] as const;

export const usersKeyString = () => unstable_serialize(USERS_KEY);

export function useUsers() {
  return useSWR<SystemUser[]>(USERS_KEY, () => apiClient.users.list());
}

export function useUserMutations() {
  const { mutate } = useSWRConfig();
  return {
    create: async (dto: CreateSystemUserDto) => {
      const result = await apiClient.users.create(dto);
      await mutate(USERS_KEY);
      return result;
    },
    update: async (id: string, dto: UpdateSystemUserDto) => {
      await apiClient.users.update(id, dto);
      await mutate(USERS_KEY);
    },
    resetPassword: async (id: string, password: string) => {
      await apiClient.users.resetPassword(id, password);
    },
    remove: async (id: string) => {
      await apiClient.users.remove(id);
      await mutate(USERS_KEY);
    },
  };
}
