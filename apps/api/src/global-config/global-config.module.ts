import { Module } from '@nestjs/common';
import { GlobalConfigController } from './global-config.controller.js';
import { GlobalConfigService } from './global-config.service.js';

@Module({
  controllers: [GlobalConfigController],
  providers: [GlobalConfigService],
  exports: [GlobalConfigService],
})
export class GlobalConfigModule {}
