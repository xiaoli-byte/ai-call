import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ClsService } from 'nestjs-cls';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTenantExtension } from './tenant-extension.js';

/**
 * Prisma 7.x Service —— 租户作用域客户端（CALL-03）
 *
 * 通过 provider 工厂注入（见 prisma.module.ts）：底层用 @prisma/adapter-pg 实例化
 * PrismaClient，再 `$extends` 租户扩展，对 15 张业务表的读/写强制注入 tenantId
 * （来源为 CLS，由 @xiaoli-byte/authz 的 JwtAuthGuard 写入）。
 *
 * 本 class 仅作为 DI token 与类型（形如基础 PrismaClient）；运行时注入的实例是
 * 扩展后的 client，故其模型委托（this.prisma.outboundTask 等）与既有调用点完全
 * 兼容，无需改动调用方。
 */
export class PrismaService extends PrismaClient {}

const logger = new Logger('PrismaService');

/** 构建租户作用域的扩展 client；由 PrismaModule 的工厂 provider 调用。 */
export function createPrismaService(cls: ClsService): PrismaService {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Please configure it in .env or environment.',
    );
  }
  const adapter = new PrismaPg({ connectionString: url });
  const base = new PrismaClient({ adapter });
  logger.log('Prisma client created (tenant-scoped extension applied)');
  return base.$extends(createTenantExtension(cls)) as unknown as PrismaService;
}
