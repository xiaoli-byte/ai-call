import { Module } from '@nestjs/common';
import { FreeSwitchEventBridgeService } from './freeswitch/freeswitch-event-bridge.service.js';

@Module({
  providers: [FreeSwitchEventBridgeService],
  exports: [FreeSwitchEventBridgeService],
})
export class FreeSwitchEventWorkerModule {}
