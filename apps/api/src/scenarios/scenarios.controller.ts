import { Controller, Get, Param } from '@nestjs/common';
import { Scenario, SCENARIO_CONFIGS } from '@ai-call/shared';
import { Public } from '../auth/decorators/public.decorator.js';

/**
 * 场景配置 Controller
 *
 * 提供 3 个内置场景的配置查询接口，供 Voice Agent 启动时加载对应场景的话术、
 * 工具白名单、转人工规则。
 */
@Controller('scenarios')
@Public()
export class ScenariosController {
  /** 列出所有场景配置 */
  @Get()
  list() {
    return Object.values(SCENARIO_CONFIGS);
  }

  /** 获取指定场景的详细配置 */
  @Get(':scenario')
  get(@Param('scenario') scenario: Scenario) {
    return SCENARIO_CONFIGS[scenario] ?? null;
  }
}
