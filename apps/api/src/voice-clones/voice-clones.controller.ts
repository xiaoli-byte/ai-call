import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { CreateVoiceCloneDto } from './dto/create-voice-clone.dto.js';
import { CreateVoiceClonePreviewDto } from './dto/create-voice-clone-preview.dto.js';
import { SynthesizeVoiceCloneDto } from './dto/synthesize-voice-clone.dto.js';
import { VoiceClonesService } from './voice-clones.service.js';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

@Controller('voice-clones')
@Permissions(PERMISSIONS.SCENARIO_READ)
export class VoiceClonesController {
  constructor(private readonly voiceClones: VoiceClonesService) {}

  @Get()
  list() {
    return this.voiceClones.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.voiceClones.get(id);
  }

  @Post()
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }))
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  create(
    @Body() dto: CreateVoiceCloneDto,
    @UploadedFile() audio: Express.Multer.File,
  ) {
    return this.voiceClones.create(dto, audio);
  }

  @Post('preview')
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }))
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createPreview(
    @Body() dto: CreateVoiceClonePreviewDto,
    @UploadedFile() audio: Express.Multer.File,
  ) {
    return this.voiceClones.createPreview(dto, audio);
  }

  @Post(':id/synthesize')
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  synthesize(
    @Param('id') id: string,
    @Body() dto: SynthesizeVoiceCloneDto,
  ) {
    return this.voiceClones.synthesize(id, dto);
  }

  @Post(':id/confirm')
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  confirm(@Param('id') id: string) {
    return this.voiceClones.confirm(id);
  }

  @Get(':id/audio')
  async sourceAudio(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return this.streamAudio(await this.voiceClones.getAudio(id, 'source'), res);
  }

  @Get(':id/preview-audio')
  async previewAudio(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return this.streamAudio(await this.voiceClones.getAudio(id, 'preview'), res);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  async remove(@Param('id') id: string) {
    await this.voiceClones.remove(id);
  }

  private streamAudio(
    file: Awaited<ReturnType<VoiceClonesService['getAudio']>>,
    res: Response,
  ) {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.filename)}"`,
    );
    return new StreamableFile(file.stream);
  }
}
