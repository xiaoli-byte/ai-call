import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FlowStatus } from '@ai-call/shared';
import { TaskFlowsService } from './task-flows.service.js';
import { CreateTaskFlowDto } from './dto/create-task-flow.dto.js';
import { UpdateTaskFlowDto } from './dto/update-task-flow.dto.js';

/**
 * 外呼任务流程 Controller
 *
 * 端点：
 *  - POST   /api/task-flows            创建流程
 *  - GET    /api/task-flows            列表（支持 status 过滤）
 *  - GET    /api/task-flows/:id        详情
 *  - PATCH  /api/task-flows/:id        更新
 *  - DELETE /api/task-flows/:id        删除
 *  - POST   /api/task-flows/:id/publish   发布（status → published, version++）
 *  - POST   /api/task-flows/:id/archive   归档（status → archived）
 *  - POST   /api/task-flows/:id/duplicate 复制（基于现有创建新草稿）
 */
@Controller('task-flows')
export class TaskFlowsController {
  constructor(private readonly taskFlowsService: TaskFlowsService) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateTaskFlowDto) {
    return this.taskFlowsService.create(dto);
  }

  @Get()
  list(@Query('status') status?: FlowStatus) {
    return this.taskFlowsService.list({ status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.taskFlowsService.get(id);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.taskFlowsService.listVersions(id);
  }

  @Get('versions/:versionId')
  getVersion(@Param('versionId') versionId: string) {
    return this.taskFlowsService.getVersion(versionId);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  update(@Param('id') id: string, @Body() dto: UpdateTaskFlowDto) {
    return this.taskFlowsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.taskFlowsService.remove(id);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.taskFlowsService.publish(id);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.taskFlowsService.archive(id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string) {
    return this.taskFlowsService.duplicate(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  async test(@Param('id') id: string, @Body() body: { input?: string }) {
    return this.taskFlowsService.testFlow(id, body?.input ?? '');
  }
}
