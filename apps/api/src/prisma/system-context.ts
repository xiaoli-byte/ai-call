import type { ClsService } from 'nestjs-cls';

/**
 * CLS key holding the current request's tenantId.
 * Written by `@xiaoli-byte/authz` 的 JwtAuthGuard（cls.set('tenantId', claims.tenantId)）。
 */
export const TENANT_CLS_KEY = 'tenantId';

/**
 * CLS key marking the current execution as a trusted, tenant-unscoped system context
 * (background workers / seed / service-to-service calls). When set, the Prisma tenant
 * extension skips tenant filtering. See CALL-03.
 */
export const SYSTEM_BYPASS_CLS_KEY = 'authzSystemBypass';

/**
 * 在“系统上下文”里执行 `fn`：租户扩展将跳过强制过滤（fail-closed 的显式逃生舱）。
 *
 * 用于没有用户租户的可信路径：后台 worker 的每次 tick、服务间调用（服务令牌鉴权）等。
 * 若当前已在 CLS 上下文中（HTTP 请求），直接在该上下文打标记；否则新建一个 CLS 上下文。
 */
export function runAsSystem<T>(cls: ClsService, fn: () => T): T {
  if (cls.isActive()) {
    cls.set(SYSTEM_BYPASS_CLS_KEY, true);
    return fn();
  }
  return cls.run(() => {
    cls.set(SYSTEM_BYPASS_CLS_KEY, true);
    return fn();
  });
}
