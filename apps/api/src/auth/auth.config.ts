export const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

export const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '7d';

export const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '3d';

// 每个 ai-call 用户暂统一归属这个占位租户（与 ai-knowledge 的 BOOTSTRAP_TENANT_ID
// 对齐为 'tenant_demo'，实现跨系统同一 tenantId 互认）。CALL-02 已给业务表补上
// tenant_id 并回填到此租户；真实的每用户租户归属（User.tenantId 或 Membership）
// 留待后续工单，届时 login 时从用户实体取值写入 JWT claim。
export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'tenant_demo';
