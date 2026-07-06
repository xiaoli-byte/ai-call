import { Module } from '@nestjs/common';
import { FreeSwitchModule } from '../freeswitch/freeswitch.module.js';
import { GlobalConfigModule } from '../global-config/global-config.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { ActionDeliveryService } from './action-delivery.service.js';
import { OutboxWorker } from './outbox.worker.js';

@Module({
  imports: [FreeSwitchModule, GlobalConfigModule, MetricsModule, ToolsModule],
  providers: [ActionDeliveryService, OutboxWorker],
  exports: [OutboxWorker],
})
export class OutboxModule {}
