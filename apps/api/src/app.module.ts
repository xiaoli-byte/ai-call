import { Module } from '@nestjs/common';
import { ScenariosModule } from './scenarios/scenarios.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TaskFlowsModule } from './task-flows/task-flows.module.js';

@Module({
  imports: [
    PrismaModule,
    ScenariosModule,
    TasksModule,
    ToolsModule,
    KnowledgeBaseModule,
    TaskFlowsModule,
  ],
})
export class AppModule {}
