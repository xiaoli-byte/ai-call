import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';
import { KnowledgeIdentitySyncService } from './knowledge-identity-sync.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SystemController],
  providers: [SystemService, KnowledgeIdentitySyncService],
  exports: [SystemService],
})
export class SystemModule {}
