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
import type { AuthResponse } from '@ai-call/shared';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { UserProfile } from '@ai-call/shared';

const ACCESS_COOKIE_NAME = 'access_token';
const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Cookie 配置：环境驱动。
 * - dev（HTTP）：SameSite=Lax, Secure=false，浏览器能正常写入 cookie
 * - prod（HTTPS）：SameSite=None 或 Lax（同源代理后建议 Lax）, Secure=true
 *
 * 同源代理后（Dashboard rewrites / Route Handler）浏览器请求同源 /api/*，
 * 不再需要跨站 cookie，dev 用 Lax 修复 HTTP 环境下 SameSite=None 被拒绝的问题。
 */
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = process.env.COOKIE_SECURE ?? IS_PROD;
const COOKIE_SAMESITE: 'none' | 'lax' = IS_PROD ? 'none' : 'lax';

function cookieOptions(path: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE === true || COOKIE_SECURE === 'true',
    sameSite: COOKIE_SAMESITE,
    maxAge,
    path,
  };
}

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(
    ACCESS_COOKIE_NAME,
    tokens.accessToken,
    cookieOptions('/', AuthService.getAccessExpiresInMs()),
  );
  res.cookie(
    REFRESH_COOKIE_NAME,
    tokens.refreshToken,
    cookieOptions('/api/auth/refresh', AuthService.getRefreshExpiresInMs()),
  );
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME, {
    path: '/',
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE === true || COOKIE_SECURE === 'true',
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/api/auth/refresh',
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE === true || COOKIE_SECURE === 'true',
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
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }
    const tokens = await this.authService.refreshTokens(refreshToken);
    setAuthCookies(res, tokens);
    const user = await this.authService.buildUserProfile(
      this.extractUserIdFromToken(tokens.accessToken),
    );
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    await this.authService.logout(refreshToken);
    clearAuthCookies(res);
  }

  @Get('me')
  me(@CurrentUser() user: UserProfile): UserProfile {
    return user;
  }

  private extractUserIdFromToken(token: string): string {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub: string };
    return payload.sub;
  }
}
