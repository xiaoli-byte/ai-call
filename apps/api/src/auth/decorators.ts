import { Public, CurrentUser, RequirePermissions } from '@xiaoli-byte/authz/nestjs';
import type { PermissionKey } from '@xiaoli-byte/authz/core';
import type { PermissionCode } from '@ai-call/shared';

export { Public, CurrentUser };

// TODO(CALL-04): drop this cast once permission codes are 3-segment "{system}:{module}:{action}"
export const Permissions = (...codes: PermissionCode[]) =>
  RequirePermissions(...(codes as unknown as PermissionKey[]));
