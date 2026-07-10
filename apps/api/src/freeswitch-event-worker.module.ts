import { Module } from '@nestjs/common';
import { FreeSwitchModule } from './freeswitch/freeswitch.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { FreeSwitchEventBridgeService } from './freeswitch/freeswitch-event-bridge.service.js';
import { FreeSwitchEventWorkerHealthController } from './freeswitch/freeswitch-event-worker-health.controller.js';
import { FreeSwitchEventWorkerService } from './freeswitch/freeswitch-event-worker.service.js';

@Module({
  imports: [FreeSwitchModule, MetricsModule],
  controllers: [FreeSwitchEventWorkerHealthController],
  providers: [FreeSwitchEventBridgeService, FreeSwitchEventWorkerService],
  exports: [FreeSwitchEventBridgeService, FreeSwitchEventWorkerService],
})
export class FreeSwitchEventWorkerModule {}
