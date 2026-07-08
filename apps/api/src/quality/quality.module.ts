import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { QualityController } from './quality.controller.js';
import { QualityService } from './quality.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
