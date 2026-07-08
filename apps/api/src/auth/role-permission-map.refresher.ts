import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PermissionKey } from '@xiaoli-byte/authz/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { setRolePermissionMap } from './role-permission-map.store.js';

@Injectable()
export class RolePermissionMapRefresher implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const roles = await this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
    });
    const map: Record<string, PermissionKey[]> = {};
    for (const role of roles) {
      map[role.name] = role.permissions.map(
        (rp) => rp.permission.code as unknown as PermissionKey,
      );
    }
    setRolePermissionMap(map);
  }
}
