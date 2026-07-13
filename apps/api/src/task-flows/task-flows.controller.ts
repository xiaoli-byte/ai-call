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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FlowStatus, PERMISSIONS } from '@ai-call/shared';
import { TaskFlowsService } from './task-flows.service.js';
import { CreateTaskFlowDto } from './dto/create-task-flow.dto.js';
import { UpdateTaskFlowDto } from './dto/update-task-flow.dto.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { Permissions } from '../auth/decorators.js';
import { Public } from '../auth/decorators.js';

/**
 * 外呼任务流程 Controller
 *
 * 端点：
 *  - POST   /api/task-flows            创建流程
 *  - GET    /api/task-flows            列表（支持 status 过滤）
 *  - GET    /api/task-flows/:id        详情
 *  - GET    /api/task-flows/:id/runtime  Voice Agent 运行时读取（service-token）
 *  - PATCH  /api/task-flows/:id        更新
 *  - DELETE /api/task-flows/:id        删除
 *  - POST   /api/task-flows/:id/publish   发布（status → published, version++）
 *  - POST   /api/task-flows/:id/duplicate 复制（基于现有创建新草稿）
 */
@Controller('task-flows')
@Permissions(PERMISSIONS.FLOW_READ)
export class TaskFlowsController {
  constructor(private readonly taskFlowsService: TaskFlowsService) {}

  @Post()
  @Permissions(PERMISSIONS.FLOW_CREATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateTaskFlowDto) {
    return this.taskFlowsService.create(dto);
  }

  @Get()
  list(@Query('status') status?: FlowStatus) {
    return this.taskFlowsService.list({ status });
  }

  @Get(':id/runtime')
  @Public()
  @Permissions()
  @UseGuards(ServiceAuthGuard)
  getRuntime(@Param('id') id: string) {
    return this.taskFlowsService.get(id);
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
  @Permissions(PERMISSIONS.FLOW_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  update(@Param('id') id: string, @Body() dto: UpdateTaskFlowDto) {
    return this.taskFlowsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permissions(PERMISSIONS.FLOW_DELETE)
  async remove(@Param('id') id: string) {
    await this.taskFlowsService.remove(id);
  }

  @Post(':id/publish')
  @Permissions(PERMISSIONS.FLOW_PUBLISH)
  publish(@Param('id') id: string) {
    return this.taskFlowsService.publish(id);
  }

  @Post(':id/duplicate')
  @Permissions(PERMISSIONS.FLOW_CREATE)
  duplicate(@Param('id') id: string) {
    return this.taskFlowsService.duplicate(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Permissions(PERMISSIONS.FLOW_UPDATE)
  async test(@Param('id') id: string, @Body() body: { input?: string }) {
    return this.taskFlowsService.testFlow(id, body?.input ?? '');
  }
}
