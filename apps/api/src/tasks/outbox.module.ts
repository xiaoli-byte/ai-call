import { Module } from '@nestjs/common';
import { FreeSwitchModule } from '../freeswitch/freeswitch.module.js';
import { ActionDeliveryService } from './action-delivery.service.js';
import { OutboxWorker } from './outbox.worker.js';

@Module({
  imports: [FreeSwitchModule],
  providers: [ActionDeliveryService, OutboxWorker],
  exports: [OutboxWorker],
})
export class OutboxModule {}
