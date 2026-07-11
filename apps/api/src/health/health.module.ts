import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

// PrismaService 来自全局 PrismaModule(@Global()),无需在此重复声明 providers。
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
