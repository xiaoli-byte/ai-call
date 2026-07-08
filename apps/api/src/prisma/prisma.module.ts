import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService, createPrismaService } from './prisma.service.js';

/**
 * 全局 Prisma 模块
 *
 * 通过工厂 provider 注入“租户作用域”的扩展 client（见 prisma.service.ts / tenant-extension.ts）。
 * 依赖全局 ClsService（HTTP 由 AppModule 的 ClsModule 提供；各 worker 模块需各自
 * 注册 ClsModule.forRoot，否则 DI 无法解析 ClsService）。
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: (cls: ClsService) => createPrismaService(cls),
      inject: [ClsService],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule implements OnModuleDestroy {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
