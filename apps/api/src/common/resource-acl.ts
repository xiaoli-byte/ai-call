import { AclPerm } from '@xiaoli-byte/authz/acl';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * 资源级 ACL 的通用原语（对齐 @xiaoli-byte/authz 的 acl/ 语义），供各资源类型复用同一张
 * `resource_grants` 表与同一套判定，避免每个资源另造一套 ACL。
 *
 * 具体资源在各自的 `*-acl.ts` 里用这些原语拼出模型专属的
 * Prisma where（返回类型随模型不同，故可见性 where 留在各模型侧，仅 3~4 行）。
 * 见 docs/authz-implementation-backlog.md CALL-05（call_task）。
 */

/** 绕过资源 ACL、可见租户内全部资源的角色。admin 是 ai-call 当前最高业务角色；
 * super_admin 是 @xiaoli-byte/authz 固定的跨系统超管角色名（预留，尚未指派）。 */
export const ACL_BYPASS_ROLES = ['admin', 'super_admin'];

export interface AclSubject {
  userId?: string;
  roles: string[];
}

export function isAclBypass(roles: readonly string[]): boolean {
  return roles.some((role) => ACL_BYPASS_ROLES.includes(role));
}

export function hasViewPerm(perms: number): boolean {
  return (perms & AclPerm.VIEW) === AclPerm.VIEW;
}

/** 当前主体（按 userId / roles）在某 resourceType 下持有的显式授权所需 where。 */
export function resourceGrantWhere(
  resourceType: string,
  subject: AclSubject,
): Prisma.ResourceGrantWhereInput {
  const or: Prisma.ResourceGrantWhereInput[] = [];
  if (subject.userId) or.push({ subjectType: 'USER', subjectId: subject.userId });
  if (subject.roles.length > 0) or.push({ subjectType: 'ROLE', subjectId: { in: subject.roles } });
  return {
    resourceType,
    // 无 userId 也无 roles 时不应匹配任何授权行。
    OR: or.length > 0 ? or : [{ subjectId: '__none__' }],
  };
}
