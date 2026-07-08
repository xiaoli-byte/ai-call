export const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

export const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '7d';

export const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '3d';

// CALL-02 will add a real tenantId column to User; until then every ai-call user
// is scoped to this single placeholder tenant (same bootstrap approach ai-knowledge
// used for BOOTSTRAP_TENANT_ID before its Tenant model existed).
export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'default';
