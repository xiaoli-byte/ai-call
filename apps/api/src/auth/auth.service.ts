import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type {
  AuthResponse,
  PermissionCode,
  UserProfile,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
} from './auth.config.js';

interface TokenPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  static getJwtSecret(): string {
    return JWT_SECRET;
  }

  static getAccessExpiresInMs(): number {
    return ms(ACCESS_TOKEN_EXPIRES_IN as string);
  }

  static getRefreshExpiresInMs(): number {
    return ms(REFRESH_TOKEN_EXPIRES_IN as string);
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
    const tokens = await this.generateTokenPair(user.id, user.email);
    const profile = await this.buildUserProfile(user.id);
    return { user: profile, tokens };
  }

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const sessions = await this.prisma.userSession.findMany({
      where: { expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    let matchedSession: (typeof sessions)[number] | null = null;
    for (const session of sessions) {
      if (await compare(refreshToken, session.refreshTokenHash)) {
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
    return this.generateTokenPair(user.id, user.email);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const sessions = await this.prisma.userSession.findMany({
      where: { expiresAt: { gt: new Date() } },
    });
    for (const session of sessions) {
      if (await compare(refreshToken, session.refreshTokenHash)) {
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
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: TokenPayload = { sub: userId, email };
    const accessToken = this.jwtService.sign(payload, {
      secret: AuthService.getJwtSecret(),
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

    const refreshToken = randomBytes(32).toString('base64url');
    const refreshTokenHash = await hash(refreshToken, 10);
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

function ms(value: string): number {
  const match = value.match(/^(-?(?:\d+)?\.?\d+) *(ms|s|m|h|d|w|y)?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1] ?? '0');
  const unit = (match[2] ?? 'ms').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };
  return num * (multipliers[unit] ?? 1);
}
