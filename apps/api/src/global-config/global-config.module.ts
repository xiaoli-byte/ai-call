import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GlobalConfigController } from './global-config.controller.js';
import { GlobalConfigService } from './global-config.service.js';

@Module({
  imports: [AuthModule],
  controllers: [GlobalConfigController],
  providers: [GlobalConfigService],
  exports: [GlobalConfigService],
})
export class GlobalConfigModule {}
