import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
