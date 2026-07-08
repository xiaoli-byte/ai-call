import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { RolePermissionMapRefresher } from './role-permission-map.refresher.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, RolePermissionMapRefresher],
  exports: [AuthService, RolePermissionMapRefresher],
})
export class AuthModule {}
