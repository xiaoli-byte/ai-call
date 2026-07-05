import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VoiceClonesController } from './voice-clones.controller.js';
import { VoiceClonesService } from './voice-clones.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [VoiceClonesController],
  providers: [VoiceClonesService],
  exports: [VoiceClonesService],
})
export class VoiceClonesModule {}
