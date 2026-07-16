import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import type { PermissionCode } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { SystemService } from './system.service.js';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  // ===== 用户管理 =====

  @Get('users')
  @Permissions(PERMISSIONS.SYSTEM_USER_READ)
  async listUsers() {
    return this.systemService.listUsers();
  }

  @Get('users/:id')
  @Permissions(PERMISSIONS.SYSTEM_USER_READ)
  async getUser(@Param('id') id: string) {
    return this.systemService.getUser(id);
  }

  @Post('users')
  @Permissions(PERMISSIONS.SYSTEM_USER_CREATE)
  async createUser(
    @Body()
    dto: {
      email: string;
      password: string;
      name: string;
      roleIds?: string[];
    },
  ) {
    return this.systemService.createUser(dto);
  }

  /** One-off, idempotent CALL-13 projection for identities created before rollout. */
  @Post('users/sync-knowledge')
  @Permissions(PERMISSIONS.SYSTEM_USER_UPDATE)
  async syncKnowledgeUsers() {
    return this.systemService.syncAllKnowledgeUsers();
  }

  @Patch('users/:id')
  @Permissions(PERMISSIONS.SYSTEM_USER_UPDATE)
  async updateUser(
    @Param('id') id: string,
    @Body()
    dto: { name?: string; status?: string; roleIds?: string[] },
  ) {
    await this.systemService.updateUser(id, dto);
  }

  @Post('users/:id/password')
  @Permissions(PERMISSIONS.SYSTEM_USER_UPDATE)
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: { password: string },
  ) {
    await this.systemService.resetPassword(id, dto.password);
  }

  @Delete('users/:id')
  @Permissions(PERMISSIONS.SYSTEM_USER_DELETE)
  async deleteUser(@Param('id') id: string) {
    await this.systemService.deleteUser(id);
  }

  // ===== 角色管理 =====

  @Get('roles')
  @Permissions(PERMISSIONS.SYSTEM_ROLE_READ)
  async listRoles() {
    return this.systemService.listRoles();
  }

  @Post('roles')
  @Permissions(PERMISSIONS.SYSTEM_ROLE_CREATE)
  async createRole(
    @Body()
    dto: {
      name: string;
      description?: string;
      permissionCodes?: PermissionCode[];
    },
  ) {
    return this.systemService.createRole(dto);
  }

  @Patch('roles/:id')
  @Permissions(PERMISSIONS.SYSTEM_ROLE_UPDATE)
  async updateRole(
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      description?: string;
      permissionCodes?: PermissionCode[];
    },
  ) {
    await this.systemService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @Permissions(PERMISSIONS.SYSTEM_ROLE_DELETE)
  async deleteRole(@Param('id') id: string) {
    await this.systemService.deleteRole(id);
  }

  // ===== 权限查询 =====

  @Get('permissions')
  @Permissions(PERMISSIONS.SYSTEM_ROLE_READ)
  async listPermissions() {
    return this.systemService.listPermissions();
  }
}
