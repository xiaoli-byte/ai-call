import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS } from '@ai-call/shared';
import { KnowledgeBaseService } from './knowledge-base.service.js';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';

/**
 * 知识库 Controller
 *
 * 提供给 Voice Agent 和 Dashboard 调用：
 *  - GET /api/knowledge-base        列出所有知识库
 *  - GET /api/knowledge-base/:id    获取知识库详情
 *  - POST /api/knowledge-base/:id/retrieve  检索（Voice Agent 调用）
 *  - POST /api/knowledge-base/:id/upload     上传文档（Dashboard 调用）
 */
@Controller('knowledge-base')
@Permissions(PERMISSIONS.KNOWLEDGE_READ)
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Get()
  async list() {
    return this.kbService.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.kbService.get(id);
  }

  @Post(':id/retrieve')
  @Public()
  @Permissions()
  @UseGuards(ServiceAuthGuard)
  async retrieve(
    @Param('id') id: string,
    @Body() body: { query: string; topK?: number },
  ) {
    return {
      query: body.query,
      results: await this.kbService.retrieve(id, body.query, body.topK ?? 3),
    };
  }

  @Post(':id/test-retrieve')
  async testRetrieve(
    @Param('id') id: string,
    @Body() body: { query: string; topK?: number },
  ) {
    return this.kbService.testRetrieve(id, {
      query: body.query,
      topK: body.topK ?? 3,
    });
  }

  @Post(':id/upload')
  @Permissions(PERMISSIONS.KNOWLEDGE_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) return { error: 'No file uploaded' };
    return this.kbService.upload(id, file.originalname, file.buffer);
  }
}
