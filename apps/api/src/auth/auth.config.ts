export const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

export type AccessTokenAlgorithm = 'HS256' | 'RS256';

function optionalPem(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\\n/g, '\n') : undefined;
}

function accessTokenAlgorithm(): AccessTokenAlgorithm {
  const value = process.env.JWT_ACCESS_ALGORITHM ?? 'HS256';
  if (value === 'HS256' || value === 'RS256') return value;
  throw new Error('JWT_ACCESS_ALGORITHM must be HS256 or RS256');
}

export const JWT_ACCESS_ALGORITHM = accessTokenAlgorithm();
export const JWT_ACCESS_PRIVATE_KEY = optionalPem(process.env.JWT_ACCESS_PRIVATE_KEY);
export const JWT_ACCESS_PUBLIC_KEY = optionalPem(process.env.JWT_ACCESS_PUBLIC_KEY);
export const JWT_ACCESS_KEY_ID = process.env.JWT_ACCESS_KEY_ID?.trim() || 'ai-call-v1';

if (process.env.NODE_ENV === 'production') {
  if (JWT_ACCESS_ALGORITHM !== 'RS256') {
    throw new Error('Production JWT_ACCESS_ALGORITHM must be RS256');
  }
  if (!JWT_ACCESS_PRIVATE_KEY || !JWT_ACCESS_PUBLIC_KEY) {
    throw new Error('Production RS256 requires JWT_ACCESS_PRIVATE_KEY and JWT_ACCESS_PUBLIC_KEY');
  }
}

export const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '7d';

export const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '3d';

// 每个 ai-call 用户暂统一归属这个占位租户（与 ai-knowledge 的 BOOTSTRAP_TENANT_ID
// 对齐为 'tenant_demo'，实现跨系统同一 tenantId 互认）。CALL-02 已给业务表补上
// tenant_id 并回填到此租户；真实的每用户租户归属（User.tenantId 或 Membership）
// 留待后续工单，届时 login 时从用户实体取值写入 JWT claim。
export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'tenant_demo';

/** Pass a variable (not an inline literal) so ai-call stays type-compatible with authz 0.2
 * while deployments move to 0.3. The new fields take effect as soon as 0.3 is installed. */
export function accessTokenSignKeys() {
  return {
    secret: JWT_SECRET,
    privateKey: JWT_ACCESS_PRIVATE_KEY,
    algorithm: JWT_ACCESS_ALGORITHM,
    keyId: JWT_ACCESS_KEY_ID,
    ttl: ACCESS_TOKEN_EXPIRES_IN,
  };
}

export function accessTokenVerifyKeys() {
  return {
    secret: JWT_SECRET,
    publicKey: JWT_ACCESS_PUBLIC_KEY,
    algorithm: JWT_ACCESS_ALGORITHM,
  };
}
