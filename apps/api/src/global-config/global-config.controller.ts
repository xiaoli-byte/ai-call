import {
  Body,
  Controller,
  Get,
  Patch,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PERMISSIONS, type UserProfile } from '@ai-call/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { UpdateGlobalConfigDto } from './dto/update-global-config.dto.js';
import { GlobalConfigService } from './global-config.service.js';

@Controller('global-config')
@Permissions(PERMISSIONS.SCENARIO_READ)
export class GlobalConfigController {
  constructor(private readonly globalConfigService: GlobalConfigService) {}

  @Get()
  get() {
    return this.globalConfigService.get();
  }

  @Patch()
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  update(@Body() dto: UpdateGlobalConfigDto, @CurrentUser() user: UserProfile) {
    return this.globalConfigService.update(dto, user);
  }
}
