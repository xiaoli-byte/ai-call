import {
  Body,
  Controller,
  Get,
  Patch,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import type { AuthClaims } from '@xiaoli-byte/authz/core';
import { CurrentUser, Permissions } from '../auth/decorators.js';
import { AuthService } from '../auth/auth.service.js';
import { UpdateGlobalConfigDto } from './dto/update-global-config.dto.js';
import { GlobalConfigService } from './global-config.service.js';

@Controller('global-config')
@Permissions(PERMISSIONS.SCENARIO_READ)
export class GlobalConfigController {
  constructor(
    private readonly globalConfigService: GlobalConfigService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  get() {
    return this.globalConfigService.get();
  }

  @Patch()
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(@Body() dto: UpdateGlobalConfigDto, @CurrentUser() claims: AuthClaims) {
    const user = claims ? await this.authService.buildUserProfile(claims.sub) : undefined;
    return this.globalConfigService.update(dto, user);
  }
}
