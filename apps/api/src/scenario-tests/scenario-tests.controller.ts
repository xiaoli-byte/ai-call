import { Body, Controller, Get, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { RunScenarioTestDto } from './dto/run-scenario-test.dto.js';
import { ScenarioTestsService } from './scenario-tests.service.js';

@Controller('scenarios/:scenarioKey/tests')
@Permissions(PERMISSIONS.FLOW_READ)
export class ScenarioTestsController {
  constructor(private readonly scenarioTests: ScenarioTestsService) {}

  @Get()
  list(@Param('scenarioKey') scenarioKey: string) {
    return this.scenarioTests.list(scenarioKey);
  }

  @Post('run')
  @Permissions(PERMISSIONS.FLOW_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  run(@Param('scenarioKey') scenarioKey: string, @Body() dto: RunScenarioTestDto) {
    return this.scenarioTests.run(scenarioKey, dto);
  }
}
