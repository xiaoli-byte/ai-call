import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** DB 探测超时(ms)——超时也判为不健康,避免健康检查本身被慢查询拖死。 */
const DB_PING_TIMEOUT_MS = 2_000;

/**
 * D8:API 自身的存活/就绪端点(供负载均衡器/进程管理探活)。
 *
 * 无需登录(全局 JwtAuthGuard/PermissionsGuard 靠 @Public() 豁免),也不要求
 * X-Service-Token——健康探针通常不会带任何鉴权头。DB 探测用 `SELECT 1`,
 * 2s 超时;进程活着但打不通数据库时故意回 503,让负载均衡器把这个实例摘除。
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    const dbUp = await this.pingDb();
    response.status(dbUp ? 200 : 503);
    return {
      status: dbUp ? 'ok' : 'error',
      db: dbUp ? 'up' : 'down',
      uptime_s: Math.floor(process.uptime()),
    };
  }

  private async pingDb(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('db ping timed out')), DB_PING_TIMEOUT_MS);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      // 无论谁先完成都要清掉定时器,避免残留 timer 拖住进程退出(尤其单测)。
      if (timer) clearTimeout(timer);
    }
  }
}
