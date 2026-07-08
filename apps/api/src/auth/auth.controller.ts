import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthResponse, UserProfile } from '@ai-call/shared';
import type { AuthClaims } from '@xiaoli-byte/authz/core';
import {
  accessCookieName,
  refreshCookieName,
  buildAccessCookieOptions,
  buildRefreshCookieOptions,
  decodeAccessTokenUnsafe,
  type AuthCookieConfig,
} from '@xiaoli-byte/authz/jwt';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public, CurrentUser } from './decorators.js';

/**
 * Same-origin BFF proxy on both dev and prod means the dashboard never needs a
 * cross-site cookie, so `sameSite` stays "lax" everywhere (see
 * docs/authz-architecture.md §0 — prod previously used SameSite=None with no
 * CSRF protection; this cookie config fixed that as part of adopting the shared
 * package in CALL-01, which also closed CALL-07's literal scope as a byproduct.
 * See auth.controller.spec.ts for the regression lock).
 */
const cookieConfig: AuthCookieConfig = {
  isProd: process.env.NODE_ENV === 'production',
  secureOverride:
    process.env.COOKIE_SECURE != null
      ? process.env.COOKIE_SECURE === 'true'
      : undefined,
  refreshCookiePath: '/api/auth/refresh',
};

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(
    accessCookieName(cookieConfig),
    tokens.accessToken,
    buildAccessCookieOptions(cookieConfig, AuthService.getAccessExpiresInMs()),
  );
  res.cookie(
    refreshCookieName(cookieConfig),
    tokens.refreshToken,
    buildRefreshCookieOptions(cookieConfig, AuthService.getRefreshExpiresInMs()),
  );
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(accessCookieName(cookieConfig), {
    path: '/',
    sameSite: cookieConfig.sameSite ?? 'lax',
    secure: cookieConfig.secureOverride ?? cookieConfig.isProd,
  });
  res.clearCookie(refreshCookieName(cookieConfig), {
    path: cookieConfig.refreshCookiePath,
    sameSite: cookieConfig.sameSite ?? 'lax',
    secure: cookieConfig.secureOverride ?? cookieConfig.isProd,
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto.email, dto.password);
    setAuthCookies(res, result.tokens);
    return { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const refreshToken = req.cookies?.[refreshCookieName(cookieConfig)] as
      | string
      | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }
    const tokens = await this.authService.refreshTokens(refreshToken);
    setAuthCookies(res, tokens);
    const claims = decodeAccessTokenUnsafe(tokens.accessToken);
    if (!claims?.sub) {
      throw new UnauthorizedException('Invalid access token');
    }
    const user = await this.authService.buildUserProfile(claims.sub);
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = req.cookies?.[refreshCookieName(cookieConfig)] as
      | string
      | undefined;
    await this.authService.logout(refreshToken);
    clearAuthCookies(res);
  }

  @Get('me')
  async me(@CurrentUser() claims: AuthClaims): Promise<UserProfile> {
    return this.authService.buildUserProfile(claims.sub);
  }
}
