import type { JwtSignOptions } from '@nestjs/jwt';

export const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

export const ACCESS_TOKEN_EXPIRES_IN = (
  process.env.JWT_ACCESS_EXPIRES_IN ?? '7d'
) as JwtSignOptions['expiresIn'];

export const REFRESH_TOKEN_EXPIRES_IN = (
  process.env.JWT_REFRESH_EXPIRES_IN ?? '3d'
) as JwtSignOptions['expiresIn'];
