import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { TasksService } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { CreateTaskBatchDto } from './dto/create-task-batch.dto.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { Permissions } from '../auth/decorators.js';
import { Public } from '../auth/decorators.js';
import {
  HangupDto,
  FlowActionDto,
  SetOutcomeDto,
  TranscriptTurnDto,
  UpdateTaskStatusDto,
} from './dto/task-events.dto.js';
import { ListTasksDto } from './dto/list-tasks.dto.js';
import { ProviderCallEventDto } from './dto/provider-call-event.dto.js';

/**
 * 外呼任务 Controller
 *
 * 对接 Next.js Dashboard 与 Voice Agent：
 *  - Dashboard 调用 POST 创建任务
 *  - Dashboard 调用 POST /:id/dispatch 派发（触发 FreeSWITCH ESL originate）
 *  - Voice Agent 调用 GET /:id/context 读取受保护的任务上下文
 *  - Voice Agent 调用 PATCH /:id/transcript 上报转写
 *  - Voice Agent 调用 PATCH /:id/outcome 上报结果
 *  - Voice Agent 调用 POST /:id/transfer 转人工（触发 FreeSWITCH uuid_transfer）
 *  - Voice Agent 调用 POST /:id/hangup 挂机（设置 endedAt/duration/outcome）
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /** 创建外呼任务 */
  @Post()
  @Permissions(PERMISSIONS.TASK_CREATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  /** 按名单批量创建外呼任务 */
  @Post('batch')
  @Permissions(PERMISSIONS.TASK_CREATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  createBatch(@Body() dto: CreateTaskBatchDto) {
    return this.tasksService.createBatch(dto);
  }

  /** 列表查询 */
  @Get()
  @Permissions(PERMISSIONS.TASK_READ)
  list(@Query() query: ListTasksDto) {
    return this.tasksService.list(query);
  }

  /** FreeSWITCH/Voice bridge writes provider-side call events back into task history. */
  @Post('provider-events')
  @Public()
  @UseGuards(ServiceAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  recordProviderCallEvent(@Body() body: ProviderCallEventDto) {
    return this.tasksService.recordProviderCallEvent(body);
  }

  /** 获取任务详情 */
  @Get(':id/context')
  @Public()
  @UseGuards(ServiceAuthGuard)
  getContext(@Param('id') id: string) {
    return this.tasksService.getContext(id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.TASK_READ)
  get(@Param('id') id: string) {
    return this.tasksService.get(id);
  }

  /** 派发外呼任务 - 通过 FreeSWITCH ESL originate 发起呼叫 */
  @Post(':id/dispatch')
  @HttpCode(202)
  @Permissions(PERMISSIONS.TASK_DISPATCH)
  async dispatch(@Param('id') id: string) {
    return this.tasksService.dispatch(id);
  }

  /** 更新任务状态 */
  @Patch(':id/status')
  @Public()
  @UseGuards(ServiceAuthGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateTaskStatusDto,
  ) {
    return this.tasksService.updateStatus(id, body.status);
  }

  /** 上报对话转写条目（Voice Agent 调用） */
  @Patch(':id/transcript')
  @Public()
  @UseGuards(ServiceAuthGuard)
  appendTranscript(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() turn: TranscriptTurnDto,
  ) {
    return this.tasksService.appendTranscript(id, {
      ...turn,
      timestamp: Date.now() / 1000,
    }, idempotencyKey);
  }

  /** 上报通话结果（Voice Agent 调用） */
  @Patch(':id/outcome')
  @Public()
  @UseGuards(ServiceAuthGuard)
  setOutcome(
    @Param('id') id: string,
    @Body() body: SetOutcomeDto,
  ) {
    return this.tasksService.setOutcome(id, body.outcome, body.tags);
  }

  /** 转人工（Voice Agent 在 onEscalate 时调用） */
  @Post(':id/transfer')
  @HttpCode(202)
  @Public()
  @UseGuards(ServiceAuthGuard)
  async transfer(
    @Param('id') id: string,
    @Body('extension') extension?: string,
  ) {
    return this.tasksService.transferToHuman(id, extension);
  }

  /** 挂机（Voice Agent 通话结束时调用）*/
  @Post(':id/hangup')
  @HttpCode(200)
  @Public()
  @UseGuards(ServiceAuthGuard)
  hangup(
    @Param('id') id: string,
    @Body() body: HangupDto = {},
  ) {
    return this.tasksService.hangup(id, body);
  }

  /** Voice Agent 将 SMS/API 动作可靠写入 outbox。 */
  @Post(':id/actions')
  @HttpCode(202)
  @Public()
  @UseGuards(ServiceAuthGuard)
  enqueueAction(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: FlowActionDto,
  ) {
    return this.tasksService.enqueueAction(id, body.actionType, body.config, idempotencyKey);
  }

  /** 删除任务 */
  @Post(':id/delete')
  @HttpCode(204)
  @Permissions(PERMISSIONS.TASK_DELETE)
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
  }
}
