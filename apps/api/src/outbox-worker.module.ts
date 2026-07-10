import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { LlmModule } from './llm/llm.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { OutboxModule } from './tasks/outbox.module.js';

@Module({
  // worker 是独立 Nest 上下文,必须自带 AppModule 里那些 @Global 基础模块:
  // ClsModule(PrismaModule 租户工厂注入 ClsService,worker 无 HTTP 中间件)、
  // LlmModule(OutboxModule 深层依赖 @Global 的 LlmService)。
  imports: [ClsModule.forRoot({ global: true }), PrismaModule, LlmModule, OutboxModule],
})
export class OutboxWorkerModule {}
