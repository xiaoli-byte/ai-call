import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { LlmModule } from './llm/llm.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TaskSchedulerService } from './tasks/task-scheduler.service.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  // worker 是独立 Nest 上下文,必须自带 AppModule 里那些 @Global 基础模块:
  // ClsModule(PrismaModule 租户工厂注入 ClsService,worker 无 HTTP 中间件)、
  // LlmModule(TasksModule 深层的 TaskFlowsService 依赖 @Global 的 LlmService)。
  imports: [
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    LlmModule,
    MetricsModule,
    TasksModule,
  ],
  providers: [TaskSchedulerService],
})
export class SchedulerWorkerModule {}
