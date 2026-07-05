import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { ScenariosService } from './scenarios.service.js';
import { CreateScenarioDto } from './dto/create-scenario.dto.js';
import { UpdateScenarioDto } from './dto/update-scenario.dto.js';

/**
 * 场景配置 Controller
 *
 * 管理外呼场景的 TTS、身份、沟通风格、业务目标、LLM 约束与默认流程绑定。
 */
@Controller('scenarios')
@Permissions(PERMISSIONS.SCENARIO_READ)
export class ScenariosController {
  constructor(private readonly scenariosService: ScenariosService) {}

  /** 列出所有场景配置 */
  @Get()
  list() {
    return this.scenariosService.list();
  }

  /** 获取指定场景的详细配置 */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.scenariosService.get(id);
  }

  @Post()
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateScenarioDto) {
    return this.scenariosService.create(dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  update(@Param('id') id: string, @Body() dto: UpdateScenarioDto) {
    return this.scenariosService.update(id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  deactivate(@Param('id') id: string) {
    return this.scenariosService.deactivate(id);
  }
}
