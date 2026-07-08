import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { ALL_PERMISSIONS } from '@ai-call/shared';
import type { PermissionCode } from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RolePermissionMapRefresher } from '../auth/role-permission-map.refresher.js';

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rolePermissionMapRefresher: RolePermissionMapRefresher,
  ) {}

  // ===== 用户管理 =====

  async listUsers() {
    const users = await this.prisma.user.findMany({
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      roles: u.roles.map((ur) => ur.role),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.roles.map((ur) => ur.role),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async createUser(dto: {
    email: string;
    password: string;
    name: string;
    roleIds?: string[];
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        roles: dto.roleIds?.length
          ? { create: dto.roleIds.map((roleId) => ({ roleId })) }
          : undefined,
      },
    });
    return { id: user.id };
  }

  async updateUser(
    id: string,
    dto: { name?: string; status?: string; roleIds?: string[] },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const data: {
      name?: string;
      status?: string;
      roles?: { deleteMany: Record<string, never>; create?: Array<{ roleId: string }> };
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;

    if (dto.roleIds !== undefined) {
      data.roles = {
        deleteMany: {},
        create: dto.roleIds.map((roleId) => ({ roleId })),
      };
    }

    await this.prisma.user.update({ where: { id }, data });
  }

  async resetPassword(id: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const passwordHash = await hash(password, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    await this.prisma.userSession.deleteMany({ where: { userId: id } });
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email === 'admin@ai-call.local') {
      throw new BadRequestException('Cannot delete the default admin account');
    }
    await this.prisma.user.delete({ where: { id } });
  }

  // ===== 角色管理 =====

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: {
        permissions: {
          include: {
            permission: { select: { id: true, code: true, description: true } },
          },
        },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions.map((rp) => rp.permission),
      userCount: r._count.users,
    }));
  }

  async createRole(dto: {
    name: string;
    description?: string;
    permissionCodes?: PermissionCode[];
  }) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Role name already exists');

    const permissions = dto.permissionCodes?.length
      ? await this.prisma.permission.findMany({
          where: { code: { in: dto.permissionCodes } },
        })
      : [];

    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description ?? '',
        permissions: permissions.length
          ? { create: permissions.map((p) => ({ permissionId: p.id })) }
          : undefined,
      },
    });
    await this.rolePermissionMapRefresher.refresh();
    return { id: role.id };
  }

  async updateRole(
    id: string,
    dto: {
      name?: string;
      description?: string;
      permissionCodes?: PermissionCode[];
    },
  ) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'admin' && dto.name && dto.name !== 'admin') {
      throw new BadRequestException('Cannot rename the admin role');
    }

    const data: {
      name?: string;
      description?: string;
      permissions?: { deleteMany: Record<string, never>; create?: Array<{ permissionId: string }> };
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    if (dto.permissionCodes !== undefined) {
      const permissions = dto.permissionCodes.length
        ? await this.prisma.permission.findMany({
            where: { code: { in: dto.permissionCodes } },
          })
        : [];
      data.permissions = {
        deleteMany: {},
        create: permissions.map((p) => ({ permissionId: p.id })),
      };
    }

    await this.prisma.role.update({ where: { id }, data });
    await this.rolePermissionMapRefresher.refresh();
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'admin') {
      throw new BadRequestException('Cannot delete the admin role');
    }
    const userCount = await this.prisma.userRole.count({
      where: { roleId: id },
    });
    if (userCount > 0) {
      throw new BadRequestException(
        `Cannot delete role with ${userCount} assigned user(s)`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    await this.rolePermissionMapRefresher.refresh();
  }

  // ===== 权限查询 =====

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { code: 'asc' },
    });
    return permissions.map((p) => ({
      id: p.id,
      code: p.code as PermissionCode,
      description: p.description,
    }));
  }

  async listAllPermissionCodes(): Promise<PermissionCode[]> {
    return ALL_PERMISSIONS;
  }
}
