import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { UserProfile } from '@ai-call/shared';
import { AuthService } from './auth.service.js';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          return (req.cookies?.access_token as string | undefined) ?? null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: AuthService.getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload): Promise<UserProfile> {
    return this.authService.buildUserProfile(payload.sub);
  }
}
