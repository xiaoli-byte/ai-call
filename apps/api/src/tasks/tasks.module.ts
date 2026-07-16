import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
import { WebDemoController } from './web-demo.controller.js';
import { TasksService } from './tasks.service.js';
import { FreeSwitchModule } from '../freeswitch/freeswitch.module.js';
import { TaskFlowsModule } from '../task-flows/task-flows.module.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { ScenariosModule } from '../scenarios/scenarios.module.js';
import { GlobalConfigModule } from '../global-config/global-config.module.js';

@Module({
  imports: [
    FreeSwitchModule,
    TaskFlowsModule,
    ScenariosModule,
    GlobalConfigModule,
  ],
  controllers: [TasksController, WebDemoController],
  providers: [TasksService, ServiceAuthGuard],
  exports: [TasksService],
})
export class TasksModule {}
