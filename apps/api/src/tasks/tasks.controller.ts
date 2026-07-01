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
import {
  CallOutcome,
  Scenario,
  TaskStatus,
} from '@ai-call/shared';
import { TasksService } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import {
  HangupDto,
  SetOutcomeDto,
  TranscriptTurnDto,
  UpdateTaskStatusDto,
} from './dto/task-events.dto.js';

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
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  /** 列表查询 */
  @Get()
  list(
    @Query('scenario') scenario?: Scenario,
    @Query('status') status?: TaskStatus,
    @Query('outcome') outcome?: CallOutcome,
  ) {
    return this.tasksService.list({ scenario, status, outcome });
  }

  /** 获取任务详情 */
  @Get(':id/context')
  @UseGuards(ServiceAuthGuard)
  getContext(@Param('id') id: string) {
    return this.tasksService.get(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tasksService.get(id);
  }

  /** 派发外呼任务 - 通过 FreeSWITCH ESL originate 发起呼叫 */
  @Post(':id/dispatch')
  @HttpCode(202)
  async dispatch(@Param('id') id: string) {
    return this.tasksService.dispatch(id);
  }

  /** 更新任务状态 */
  @Patch(':id/status')
  @UseGuards(ServiceAuthGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateTaskStatusDto,
  ) {
    return this.tasksService.updateStatus(id, body.status);
  }

  /** 上报对话转写条目（Voice Agent 调用） */
  @Patch(':id/transcript')
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
  @UseGuards(ServiceAuthGuard)
  hangup(
    @Param('id') id: string,
    @Body() body: HangupDto = {},
  ) {
    return this.tasksService.hangup(id, body);
  }

  /** 删除任务 */
  @Post(':id/delete')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
  }
}
