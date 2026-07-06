import { Module } from '@nestjs/common';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module.js';
import { ScenariosModule } from '../scenarios/scenarios.module.js';
import { TaskFlowsModule } from '../task-flows/task-flows.module.js';
import { ScenarioTestsController } from './scenario-tests.controller.js';
import { ScenarioTestsService } from './scenario-tests.service.js';

@Module({
  imports: [ScenariosModule, TaskFlowsModule, KnowledgeBaseModule],
  controllers: [ScenarioTestsController],
  providers: [ScenarioTestsService],
  exports: [ScenarioTestsService],
})
export class ScenarioTestsModule {}
