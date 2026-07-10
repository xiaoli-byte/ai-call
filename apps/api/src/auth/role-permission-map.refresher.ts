import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PermissionKey } from '@xiaoli-byte/authz/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { setRolePermissionMap } from './role-permission-map.store.js';

@Injectable()
export class RolePermissionMapRefresher implements OnModuleInit {
  private readonly logger = new Logger(RolePermissionMapRefresher.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 该 refresher 只为 HTTP 权限校验预热内存态的 role→permission 映射。
    // 无头 worker(scheduler/outbox)不做 HTTP authz,预热失败不应让进程崩溃。
    try {
      await this.refresh();
    } catch (err) {
      this.logger.warn(
        `role-permission map warm-up skipped: ${(err as Error).message}`,
      );
    }
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
