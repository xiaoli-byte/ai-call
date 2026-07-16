import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  NotFoundException,
  Optional,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Public } from '../auth/decorators.js';
import { TENANT_CLS_KEY } from '../prisma/system-context.js';
import { TasksService } from './tasks.service.js';
import { TaskFlowsService } from '../task-flows/task-flows.service.js';
import { StartWebDemoCallDto } from './dto/start-web-demo-call.dto.js';

/** 被叫固定为本机联调分机：匿名入口绝不允许自定义被叫号码 */
const DEMO_CALLEE = '1001';
/** 流程未携带场景配置时的兜底场景 */
const FALLBACK_SCENARIO = 'ecommerce';
/**
 * 首页体验绑定的租户：匿名请求没有 JWT 租户上下文（CALL-03 fail-closed 会拒绝），
 * 这里显式绑定到共享 demo 租户（CALL-02 迁移的默认回填租户），而非系统级 bypass，
 * 保证匿名入口只能看到/执行该租户下的流程。可用 WEB_DEMO_TENANT_ID 覆盖。
 */
const DEFAULT_DEMO_TENANT_ID = 'tenant_demo';
/** 每 IP 在窗口期内最多发起的模拟外呼次数 */
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * 首页匿名模拟外呼（无需登录）
 *
 * 安全边界：
 *  - GET /web-demo/flows 仅返回已发布流程的 { id, name, scenario }，不泄露流程定义；
 *  - POST /web-demo/calls 服务端强制 to=1001、channel='web'（不经 FreeSWITCH originate，
 *    不可能拨出真实电话），且只接受已发布（或 version>0 有已发布快照）的流程；
 *  - 按来源 IP 简单限流，防止匿名接口被刷。
 */
@Controller('web-demo')
export class WebDemoController {
  /** ip → 窗口内发起时间戳（进程内存级限流，多实例部署时各自计数） */
  private readonly callTimestamps = new Map<string, number[]>();

  constructor(
    private readonly tasksService: TasksService,
    private readonly taskFlowsService: TaskFlowsService,
    @Optional() private readonly cls?: ClsService,
  ) {}

  /** 在 demo 租户上下文里执行：满足 CALL-03 fail-closed，且只暴露该租户数据 */
  private runInDemoTenant<T>(fn: () => Promise<T>): Promise<T> {
    const cls = this.cls;
    if (!cls) return fn();
    const tenantId = process.env.WEB_DEMO_TENANT_ID ?? DEFAULT_DEMO_TENANT_ID;
    if (cls.isActive()) {
      cls.set(TENANT_CLS_KEY, tenantId);
      return fn();
    }
    return cls.run(() => {
      cls.set(TENANT_CLS_KEY, tenantId);
      return fn();
    });
  }

  @Get('flows')
  @Public()
  async listFlows() {
    return this.runInDemoTenant(async () => {
      const flows = await this.taskFlowsService.list({});
      return flows
        .filter((flow) => flow.status === 'published' || flow.version > 0)
        .map((flow) => ({
          id: flow.id,
          name: flow.name,
          scenario: flow.scenarioConfig?.scenario ?? null,
        }));
    });
  }

  @Post('calls')
  @Public()
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async startCall(
    @Body() dto: StartWebDemoCallDto,
    @Ip() ip: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    this.assertRateLimit(forwardedFor?.split(',')[0]?.trim() || ip || 'unknown');

    return this.runInDemoTenant(async () => {
      const flow = await this.taskFlowsService.get(dto.flowId).catch(() => null);
      if (!flow || (flow.status !== 'published' && flow.version <= 0)) {
        throw new NotFoundException('流程不存在或未发布');
      }

      const task = await this.tasksService.create({
        to: DEMO_CALLEE,
        scenario: flow.scenarioConfig?.scenario ?? FALLBACK_SCENARIO,
        flowId: flow.id,
      });
      const dispatched = await this.tasksService.dispatch(task.id, 'web');
      return {
        taskId: task.id,
        attemptId: dispatched.attemptId,
        status: dispatched.status,
      };
    });
  }

  private assertRateLimit(key: string): void {
    const now = Date.now();
    const stamps = (this.callTimestamps.get(key) ?? []).filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );
    if (stamps.length >= RATE_LIMIT_MAX) {
      throw new HttpException('体验次数过多，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    stamps.push(now);
    this.callTimestamps.set(key, stamps);
    // 防 Map 无限膨胀：条目过多时清理已全部过期的 key
    if (this.callTimestamps.size > 10_000) {
      for (const [k, v] of this.callTimestamps) {
        if (v.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) this.callTimestamps.delete(k);
      }
    }
  }
}
