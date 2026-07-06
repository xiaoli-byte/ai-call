import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { OutboxModule } from './tasks/outbox.module.js';

@Module({
  imports: [PrismaModule, OutboxModule],
})
export class OutboxWorkerModule {}
