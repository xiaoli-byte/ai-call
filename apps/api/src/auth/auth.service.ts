import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import type {
  AuthResponse,
  PermissionCode,
  UserProfile,
} from '@ai-call/shared';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyRefreshTokenHash,
  parseDurationMs,
} from '@xiaoli-byte/authz/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
  DEFAULT_TENANT_ID,
} from './auth.config.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  static getJwtSecret(): string {
    return JWT_SECRET;
  }

  static getAccessExpiresInMs(): number {
    return parseDurationMs(ACCESS_TOKEN_EXPIRES_IN);
  }

  static getRefreshExpiresInMs(): number {
    return parseDurationMs(REFRESH_TOKEN_EXPIRES_IN);
  }

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<{
    id: string;
    email: string;
    passwordHash: string;
    name: string;
    status: string;
    roles: { role: { name: string } }[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  async login(email: string, password: string): Promise<AuthResponse & { tokens: { accessToken: string; refreshToken: string } }> {
    const user = await this.validateCredentials(email, password);
    const roleNames = user.roles.map((userRole) => userRole.role.name);
    const tokens = await this.generateTokenPair(user.id, user.email, roleNames);
    const profile = await this.buildUserProfile(user.id);
    return { user: profile, tokens };
  }

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const sessions = await this.prisma.userSession.findMany({
      where: { expiresAt: { gt: new Date() } },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });

    let matchedSession: (typeof sessions)[number] | null = null;
    for (const session of sessions) {
      if (await verifyRefreshTokenHash(refreshToken, session.refreshTokenHash)) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = matchedSession.user;
    if (user.status !== 'active') {
      await this.prisma.userSession.delete({ where: { id: matchedSession.id } });
      throw new UnauthorizedException('User inactive');
    }

    await this.prisma.userSession.delete({ where: { id: matchedSession.id } });
    const roleNames = user.roles.map((userRole) => userRole.role.name);
    return this.generateTokenPair(user.id, user.email, roleNames);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const sessions = await this.prisma.userSession.findMany({
      where: { expiresAt: { gt: new Date() } },
    });
    for (const session of sessions) {
      if (await verifyRefreshTokenHash(refreshToken, session.refreshTokenHash)) {
        await this.prisma.userSession.delete({ where: { id: session.id } });
        return;
      }
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { userId } });
  }

  async buildUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles: string[] = [];
    const permissionSet = new Set<PermissionCode>();
    for (const userRole of user.roles) {
      roles.push(userRole.role.name);
      for (const rp of userRole.role.permissions) {
        permissionSet.add(rp.permission.code as PermissionCode);
      }
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status as UserProfile['status'],
      roles,
      permissions: Array.from(permissionSet),
    };
  }

  private async generateTokenPair(
    userId: string,
    email: string,
    roleNames: string[],
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = signAccessToken(
      { sub: userId, tenantId: DEFAULT_TENANT_ID, roles: roleNames, email },
      { secret: AuthService.getJwtSecret(), ttl: ACCESS_TOKEN_EXPIRES_IN },
    );

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + AuthService.getRefreshExpiresInMs());

    await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
