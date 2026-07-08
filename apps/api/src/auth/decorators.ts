import { Public, CurrentUser, RequirePermissions } from '@xiaoli-byte/authz/nestjs';
import type { PermissionKey } from '@xiaoli-byte/authz/core';
import type { PermissionCode } from '@ai-call/shared';

export { Public, CurrentUser };

// CALL-04 已给 campaigns/quality/compliance/analytics/tenants/platform 去贴标签为 3 段码；
// 但 task/flow/scenario/knowledge/call 等仍是 2 段码，PermissionKey 是严格 3 段模板字面量，
// 故此处仍需 cast。待后续工单把全部权限码统一为 "{system}:{module}:{action}" 后即可移除。
export const Permissions = (...codes: PermissionCode[]) =>
  RequirePermissions(...(codes as unknown as PermissionKey[]));
