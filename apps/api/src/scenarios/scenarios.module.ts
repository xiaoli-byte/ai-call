import { Module } from '@nestjs/common';
import { ScenariosController } from './scenarios.controller.js';

@Module({
  controllers: [ScenariosController],
})
export class ScenariosModule {}
