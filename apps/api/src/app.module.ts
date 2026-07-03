import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScenariosModule } from './scenarios/scenarios.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TaskFlowsModule } from './task-flows/task-flows.module.js';
import { LlmModule } from './llm/llm.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SystemModule } from './system/system.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { PermissionsGuard } from './auth/permissions.guard.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    LlmModule,
    ScenariosModule,
    TasksModule,
    ToolsModule,
    KnowledgeBaseModule,
    TaskFlowsModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
